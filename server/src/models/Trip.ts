/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Queue & Realtime
 * ============================================================================
 *
 *  Trip.ts — the `trips` table: a driver's planned and past journeys.
 *
 *  `previousTrip` (`previous_trip_id`) is the `next` pointer of a
 *  most-recent-first singly linked list; services/tripService.ts walks it.
 * ============================================================================
 */

import { db, type Queryable } from '../config/db';
import { toGeoPoint, type GeoPoint, type LatLng } from '../utils/geo';

export const TRIP_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export interface ChargingStop {
  station: string;
  arrivalBatteryPct?: number;
  estimatedWaitMinutes?: number;
  estimatedChargeMinutes?: number;
}

export interface Trip {
  id: string;
  user: string;
  origin: GeoPoint;
  originLabel?: string;
  destination: GeoPoint;
  destinationLabel?: string;
  /** Battery state of charge at departure, 0-100. */
  batteryStartPct: number;
  /** The single recommended charging stop, when one was needed. */
  chargingStop: ChargingStop | null;
  /** Computed path. Shape owned by the routing module. */
  route?: unknown;
  distanceKm?: number;
  estimatedDurationMinutes?: number;
  status: TripStatus;
  /** Pointer to the user's previous trip: the linked list's `next`. */
  previousTrip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TripInput {
  origin: LatLng;
  originLabel?: string;
  destination: LatLng;
  destinationLabel?: string;
  batteryStartPct: number;
  chargingStop: ChargingStop | null;
  route?: unknown;
  distanceKm?: number;
  estimatedDurationMinutes?: number;
  status: TripStatus;
  previousTrip: string | null;
}

interface TripRow {
  id: string;
  user_id: string;
  origin_lat: number;
  origin_lng: number;
  origin_label: string | null;
  destination_lat: number;
  destination_lng: number;
  destination_label: string | null;
  battery_start_pct: number | string;
  stops: ChargingStop[];
  route: unknown;
  distance_km: number | string | null;
  estimated_duration_minutes: number | string | null;
  status: TripStatus;
  previous_trip_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function fromRow(row: TripRow): Trip {
  return {
    id: row.id,
    user: row.user_id,
    origin: toGeoPoint({ lat: Number(row.origin_lat), lng: Number(row.origin_lng) }),
    ...(row.origin_label ? { originLabel: row.origin_label } : {}),
    destination: toGeoPoint({ lat: Number(row.destination_lat), lng: Number(row.destination_lng) }),
    ...(row.destination_label ? { destinationLabel: row.destination_label } : {}),
    batteryStartPct: Number(row.battery_start_pct),
    chargingStop: row.stops?.[0] ?? null,
    ...(row.route !== null && row.route !== undefined ? { route: row.route } : {}),
    ...(row.distance_km !== null ? { distanceKm: Number(row.distance_km) } : {}),
    ...(row.estimated_duration_minutes !== null
      ? { estimatedDurationMinutes: Number(row.estimated_duration_minutes) }
      : {}),
    status: row.status,
    previousTrip: row.previous_trip_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** The API shape of a trip. */
export const tripJSON = (trip: Trip): Record<string, unknown> => ({ ...trip });

export const Trips = {
  /** Every trip of a user, newest first. */
  async forUser(userId: string): Promise<Trip[]> {
    const { rows } = await db.query<TripRow>(
      'select * from trips where user_id = $1 order by created_at desc, id desc',
      [userId],
    );
    return rows.map(fromRow);
  },

  async findById(id: string): Promise<Trip | null> {
    const { rows } = await db.query<TripRow>('select * from trips where id = $1', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  },

  /** The newest trip's id: the current head of the user's list. */
  async headId(q: Queryable, userId: string): Promise<string | null> {
    const { rows } = await q.query<{ id: string }>(
      'select id from trips where user_id = $1 order by created_at desc, id desc limit 1',
      [userId],
    );
    return rows[0]?.id ?? null;
  },

  async create(q: Queryable, userId: string, input: TripInput): Promise<Trip> {
    const { rows } = await q.query<TripRow>(
      `insert into trips (user_id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng,
         destination_label, battery_start_pct, stops, route, distance_km, estimated_duration_minutes, status,
         previous_trip_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
      [
        userId,
        input.origin.lat,
        input.origin.lng,
        input.originLabel ?? null,
        input.destination.lat,
        input.destination.lng,
        input.destinationLabel ?? null,
        input.batteryStartPct,
        JSON.stringify(input.chargingStop ? [input.chargingStop] : []),
        input.route === undefined ? null : JSON.stringify(input.route),
        input.distanceKm ?? null,
        input.estimatedDurationMinutes ?? null,
        input.status,
        input.previousTrip,
      ],
    );
    return fromRow(rows[0]);
  },

  /** Unlink one node: whoever pointed at it now points past it, then it goes. */
  async unlinkAndDelete(q: Queryable, trip: Trip): Promise<void> {
    await q.query('update trips set previous_trip_id = $3, updated_at = now() where user_id = $1 and previous_trip_id = $2', [
      trip.user,
      trip.id,
      trip.previousTrip,
    ]);
    await q.query('delete from trips where id = $1', [trip.id]);
  },
};

export default Trips;
