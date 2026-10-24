/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Indexing & Backend
 * ============================================================================
 *
 *  Station.ts — the `stations` table and the helpers around one station.
 *
 *  A station is a plain object; this module owns turning rows into stations
 *  and back. Ports live in a JSONB array in `index` order — the fixed-size
 *  port board (the course's Array) — so flipping one port is O(1).
 * ============================================================================
 */

import { db, type Queryable } from '../config/db';
import type { ConnectorType, IndexedStation, Port, PortStatus, StationAddress } from '../types';
import type { GeoPoint, LatLng } from '../utils/geo';

export interface Station {
  id: string;
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
  managedBy?: string;
  /** Provenance: an operator's API call, the curated seed, or OpenStreetMap. */
  source: StationSource;
  /** The record's id in its source (e.g. `node/123` for OpenStreetMap). */
  externalId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type StationSource = 'manual' | 'seed' | 'osm';

export interface StationInput {
  name: string;
  operator: string;
  address: StationAddress;
  location: LatLng;
  pricePerKwh: number;
  ports: Port[];
  amenities?: string[];
  rating?: { average: number; count: number };
  queueLength?: number;
  graphNodeId?: string;
  managedBy?: string;
  isActive?: boolean;
  source?: StationSource;
  externalId?: string;
}

interface StationRow {
  id: string;
  name: string;
  operator: string;
  address: StationAddress;
  lat: number;
  lng: number;
  price_per_kwh: number | string;
  rating_average: number | string;
  rating_count: number;
  ports: Port[];
  amenities: string[];
  is_active: boolean;
  queue_length: number;
  graph_node_id: string | null;
  managed_by: string | null;
  source: StationSource;
  external_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function fromRow(row: StationRow): Station {
  return {
    id: row.id,
    name: row.name,
    operator: row.operator,
    address: row.address,
    location: { type: 'Point', coordinates: [Number(row.lng), Number(row.lat)] },
    pricePerKwh: Number(row.price_per_kwh),
    rating: { average: Number(row.rating_average), count: Number(row.rating_count) },
    ports: (row.ports ?? []).map((port) => ({
      ...port,
      occupiedSince: port.occupiedSince ? new Date(port.occupiedSince) : null,
    })),
    amenities: row.amenities ?? [],
    isActive: row.is_active,
    queueLength: Number(row.queue_length),
    ...(row.graph_node_id ? { graphNodeId: row.graph_node_id } : {}),
    ...(row.managed_by ? { managedBy: row.managed_by } : {}),
    source: row.source ?? 'manual',
    ...(row.external_id ? { externalId: row.external_id } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ─── Derived values ─────────────────────────────────────────────────────────

export const totalPorts = (station: Station): number => station.ports.length;

/** Linear over a fixed, tiny array (<= 32) — effectively O(1). */
export const freePorts = (station: Station): number =>
  station.ports.reduce((count, port) => (port.status === 'free' ? count + 1 : count), 0);

export const connectorTypes = (station: Station): ConnectorType[] => [
  ...new Set(station.ports.map((port) => port.connectorType)),
];

/**
 * Flip one port's state. O(1): ports are stored in `index` order, so the array
 * position is the port number. Throws RangeError for a port that doesn't exist.
 */
export function setPortStatus(station: Station, index: number, status: PortStatus): Port {
  let port: Port | undefined = station.ports[index];
  if (!port || port.index !== index) {
    // Fall back to a scan if the array somehow drifted out of index order.
    port = station.ports.find((candidate) => candidate.index === index);
    if (!port) {
      throw new RangeError(
        `Port ${index} does not exist on station ${station.name} (has ${station.ports.length} ports)`,
      );
    }
  }
  port.status = status;
  port.occupiedSince = status === 'occupied' ? new Date() : null;
  return port;
}

/** Everything a driver might plausibly type to find this station. Fed into the Trie. */
export function searchTerms(station: Station): string[] {
  const { locality, city, state } = station.address;
  return [
    station.name,
    `${station.name} ${locality}`,
    locality,
    `${locality} ${city}`,
    city,
    state,
    station.operator,
    `${station.operator} ${locality}`,
  ].filter((term): term is string => Boolean(term && term.trim()));
}

/** The flat shape the in-memory index stores. */
export function toIndexed(station: Station): IndexedStation {
  return {
    id: station.id,
    name: station.name,
    operator: station.operator,
    address: {
      line1: station.address.line1,
      locality: station.address.locality,
      city: station.address.city,
      state: station.address.state,
      ...(station.address.pincode ? { pincode: station.address.pincode } : {}),
    },
    location: { lat: station.location.coordinates[1], lng: station.location.coordinates[0] },
    pricePerKwh: station.pricePerKwh,
    rating: station.rating.average,
    ratingCount: station.rating.count,
    connectorTypes: connectorTypes(station),
    totalPorts: totalPorts(station),
    freePorts: freePorts(station),
    queueLength: station.queueLength,
    amenities: [...station.amenities],
    isActive: station.isActive,
  };
}

/** The API shape of a full station: the stored fields plus the derived counts. */
export function stationJSON(station: Station): Station & {
  totalPorts: number;
  freePorts: number;
  connectorTypes: ConnectorType[];
} {
  return {
    ...station,
    totalPorts: totalPorts(station),
    freePorts: freePorts(station),
    connectorTypes: connectorTypes(station),
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export interface StationFilter {
  city?: string;
  operator?: string;
  connectorType?: ConnectorType;
  /** Only stations within `radiusKm` of `near`. */
  near?: LatLng;
  radiusKm?: number;
}

function where(filter: StationFilter): { sql: string; params: unknown[] } {
  const clauses = ['is_active'];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };
  if (filter.city) add(`lower(address->>'city') = lower(?)`, filter.city);
  if (filter.operator) add('lower(operator) = lower(?)', filter.operator);
  if (filter.connectorType) add('ports @> ?::jsonb', JSON.stringify([{ connectorType: filter.connectorType }]));
  if (filter.near && filter.radiusKm !== undefined) {
    params.push(filter.near.lat, filter.near.lng, filter.radiusKm);
    const [lat, lng, km] = [params.length - 2, params.length - 1, params.length];
    // A latitude band first (uses the index), then the exact haversine distance.
    clauses.push(
      `lat between $${lat}::float8 - $${km}::float8 / 111.0 and $${lat}::float8 + $${km}::float8 / 111.0`,
      `2 * 6371 * asin(sqrt(power(sin(radians(lat - $${lat}::float8) / 2), 2) + cos(radians($${lat}::float8)) * cos(radians(lat)) * power(sin(radians(lng - $${lng}::float8) / 2), 2))) <= $${km}::float8`,
    );
  }
  return { sql: clauses.join(' and '), params };
}

export const Stations = {
  async findById(id: string, q: Queryable = db): Promise<Station | null> {
    const { rows } = await q.query<StationRow>('select * from stations where id = $1', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /** Lock the row for the rest of the transaction (queue mutations). */
  async findByIdForUpdate(id: string, q: Queryable): Promise<Station | null> {
    const { rows } = await q.query<StationRow>('select * from stations where id = $1 for update', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /** One page of active stations, best rated first, plus the total match count. */
  async page(filter: StationFilter, page: number, limit: number): Promise<{ stations: Station[]; total: number }> {
    const { sql, params } = where(filter);
    const [list, count] = await Promise.all([
      db.query<StationRow>(
        `select * from stations where ${sql} order by rating_average desc, name
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      ),
      db.query<{ total: number | string }>(`select count(*) as total from stations where ${sql}`, params),
    ]);
    return { stations: list.rows.map(fromRow), total: Number(count.rows[0]?.total ?? 0) };
  },

  /** Every active station, cheapest first: the sorted stream the BST rebuild consumes. */
  async allActive(): Promise<Station[]> {
    const { rows } = await db.query<StationRow>('select * from stations where is_active order by price_per_kwh');
    return rows.map(fromRow);
  },

  /** Nearest other active station to a point (flat-earth distance is enough to rank within a city). */
  async nearestActive(excludeId: string, to: LatLng, q: Queryable = db): Promise<Station | null> {
    const { rows } = await q.query<StationRow>(
      `select * from stations where is_active and id <> $1
       order by power(lat - $2::float8, 2) + power((lng - $3::float8) * cos(radians($2::float8)), 2) limit 1`,
      [excludeId, to.lat, to.lng],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async create(input: StationInput, q: Queryable = db): Promise<Station> {
    const { rows } = await q.query<StationRow>(
      `insert into stations (name, operator, address, lat, lng, price_per_kwh, rating_average, rating_count,
         ports, amenities, is_active, queue_length, graph_node_id, managed_by, source, external_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning *`,
      [
        input.name,
        input.operator,
        JSON.stringify(input.address),
        input.location.lat,
        input.location.lng,
        input.pricePerKwh,
        input.rating?.average ?? 0,
        input.rating?.count ?? 0,
        JSON.stringify(input.ports),
        input.amenities ?? [],
        input.isActive ?? true,
        input.queueLength ?? 0,
        input.graphNodeId ?? null,
        input.managedBy ?? null,
        input.source ?? 'manual',
        input.externalId ?? null,
      ],
    );
    return fromRow(rows[0]);
  },

  /** Write every mutable field back and refresh the object from the stored row. */
  async save(station: Station, q: Queryable = db): Promise<Station> {
    const { rows } = await q.query<StationRow>(
      `update stations set name = $2, operator = $3, address = $4, lat = $5, lng = $6, price_per_kwh = $7,
         rating_average = $8, rating_count = $9, ports = $10, amenities = $11, is_active = $12,
         queue_length = $13, graph_node_id = $14, managed_by = $15, updated_at = now()
       where id = $1 returning *`,
      [
        station.id,
        station.name,
        station.operator,
        JSON.stringify(station.address),
        station.location.coordinates[1],
        station.location.coordinates[0],
        station.pricePerKwh,
        station.rating.average,
        station.rating.count,
        JSON.stringify(station.ports),
        station.amenities,
        station.isActive,
        station.queueLength,
        station.graphNodeId ?? null,
        station.managedBy ?? null,
      ],
    );
    if (!rows[0]) throw new Error(`Station ${station.id} vanished during save`);
    return Object.assign(station, fromRow(rows[0]));
  },

  /**
   * Record one driver's 1–5 score. Rating again replaces their earlier score
   * instead of counting twice. The running average folds the change in, so
   * seeded ratings (which have no per-driver rows) stay part of it.
   */
  async rate(stationId: string, userId: string, score: number): Promise<Station | null> {
    return db.tx(async (q) => {
      const station = await Stations.findByIdForUpdate(stationId, q);
      if (!station) return null;
      const { rows } = await q.query<{ score: number }>(
        'select score from station_ratings where station_id = $1 and user_id = $2',
        [stationId, userId],
      );
      const previous = rows[0] ? Number(rows[0].score) : null;
      await q.query(
        `insert into station_ratings (station_id, user_id, score) values ($1, $2, $3)
         on conflict (station_id, user_id) do update set score = excluded.score, updated_at = now()`,
        [stationId, userId, score],
      );
      const { average, count } = station.rating;
      const nextCount = previous === null ? count + 1 : Math.max(count, 1);
      const total = average * count - (previous ?? 0) + score;
      station.rating = { average: Math.round((total / nextCount) * 100) / 100, count: nextCount };
      return Stations.save(station, q);
    });
  },

  async managedBy(stationId: string): Promise<string | null | undefined> {
    const { rows } = await db.query<{ managed_by: string | null }>(
      'select managed_by from stations where id = $1',
      [stationId],
    );
    return rows.length ? rows[0].managed_by : undefined;
  },
};

export default Stations;
