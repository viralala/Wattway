/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Trip.ts — one planned or completed journey.
 *
 * PRD Section 10: "Trip history per user (Linked-list-backed, most-recent-first)."
 *
 * The *storage* is a collection; the *presentation* is a linked list. The
 * routing/history module builds the LinkedList over these rows when serving
 * history — this schema only guarantees the fields that makes possible
 * (`createdAt` ordering, a stable id, and the previous trip pointer below).
 *
 * `route` is intentionally loose (`Schema.Types.Mixed`): the routing module
 * owns the shape of a computed path, and pinning it down here would mean
 * editing my file every time their algorithm's output changes. It is written
 * by them and read by them.
 * ---------------------------------------------------------------------------
 */

import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import type { GeoPoint } from '../utils/geo';

export const TRIP_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export interface TripDocument extends Document<Types.ObjectId> {
  user: Types.ObjectId;
  origin: GeoPoint;
  originLabel?: string;
  destination: GeoPoint;
  destinationLabel?: string;
  /** Battery state of charge at departure, 0-100. */
  batteryStartPct: number;
  /** The single recommended charging stop, when one was needed. */
  chargingStop?: {
    station: Types.ObjectId;
    arrivalBatteryPct?: number;
    estimatedWaitMinutes?: number;
    estimatedChargeMinutes?: number;
  } | null;
  /** Computed path. Shape owned by the routing module. */
  route?: unknown;
  distanceKm?: number;
  estimatedDurationMinutes?: number;
  status: TripStatus;
  /**
   * Pointer to the user's previous trip. Lets the history module rehydrate a
   * most-recent-first linked list without re-sorting the whole collection.
   */
  previousTrip?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TripModel = Model<TripDocument>;

const pointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

const tripSchema = new Schema<TripDocument, TripModel>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin: { type: pointSchema, required: true },
    originLabel: { type: String, trim: true, maxlength: 160 },
    destination: { type: pointSchema, required: true },
    destinationLabel: { type: String, trim: true, maxlength: 160 },
    batteryStartPct: { type: Number, required: true, min: 0, max: 100 },
    chargingStop: {
      type: new Schema(
        {
          station: { type: Schema.Types.ObjectId, ref: 'Station', required: true },
          arrivalBatteryPct: { type: Number, min: 0, max: 100 },
          estimatedWaitMinutes: { type: Number, min: 0 },
          estimatedChargeMinutes: { type: Number, min: 0 },
        },
        { _id: false },
      ),
      default: null,
    },
    route: { type: Schema.Types.Mixed },
    distanceKm: { type: Number, min: 0 },
    estimatedDurationMinutes: { type: Number, min: 0 },
    status: { type: String, enum: TRIP_STATUSES, default: 'planned', index: true },
    previousTrip: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
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

// "My trips, newest first" is the only read pattern history has.
tripSchema.index({ user: 1, createdAt: -1 });

export const Trip = model<TripDocument, TripModel>('Trip', tripSchema);
export default Trip;
