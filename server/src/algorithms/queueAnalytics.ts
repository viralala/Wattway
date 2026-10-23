/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  queueAnalytics.ts - pure functions over a station's waiting line.
 *
 *    urgencyScore()        the priority used by the urgent-charge queue
 *    estimateWaits()       per-position wait estimate (min-heap of port-free times)
 *    buildOperatorReport() heapsort by wait + max-heap top-N + DEPQ extremes
 *    mergeWaitingLines()   leftist-heap merge for a faulted station
 *
 *  No database, no Express - the service hands plain driver records in.
 * ============================================================================
 */

import {
  BinaryHeap,
  DoubleEndedPriorityQueue,
  MaxPriorityQueue,
  heapSort,
  type Comparator,
} from '../datastructures/PriorityQueue';
import { LeftistHeap } from '../datastructures/LeftistHeap';

/** Battery below this is "about to strand the driver". */
export const CRITICAL_BATTERY_PCT = 5;

/** What the analytics need to know about one waiting driver. */
export interface WaitingDriver {
  /** QueueEntry id. */
  id: string;
  userId: string;
  name?: string;
  /** Epoch milliseconds. */
  joinedAt: number;
  batteryPct: number | null;
  emergency: boolean;
  expectedChargeMinutes: number;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Emergency vehicles and cars under 5 % jump the (non-urgent) line. */
export function isUrgent(driver: Pick<WaitingDriver, 'batteryPct' | 'emergency'>): boolean {
  return driver.emergency || (driver.batteryPct !== null && driver.batteryPct < CRITICAL_BATTERY_PCT);
}

export function minutesWaited(driver: Pick<WaitingDriver, 'joinedAt'>, now: number): number {
  return Math.max(0, (now - driver.joinedAt) / 60_000);
}

/**
 * Urgency in roughly 0-130:
 *    emergency vehicle ........ +100
 *    battery < 5 % ............ +60
 *    low battery .............. +0.3 per % below 100 (unknown battery = 50 %)
 *    time already waited ...... +0.5 per minute, capped at +30 (anti-starvation)
 */
export function urgencyScore(driver: WaitingDriver, now: number): number {
  const battery = driver.batteryPct ?? 50;
  let score = 0;
  if (driver.emergency) score += 100;
  if (driver.batteryPct !== null && driver.batteryPct < CRITICAL_BATTERY_PCT) score += 60;
  score += (100 - battery) * 0.3;
  score += Math.min(30, minutesWaited(driver, now) * 0.5);
  return round1(score);
}

/**
 * Estimated minutes until each waiting driver gets a port.
 *
 * `portFreeIn` holds, for each usable port, the minutes until it frees up (0 for
 * a free port). A MIN-HEAP of those times is the k-server queue in miniature:
 * the next driver in line takes the earliest-free port, and that port becomes
 * free again after their own charge. O(n log k).
 */
export function estimateWaits(portFreeIn: readonly number[], waitingDurations: readonly number[]): number[] {
  if (portFreeIn.length === 0) return waitingDurations.map(() => Infinity);
  const ports = BinaryHeap.heapify(portFreeIn.map((t) => Math.max(0, t)), (a, b) => a - b);
  return waitingDurations.map((duration) => {
    const startsIn = ports.pop() as number;
    ports.push(startsIn + duration);
    return Math.round(startsIn);
  });
}

// ─── Operator report ────────────────────────────────────────────────────────

export interface ReportedDriver {
  id: string;
  userId: string;
  name?: string;
  joinedAt: string;
  waitedMinutes: number;
  batteryPct: number | null;
  emergency: boolean;
  urgency: number;
}

export interface OperatorReport {
  generatedAt: string;
  waiting: number;
  /** Heapsort, longest wait first. */
  sortedByWait: ReportedDriver[];
  heapsort: {
    passes: number;
    /** Wait minutes after each pass (only for lines of <= 12, to keep payloads small). */
    trace: number[][] | null;
  };
  /** Max-heap priority queue: the N most urgent, most urgent first. */
  urgentQueue: ReportedDriver[];
  /** Min-max heap: both ends in O(1). */
  depq: { mostUrgent: ReportedDriver | null; leastUrgent: ReportedDriver | null };
}

function toReported(driver: WaitingDriver, now: number): ReportedDriver {
  return {
    id: driver.id,
    userId: driver.userId,
    ...(driver.name ? { name: driver.name } : {}),
    joinedAt: new Date(driver.joinedAt).toISOString(),
    waitedMinutes: round1(minutesWaited(driver, now)),
    batteryPct: driver.batteryPct,
    emergency: driver.emergency,
    urgency: urgencyScore(driver, now),
  };
}

export function buildOperatorReport(drivers: readonly WaitingDriver[], now: number, top = 5): OperatorReport {
  const reported = drivers.map((driver) => toReported(driver, now));

  // Heapsort: ascending by "-wait" = longest-waiting first.
  const byWait: Comparator<ReportedDriver> = (a, b) => b.waitedMinutes - a.waitedMinutes;
  const trace: number[][] = [];
  let passes = 0;
  const sorted = heapSort([...reported], byWait, (snapshot) => {
    passes += 1;
    if (reported.length <= 12) trace.push(snapshot.map((d) => d.waitedMinutes));
  });

  const urgentQueue = new MaxPriorityQueue<ReportedDriver>();
  reported.forEach((d) => urgentQueue.enqueue(d, d.urgency));

  const depq = DoubleEndedPriorityQueue.from(reported, (a, b) => a.urgency - b.urgency);

  return {
    generatedAt: new Date(now).toISOString(),
    waiting: reported.length,
    sortedByWait: sorted,
    heapsort: { passes, trace: reported.length <= 12 ? trace : null },
    urgentQueue: urgentQueue.top(top).map((entry) => entry.value),
    depq: { mostUrgent: depq.peekMax() ?? null, leastUrgent: depq.peekMin() ?? null },
  };
}

// ─── Merging two lines (faulted station) ────────────────────────────────────

/**
 * Line order: urgent drivers first, then by join time (seniority), then id so
 * the order is total and deterministic.
 */
export const lineOrder: Comparator<WaitingDriver> = (a, b) =>
  Number(isUrgent(b)) - Number(isUrgent(a)) || a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface MergeResult<T extends WaitingDriver> {
  merged: T[];
  stats: {
    targetSize: number;
    incomingSize: number;
    rightSpineTarget: number;
    rightSpineIncoming: number;
    rightSpineMerged: number;
  };
}

/**
 * Merge a faulted station's line into another's with leftist heaps. Each line
 * becomes a leftist heap (O(n) build), the two are melded in O(log n + log m),
 * and the result is drained in line order.
 */
export function mergeWaitingLines<T extends WaitingDriver>(
  target: readonly T[],
  incoming: readonly T[],
): MergeResult<T> {
  const a = LeftistHeap.from(target, lineOrder as Comparator<T>);
  const b = LeftistHeap.from(incoming, lineOrder as Comparator<T>);
  const rightSpineTarget = a.rightSpineLength();
  const rightSpineIncoming = b.rightSpineLength();

  a.merge(b);
  const rightSpineMerged = a.rightSpineLength();

  const merged: T[] = [];
  while (!a.isEmpty) merged.push(a.pop() as T);
  return {
    merged,
    stats: {
      targetSize: target.length,
      incomingSize: incoming.length,
      rightSpineTarget,
      rightSpineIncoming,
      rightSpineMerged,
    },
  };
}
