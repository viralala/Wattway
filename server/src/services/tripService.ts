/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  tripService.ts - trip history as a singly linked list.
 *
 *  PRD Section 10: "Trip history per user (Linked-list-backed, most-recent-first)."
 *
 *  THE LIST LIVES IN THE DATABASE
 *  ------------------------------
 *  `Trip.previousTrip` is the `next` pointer of a most-recent-first singly
 *  linked list. The user's newest trip is the head:
 *
 *      head (newest) --previousTrip--> older --previousTrip--> oldest --> null
 *
 *  · recordTrip()  = INSERT AT HEAD: the new trip points at the old head. O(1)
 *                    pointer work (plus one read to find the current head).
 *  · history()     = TRAVERSE: one query fetches the user's rows into an id
 *                    map, then we pointer-chase from the head, building an
 *                    in-memory SinglyLinkedList. O(n).
 *  · deleteTrip()  = DELETE A NODE: the newer trip that pointed at the victim
 *                    is re-pointed at the victim's own `previousTrip`. That is
 *                    `before.next = node.next` from Lab 3, done in MongoDB.
 *
 *  Robustness: if the chain is ever broken (a row written by a process that
 *  did not set the pointer, or two trips recorded at the same instant), the
 *  traversal still returns every trip - unreachable ones are spliced in by
 *  `createdAt` - and reports `chainIntact: false`. A visited-set guards the
 *  walk, and the built list is checked with Floyd's `hasCycle()`.
 *
 *  The routing module should call `recordTrip()` when it saves a planned trip,
 *  so the pointer is always set.
 * ============================================================================
 */

import { Types } from 'mongoose';
import { SinglyLinkedList } from '../datastructures/LinkedList';
import { Trip, type TripDocument, type TripStatus } from '../models/Trip';
import { ApiError } from '../utils/ApiError';
import { toGeoPoint, type LatLng } from '../utils/geo';

export interface RecordTripInput {
  origin: LatLng;
  originLabel?: string;
  destination: LatLng;
  destinationLabel?: string;
  batteryStartPct: number;
  chargingStop?: {
    stationId: string;
    arrivalBatteryPct?: number;
    estimatedWaitMinutes?: number;
    estimatedChargeMinutes?: number;
  } | null;
  route?: unknown;
  distanceKm?: number;
  estimatedDurationMinutes?: number;
  status?: TripStatus;
}

export interface TripHistory {
  trips: Record<string, unknown>[];
  total: number;
  /** Pass as `before` to get the next page; null at the end of the list. */
  nextCursor: string | null;
  /** True when every trip was reachable by following `previousTrip`. */
  chainIntact: boolean;
  /** Fast/slow-pointer middle of the full history (the "median" trip). */
  middleTripId: string | null;
}

/** Serialise writes per user so two quick saves cannot both point at one head. */
const userLocks = new Map<string, Promise<void>>();

async function withUserLock<R>(userId: string, work: () => Promise<R>): Promise<R> {
  const previous = userLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);
  userLocks.set(userId, chained);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (userLocks.get(userId) === chained) userLocks.delete(userId);
  }
}

/** Insert at head. */
export async function recordTrip(userId: string, input: RecordTripInput): Promise<TripDocument> {
  return withUserLock(userId, async () => {
    const head = await Trip.findOne({ user: userId }).sort({ createdAt: -1, _id: -1 }).select('_id').exec();
    return Trip.create({
      user: new Types.ObjectId(userId),
      origin: toGeoPoint(input.origin),
      ...(input.originLabel ? { originLabel: input.originLabel } : {}),
      destination: toGeoPoint(input.destination),
      ...(input.destinationLabel ? { destinationLabel: input.destinationLabel } : {}),
      batteryStartPct: input.batteryStartPct,
      chargingStop: input.chargingStop
        ? {
            station: new Types.ObjectId(input.chargingStop.stationId),
            ...(input.chargingStop.arrivalBatteryPct !== undefined
              ? { arrivalBatteryPct: input.chargingStop.arrivalBatteryPct }
              : {}),
            ...(input.chargingStop.estimatedWaitMinutes !== undefined
              ? { estimatedWaitMinutes: input.chargingStop.estimatedWaitMinutes }
              : {}),
            ...(input.chargingStop.estimatedChargeMinutes !== undefined
              ? { estimatedChargeMinutes: input.chargingStop.estimatedChargeMinutes }
              : {}),
          }
        : null,
      ...(input.route !== undefined ? { route: input.route } : {}),
      ...(input.distanceKm !== undefined ? { distanceKm: input.distanceKm } : {}),
      ...(input.estimatedDurationMinutes !== undefined
        ? { estimatedDurationMinutes: input.estimatedDurationMinutes }
        : {}),
      status: input.status ?? 'planned',
      previousTrip: head ? head._id : null,
    });
  });
}

/**
 * Build the user's whole history as a SinglyLinkedList, most recent first.
 * One database read, then pure pointer-chasing.
 */
export async function buildHistoryList(
  userId: string,
): Promise<{ list: SinglyLinkedList<TripDocument>; chainIntact: boolean }> {
  const rows = await Trip.find({ user: userId }).sort({ createdAt: -1, _id: -1 }).exec();
  const list = new SinglyLinkedList<TripDocument>();
  if (rows.length === 0) return { list, chainIntact: true };

  const byId = new Map(rows.map((row) => [row._id.toString(), row]));
  const visited = new Set<string>();

  // Head = the newest trip that no other trip points at.
  const pointedAt = new Set(rows.map((r) => r.previousTrip?.toString()).filter(Boolean) as string[]);
  const head = rows.find((r) => !pointedAt.has(r._id.toString())) ?? rows[0];

  // Pointer-chase. Each hop is an O(1) map lookup; insertAtTail is O(1).
  for (let cursor: TripDocument | undefined = head; cursor; ) {
    const id = cursor._id.toString();
    if (visited.has(id)) break; // a pointer loop in the data - stop, never spin
    visited.add(id);
    list.insertAtTail(cursor);
    const next: string | null = cursor.previousTrip ? cursor.previousTrip.toString() : null;
    cursor = next ? byId.get(next) : undefined;
  }

  const chainIntact = visited.size === rows.length;
  if (!chainIntact) {
    // Splice unreachable trips in by recency, so nothing is lost.
    for (const row of rows) {
      if (visited.has(row._id.toString())) continue;
      const at = list.indexOf((t) => t.createdAt.getTime() < row.createdAt.getTime());
      list.insertAt(at === -1 ? list.size : at, row);
    }
  }

  if (list.hasCycle()) throw ApiError.internal('Trip history list is corrupted');
  return { list, chainIntact };
}

/** A page of history, most recent first. `before` is the id of the last trip already shown. */
export async function history(
  userId: string,
  options: { limit: number; before?: string },
): Promise<TripHistory> {
  const { list, chainIntact } = await buildHistoryList(userId);

  let start = 0;
  if (options.before) {
    const at = list.indexOf((trip) => trip._id.toString() === options.before);
    if (at === -1) throw ApiError.notFound('Cursor trip not found in your history');
    start = at + 1;
  }

  const page: TripDocument[] = [];
  list.forEach((trip, index) => {
    if (index >= start && page.length < options.limit) page.push(trip);
  });

  const end = start + page.length;
  return {
    trips: page.map((trip) => trip.toJSON() as Record<string, unknown>),
    total: list.size,
    nextCursor: end < list.size && page.length > 0 ? page[page.length - 1]._id.toString() : null,
    chainIntact,
    middleTripId: list.middle()?._id.toString() ?? null,
  };
}

export async function getTrip(userId: string, tripId: string): Promise<TripDocument> {
  const trip = await Trip.findById(tripId).exec();
  // Same 404 for "missing" and "someone else's": do not confirm the id exists.
  if (!trip || trip.user.toString() !== userId) throw ApiError.notFound('Trip not found');
  return trip;
}

/** Delete a node: re-point its newer neighbour past it. */
export async function deleteTrip(userId: string, tripId: string): Promise<void> {
  await withUserLock(userId, async () => {
    const trip = await getTrip(userId, tripId);
    await Trip.updateMany(
      { user: trip.user, previousTrip: trip._id },
      { $set: { previousTrip: trip.previousTrip ?? null } },
    ).exec();
    await Trip.deleteOne({ _id: trip._id }).exec();
  });
}
