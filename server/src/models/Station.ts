/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Station.ts — a charging station.
 *
 * This schema is the contract every other module reads from, so a few fields
 * exist for their benefit rather than mine:
 *
 *  · `ports` is the fixed-size slot-status board the PRD assigns to the Array
 *    data structure (Section 5). Ports are addressed by their `index`, so
 *    flipping one to `occupied` is O(1) — see `setPortStatus()`.
 *
 *  · `queueLength` is denormalised onto the station and owned by the queue
 *    module. The index reads it to score recommendations; nothing in the index
 *    layer writes it.
 *
 *  · `graphNodeId` is the handle the routing module uses to tie a station to a
 *    vertex of the road graph, so it does not have to match on coordinates.
 *
 *  · `pricePerKwh` and `rating.average` are the two BST keys. They are also
 *    indexed in MongoDB — not because the API queries on them (the in-memory
 *    BSTs do that), but so the index *rebuild* can stream rows in sorted order
 *    cheaply.
 * ---------------------------------------------------------------------------
 */

import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import {
  CONNECTOR_TYPES,
  PORT_STATUSES,
  type ConnectorType,
  type IndexedStation,
  type Port,
  type PortStatus,
  type StationAddress,
} from '../types';
import type { GeoPoint } from '../utils/geo';

export interface StationDocument extends Document<Types.ObjectId> {
  name: string;
  operator: string;
  address: StationAddress;
  location: GeoPoint;
  pricePerKwh: number;
  rating: { average: number; count: number };
  ports: Port[];
  amenities: string[];
  isActive: boolean;
  /** Denormalised; owned by the queue module. */
  queueLength: number;
  /** Vertex id in the road graph; owned by the routing module. */
  graphNodeId?: string;
  /** Operator account that manages this station. */
  managedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;

  readonly totalPorts: number;
  readonly freePorts: number;
  readonly connectorTypes: ConnectorType[];

  setPortStatus(index: number, status: PortStatus): Port;
  searchTerms(): string[];
  toIndexed(): IndexedStation;
}

export type StationModel = Model<StationDocument>;

const portSchema = new Schema<Port>(
  {
    index: { type: Number, required: true, min: 0 },
    connectorType: { type: String, enum: CONNECTOR_TYPES, required: true },
    powerKw: { type: Number, required: true, min: 1, max: 400 },
    status: { type: String, enum: PORT_STATUSES, default: 'free' },
    occupiedSince: { type: Date, default: null },
  },
  { _id: false },
);

const addressSchema = new Schema<StationAddress>(
  {
    line1: { type: String, required: true, trim: true, maxlength: 160 },
    locality: { type: String, required: true, trim: true, maxlength: 80, index: true },
    city: { type: String, required: true, trim: true, maxlength: 80, index: true },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    pincode: { type: String, trim: true, match: [/^\d{6}$/, 'Pincode must be 6 digits'] },
  },
  { _id: false },
);

const stationSchema = new Schema<StationDocument, StationModel>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    operator: { type: String, required: true, trim: true, maxlength: 80, index: true },
    address: { type: addressSchema, required: true },
    location: {
      type: { type: String, enum: ['Point'], required: true, default: 'Point' },
      // GeoJSON order is [longitude, latitude].
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (value: number[]) =>
            value.length === 2 &&
            value[0] >= -180 &&
            value[0] <= 180 &&
            value[1] >= -90 &&
            value[1] <= 90,
          message: 'location.coordinates must be [longitude, latitude] within valid bounds',
        },
      },
    },
    pricePerKwh: { type: Number, required: true, min: 0, max: 500, index: true },
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5, index: true },
      count: { type: Number, default: 0, min: 0 },
    },
    ports: {
      type: [portSchema],
      required: true,
      validate: {
        validator: (ports: Port[]) => ports.length > 0 && ports.length <= 32,
        message: 'A station must have between 1 and 32 ports',
      },
    },
    amenities: [{ type: String, trim: true, maxlength: 40 }],
    isActive: { type: Boolean, default: true, index: true },
    queueLength: { type: Number, default: 0, min: 0 },
    graphNodeId: { type: String, trim: true, index: true, sparse: true },
    managedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Geospatial index for "stations near me"; the compound index backs the
// sorted stream that the in-memory BST rebuild consumes.
stationSchema.index({ location: '2dsphere' });
stationSchema.index({ isActive: 1, pricePerKwh: 1 });
stationSchema.index({ isActive: 1, 'rating.average': -1 });
stationSchema.index({ name: 1, 'address.city': 1 }, { unique: true });

// ─── Virtuals ───────────────────────────────────────────────────────────────

stationSchema.virtual('totalPorts').get(function totalPorts(this: StationDocument): number {
  return this.ports.length;
});

stationSchema.virtual('freePorts').get(function freePorts(this: StationDocument): number {
  // Linear over a fixed, tiny array (<= 32) — effectively O(1).
  return this.ports.reduce((count, port) => (port.status === 'free' ? count + 1 : count), 0);
});

stationSchema.virtual('connectorTypes').get(function connectorTypes(
  this: StationDocument,
): ConnectorType[] {
  return [...new Set(this.ports.map((port) => port.connectorType))];
});

// ─── Methods ────────────────────────────────────────────────────────────────

/**
 * Flip one port's state. O(1): ports are stored in `index` order, so the array
 * position is the port number. The bounds check is defensive — the array is
 * fixed-size, and a caller asking for port 9 of an 8-port station is a bug we
 * would rather surface than silently ignore.
 */
stationSchema.methods.setPortStatus = function setPortStatus(
  this: StationDocument,
  index: number,
  status: PortStatus,
): Port {
  const port = this.ports[index];
  if (!port || port.index !== index) {
    // Fall back to a scan if the array somehow drifted out of index order.
    const found = this.ports.find((candidate) => candidate.index === index);
    if (!found) {
      throw new RangeError(
        `Port ${index} does not exist on station ${this.name} (has ${this.ports.length} ports)`,
      );
    }
    found.status = status;
    found.occupiedSince = status === 'occupied' ? new Date() : null;
    this.markModified('ports');
    return found;
  }

  port.status = status;
  port.occupiedSince = status === 'occupied' ? new Date() : null;
  this.markModified('ports');
  return port;
};

/**
 * Everything a driver might plausibly type to find this station. Fed straight
 * into the Trie by `StationIndex`.
 */
stationSchema.methods.searchTerms = function searchTerms(this: StationDocument): string[] {
  const { locality, city, state } = this.address;
  return [
    this.name,
    `${this.name} ${locality}`,
    locality,
    `${locality} ${city}`,
    city,
    state,
    this.operator,
    `${this.operator} ${locality}`,
  ].filter((term): term is string => Boolean(term && term.trim()));
};

/**
 * Project down to the flat, database-handle-free shape the in-memory index
 * stores. Called once per station per rebuild.
 */
stationSchema.methods.toIndexed = function toIndexed(this: StationDocument): IndexedStation {
  return {
    id: this._id.toString(),
    name: this.name,
    operator: this.operator,
    address: {
      line1: this.address.line1,
      locality: this.address.locality,
      city: this.address.city,
      state: this.address.state,
      ...(this.address.pincode ? { pincode: this.address.pincode } : {}),
    },
    location: { lat: this.location.coordinates[1], lng: this.location.coordinates[0] },
    pricePerKwh: this.pricePerKwh,
    rating: this.rating.average,
    ratingCount: this.rating.count,
    connectorTypes: this.connectorTypes,
    totalPorts: this.totalPorts,
    freePorts: this.freePorts,
    queueLength: this.queueLength,
    amenities: [...this.amenities],
    isActive: this.isActive,
  };
};

export const Station = model<StationDocument, StationModel>('Station', stationSchema);
export default Station;
