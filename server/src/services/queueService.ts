/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  queueService.ts - the live, in-memory virtual queue of every station.
 *
 *  PRD Section 10: "Join a station's virtual queue and see live position +
 *  estimated wait (Queue-backed, pushed via WebSocket)."
 *
 *  ONE LINE PER STATION
 *  --------------------
 *      waiting        DoublyLinkedList<LiveDriver>    FIFO, front = next to charge
 *      waitingByUser  userId -> list node             O(1) "leave from the middle"
 *      charging       userId -> LiveDriver            at most 32 (one per port)
 *      lastUrgent     node of the last urgent driver  O(1) urgent insertion
 *
 *  Urgent drivers (emergency vehicle, or battery < 5 %) are inserted right
 *  behind the urgent drivers already waiting, i.e. ahead of every ordinary
 *  driver - so the urgent ones always form a prefix of the line and the
 *  pointer to the last of them makes that insert O(1).
 *
 *  The userId -> node index is typed as `NodeIndex`, a tiny map interface. It
 *  is backed by a built-in Map today; when the indexing module's
 *  `HashTable.ts` lands, swapping it in is the one line in `createNodeIndex()`.
 *
 *  CONSISTENCY - THE RULE THAT BITES
 *  ---------------------------------
 *  MongoDB (`QueueEntry`) is the durable write-behind log; this service is the
 *  hot path. Every mutation, in the same request:
 *      1. updates the in-memory line,
 *      2. persists the affected QueueEntry rows (status, port, position),
 *      3. writes `Station.queueLength` and any port flips,
 *      4. calls `stationIndex.upsert()` - queueLength and free ports feed the
 *         recommendation score, so a socket push alone is not enough,
 *  and then the controller broadcasts the change over Socket.IO.
 *
 *  A line is rehydrated lazily from MongoDB the first time a station is
 *  touched after boot, in stored `position` order.
 *
 *  CONCURRENCY
 *  -----------
 *  Node is single-threaded, but a mutation awaits the database several times,
 *  so two requests for the same station could interleave between awaits. Each
 *  station therefore has a promise-chain mutex; work on different stations
 *  runs in parallel. The merge operation locks both stations in id order, so
 *  two opposite merges cannot deadlock.
 *
 *  KNOWN LIMIT: urgency details (battery %, emergency flag, expected charge
 *  minutes) are kept in memory only, because `QueueEntry` - owned by the
 *  indexing module - has no fields for them. After a restart the line keeps its
 *  order (positions are persisted) but those drivers count as ordinary.
 * ============================================================================
 */

import { Types } from 'mongoose';
import { DoublyLinkedList, type DListNode } from '../datastructures/LinkedList';
import { Station, type StationDocument } from '../models/Station';
import { QueueEntry } from '../models/QueueEntry';
import { stationIndex } from './stationIndex';
import { ApiError } from '../utils/ApiError';
import { haversineKm } from '../utils/geo';
import {
  buildOperatorReport,
  estimateWaits,
  isUrgent,
  mergeWaitingLines,
  urgencyScore,
  type MergeResult,
  type OperatorReport,
  type WaitingDriver,
} from '../algorithms/queueAnalytics';
import type { ChargeJob } from '../algorithms/scheduler';
import type { AuthUser, Port } from '../types';

/** Assumed charge time when a driver does not say. */
export const DEFAULT_CHARGE_MINUTES = 30;
/** Assumed remaining time on a port occupied outside the queue (operator flip). */
const UNKNOWN_SESSION_REMAINING_MINUTES = DEFAULT_CHARGE_MINUTES / 2;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LiveDriver extends WaitingDriver {
  status: 'waiting' | 'charging';
  portIndex: number | null;
  /** Epoch ms. */
  startedChargingAt: number | null;
  /** Last position written to MongoDB, so unchanged rows are not rewritten. */
  persistedPosition: number;
}

export interface JoinOptions {
  batteryPct?: number;
  emergency?: boolean;
  expectedChargeMinutes?: number;
}

/** A driver's own view of their place. */
export interface YouView {
  stationId: string;
  status: 'waiting' | 'charging' | 'left';
  position?: number;
  carsAhead?: number;
  estimatedWaitMinutes?: number;
  urgent?: boolean;
  portIndex?: number;
  expectedRemainingMinutes?: number;
  /** Set when a merge moved the driver here from a faulted station. */
  movedFrom?: string;
  reason?: string;
}

export interface QueueSnapshot {
  stationId: string;
  stationName: string;
  totalPorts: number;
  freePorts: number;
  usablePorts: number;
  /** Cars waiting (not counting those charging) - the value the index scores. */
  queueLength: number;
  charging: {
    portIndex: number;
    startedAt: string | null;
    expectedRemainingMinutes: number;
    you: boolean;
  }[];
  waiting: {
    position: number;
    joinedAt: string;
    estimatedWaitMinutes: number | null;
    urgent: boolean;
    you: boolean;
  }[];
  /** Fast/slow pointer middle: "half the line is served in ~N minutes". */
  middle: { position: number; estimatedWaitMinutes: number | null } | null;
  you: YouView | null;
  updatedAt: string;
}

export interface PortsUpdate {
  stationId: string;
  totalPorts: number;
  freePorts: number;
  ports: { index: number; status: Port['status']; connectorType: Port['connectorType']; powerKw: number }[];
}

/** Everything a socket fan-out needs after a mutation. */
export interface QueueChange {
  stationId: string;
  snapshot: QueueSnapshot;
  ports: PortsUpdate;
  personal: { userId: string; view: YouView }[];
}

/** Minimal key -> value index; satisfied by Map today and HashTable later. */
export interface NodeIndex<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
  delete(key: K): boolean;
  has(key: K): boolean;
  readonly size: number;
}

function createNodeIndex<K, V>(): NodeIndex<K, V> {
  return new Map<K, V>();
}

// ─── One station's line ─────────────────────────────────────────────────────

export class StationLine {
  readonly waiting = new DoublyLinkedList<LiveDriver>();
  readonly waitingByUser: NodeIndex<string, DListNode<LiveDriver>> = createNodeIndex();
  readonly charging = new Map<string, LiveDriver>();
  private lastUrgent: DListNode<LiveDriver> | null = null;

  has(userId: string): boolean {
    return this.waitingByUser.has(userId) || this.charging.has(userId);
  }

  /** O(1): tail for ordinary drivers, behind the last urgent driver otherwise. */
  enqueue(driver: LiveDriver): DListNode<LiveDriver> {
    driver.status = 'waiting';
    driver.portIndex = null;
    let node: DListNode<LiveDriver>;
    if (isUrgent(driver)) {
      node = this.lastUrgent ? this.waiting.insertAfter(this.lastUrgent, driver) : this.waiting.pushFront(driver);
      this.lastUrgent = node;
    } else {
      node = this.waiting.pushBack(driver);
    }
    this.waitingByUser.set(driver.userId, node);
    return node;
  }

  /** O(1) removal of a waiting driver via the hash index. */
  removeWaiting(userId: string): LiveDriver | undefined {
    const node = this.waitingByUser.get(userId);
    if (!node) return undefined;
    this.detach(node);
    return node.value;
  }

  /** Front of the line. O(1). */
  popNext(): LiveDriver | undefined {
    const node = this.waiting.first;
    if (!node) return undefined;
    this.detach(node);
    return node.value;
  }

  /** Replace the waiting line wholesale (used after a merge). */
  rebuild(drivers: readonly LiveDriver[]): void {
    while (this.waiting.first) this.detach(this.waiting.first);
    drivers.forEach((driver) => this.enqueue(driver));
  }

  waitingDrivers(): LiveDriver[] {
    return this.waiting.toArray();
  }

  private detach(node: DListNode<LiveDriver>): void {
    if (node === this.lastUrgent) {
      const prev = node.prev;
      this.lastUrgent = prev && isUrgent(prev.value) ? prev : null;
    }
    this.waiting.unlink(node);
    this.waitingByUser.delete(node.value.userId);
  }
}

// ─── The service ────────────────────────────────────────────────────────────

export class QueueService {
  private readonly lines = new Map<string, StationLine>();
  private readonly locks = new Map<string, Promise<void>>();

  // ── reads ──

  async snapshot(stationId: string, viewerId?: string): Promise<QueueSnapshot> {
    return this.withLock(stationId, async () => {
      const station = await this.loadStation(stationId);
      const line = await this.loadLine(stationId);
      return this.buildSnapshot(station, line, viewerId, Date.now());
    });
  }

  async position(stationId: string, userId: string): Promise<YouView> {
    const snapshot = await this.snapshot(stationId, userId);
    if (!snapshot.you) throw ApiError.notFound('You are not in this station’s queue');
    return snapshot.you;
  }

  async report(stationId: string, top = 5): Promise<OperatorReport & { integrity: Record<string, boolean>; middle: QueueSnapshot['middle'] }> {
    return this.withLock(stationId, async () => {
      const station = await this.loadStation(stationId);
      const line = await this.loadLine(stationId);
      const now = Date.now();
      const snapshot = this.buildSnapshot(station, line, undefined, now);
      return {
        ...buildOperatorReport(line.waitingDrivers(), now, top),
        middle: snapshot.middle,
        integrity: {
          linkedListConsistent: line.waiting.isConsistent(),
          noCycle: !line.waiting.hasCycle(),
          indexMatchesList: line.waitingByUser.size === line.waiting.size,
        },
      };
    });
  }

  /**
   * The live line as scheduler jobs: charging cars first (arrival 0, their
   * remaining time), then waiting cars in line order, arrivals measured in
   * minutes from the earliest join.
   */
  async liveJobs(stationId: string): Promise<{ jobs: ChargeJob[]; usablePorts: number }> {
    return this.withLock(stationId, async () => {
      const station = await this.loadStation(stationId);
      const line = await this.loadLine(stationId);
      const now = Date.now();
      const all = [...line.charging.values(), ...line.waitingDrivers()];
      const origin = all.reduce((min, d) => Math.min(min, d.joinedAt), now);
      const jobs: ChargeJob[] = all.map((driver, index) => ({
        id: `car-${index + 1}`,
        label: driver.name ?? `Driver ${index + 1}`,
        arrival: driver.status === 'charging' ? 0 : Math.round((driver.joinedAt - origin) / 60_000),
        duration: Math.max(1, Math.round(driver.status === 'charging' ? remainingMinutes(driver, now) || 1 : driver.expectedChargeMinutes)),
        priority: urgencyScore(driver, now),
      }));
      return { jobs, usablePorts: usablePorts(station.ports) };
    });
  }

  // ── writes ──

  async join(stationId: string, user: AuthUser, options: JoinOptions = {}): Promise<{ change: QueueChange; entryId: string; startedCharging: boolean }> {
    return this.mutate(stationId, async () => {
      const station = await this.loadStation(stationId);
      const line = await this.loadLine(stationId);
      if (line.has(user.id)) throw ApiError.conflict('You are already in this station’s queue');
      if (usablePorts(station.ports) === 0) {
        throw ApiError.conflict('Every port at this station is faulted; the queue is closed');
      }

      const now = Date.now();
      const driver: LiveDriver = {
        id: '',
        userId: user.id,
        name: user.name,
        joinedAt: now,
        batteryPct: options.batteryPct ?? null,
        emergency: options.emergency ?? false,
        expectedChargeMinutes: options.expectedChargeMinutes ?? DEFAULT_CHARGE_MINUTES,
        status: 'waiting',
        portIndex: null,
        startedChargingAt: null,
        persistedPosition: 0,
      };

      // Estimate before inserting, as the driver would see it on the join screen.
      line.enqueue(driver);
      const preview = this.buildSnapshot(station, line, user.id, now);
      line.removeWaiting(user.id);

      let entryId: string;
      try {
        const entry = await QueueEntry.create({
          station: station._id,
          user: new Types.ObjectId(user.id),
          status: 'waiting',
          position: preview.you?.position ?? 0,
          joinedAt: new Date(now),
          estimatedWaitMinutesAtJoin: preview.you?.estimatedWaitMinutes ?? 0,
        });
        entryId = entry._id.toString();
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          // Another process holds a live entry for this user: our cache is stale.
          this.lines.delete(stationId);
          throw ApiError.conflict('You are already in this station’s queue');
        }
        throw error;
      }

      driver.id = entryId;
      driver.persistedPosition = preview.you?.position ?? 0;
      line.enqueue(driver);

      await this.allocateAndPersist(station, line, now);
      const change = this.buildChange(station, line, now);
      return { change, entryId, startedCharging: driver.status === 'charging' };
    });
  }

  /** Leave the line, or finish charging. Either way the next car moves up. */
  async leave(stationId: string, userId: string): Promise<{ change: QueueChange; left: 'waiting' | 'charging' }> {
    return this.mutate(stationId, async () => {
      const station = await this.loadStation(stationId, { allowInactive: true });
      const line = await this.loadLine(stationId);
      const now = Date.now();

      let left: 'waiting' | 'charging';
      const waiting = line.removeWaiting(userId);
      if (waiting) {
        left = 'waiting';
        await QueueEntry.updateOne(
          { _id: waiting.id },
          { status: 'cancelled', finishedAt: new Date(now) },
        ).exec();
      } else {
        const charging = line.charging.get(userId);
        if (!charging) throw ApiError.notFound('You are not in this station’s queue');
        left = 'charging';
        line.charging.delete(userId);
        if (charging.portIndex !== null) freePort(station, charging.portIndex);
        await QueueEntry.updateOne(
          { _id: charging.id },
          { status: 'completed', finishedAt: new Date(now), position: 0 },
        ).exec();
      }

      await this.allocateAndPersist(station, line, now);
      const change = this.buildChange(station, line, now);
      change.personal.push({ userId, view: { stationId, status: 'left', reason: left === 'charging' ? 'completed' : 'cancelled' } });
      return { change, left };
    });
  }

  /** Re-run slot allocation, e.g. after an operator freed a port by hand. */
  async allocate(stationId: string): Promise<{ change: QueueChange; started: number }> {
    return this.mutate(stationId, async () => {
      const station = await this.loadStation(stationId);
      const line = await this.loadLine(stationId);
      const now = Date.now();
      const before = line.charging.size;
      await this.allocateAndPersist(station, line, now);
      return { change: this.buildChange(station, line, now), started: line.charging.size - before };
    });
  }

  /**
   * A station's ports have faulted: move its whole waiting line into another
   * station's line (the nearest active one if no target is given), merging the
   * two with leftist heaps so seniority and urgency survive the move.
   */
  async mergeInto(
    sourceId: string,
    options: { targetStationId?: string; faultPorts?: boolean; canManage: (station: StationDocument) => boolean },
  ): Promise<{
    source: QueueChange;
    target: QueueChange;
    moved: number;
    skippedDuplicates: number;
    targetDistanceKm: number;
    merge: MergeResult<LiveDriver>['stats'];
  }> {
    const sourceStation = await this.loadStation(sourceId, { allowInactive: true });
    const targetStation = options.targetStationId
      ? await this.loadStation(options.targetStationId)
      : await this.nearestActiveStation(sourceStation);
    const targetId = targetStation._id.toString();
    if (targetId === sourceId) throw ApiError.badRequest('A station cannot merge its queue into itself');
    if (!options.canManage(targetStation)) {
      throw ApiError.forbidden('You do not manage the target station');
    }

    const [first, second] = [sourceId, targetId].sort();
    return this.mutate(first, () =>
      this.mutate(second, async () => {
        // Re-read inside the locks: the documents above may be stale by now.
        const source = await this.loadStation(sourceId, { allowInactive: true });
        const target = await this.loadStation(targetId);
        const sourceLine = await this.loadLine(sourceId);
        const targetLine = await this.loadLine(targetId);
        const now = Date.now();

        const incoming: LiveDriver[] = [];
        const duplicates: LiveDriver[] = [];
        for (const driver of sourceLine.waitingDrivers()) {
          (targetLine.has(driver.userId) ? duplicates : incoming).push(driver);
        }

        const result = mergeWaitingLines(targetLine.waitingDrivers(), incoming);
        sourceLine.rebuild([]);
        targetLine.rebuild(result.merged);

        const ops: Parameters<typeof QueueEntry.bulkWrite>[0] = [
          ...incoming.map((driver) => ({
            updateOne: { filter: { _id: driver.id }, update: { $set: { station: target._id } } },
          })),
          ...duplicates.map((driver) => ({
            updateOne: {
              filter: { _id: driver.id },
              update: { $set: { status: 'cancelled' as const, finishedAt: new Date(now) } },
            },
          })),
        ];
        if (ops.length) await QueueEntry.bulkWrite(ops);

        if (options.faultPorts) {
          source.ports.forEach((port) => {
            if (port.status === 'free') source.setPortStatus(port.index, 'faulted');
          });
        }

        await this.allocateAndPersist(source, sourceLine, now);
        await this.allocateAndPersist(target, targetLine, now);

        const sourceChange = this.buildChange(source, sourceLine, now);
        const targetChange = this.buildChange(target, targetLine, now);
        const movedIds = new Set(incoming.map((d) => d.userId));
        targetChange.personal.forEach(({ userId, view }) => {
          if (movedIds.has(userId)) view.movedFrom = sourceId;
        });
        duplicates.forEach((d) =>
          sourceChange.personal.push({
            userId: d.userId,
            view: { stationId: sourceId, status: 'left', reason: 'merged-duplicate' },
          }),
        );
        incoming.forEach((d) =>
          sourceChange.personal.push({
            userId: d.userId,
            view: { stationId: sourceId, status: 'left', reason: `moved-to:${targetId}` },
          }),
        );

        return {
          source: sourceChange,
          target: targetChange,
          moved: incoming.length,
          skippedDuplicates: duplicates.length,
          targetDistanceKm:
            Math.round(haversineKm(source.toIndexed().location, target.toIndexed().location) * 1000) / 1000,
          merge: result.stats,
        };
      }),
    );
  }

  /** Forget every cached line. Tests call this between cases. */
  reset(): void {
    this.lines.clear();
    this.locks.clear();
  }

  /** Drop one station's cached line, forcing a rehydrate on next touch. */
  forget(stationId: string): void {
    this.lines.delete(stationId);
  }

  // ── internals ──

  /** withLock, plus: if a write fails half-way, drop the cached line so the
   *  next request rehydrates from MongoDB instead of trusting a diverged copy. */
  private async mutate<R>(key: string, work: () => Promise<R>): Promise<R> {
    return this.withLock(key, async () => {
      try {
        return await work();
      } catch (error) {
        this.lines.delete(key);
        throw error;
      }
    });
  }

  private async withLock<R>(key: string, work: () => Promise<R>): Promise<R> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current);
    this.locks.set(key, chained);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  private async loadStation(stationId: string, options: { allowInactive?: boolean } = {}): Promise<StationDocument> {
    const station = await Station.findById(stationId).exec();
    if (!station || (!station.isActive && !options.allowInactive)) throw ApiError.notFound('Station not found');
    return station;
  }

  private async nearestActiveStation(source: StationDocument): Promise<StationDocument> {
    const nearest = await Station.findOne({
      _id: { $ne: source._id },
      isActive: true,
      location: { $near: { $geometry: source.location } },
    }).exec();
    if (!nearest) throw ApiError.notFound('No other active station to merge into');
    return nearest;
  }

  /** Lazy rehydrate from MongoDB, in stored position order. */
  private async loadLine(stationId: string): Promise<StationLine> {
    const cached = this.lines.get(stationId);
    if (cached) return cached;

    const entries = await QueueEntry.find({ station: stationId, status: { $in: ['waiting', 'charging'] } })
      .populate<{ user: { _id: Types.ObjectId; name?: string } | null }>('user', 'name')
      .sort({ position: 1, joinedAt: 1 })
      .exec();

    const line = new StationLine();
    for (const entry of entries) {
      const user = entry.user;
      if (!user) continue; // user deleted - ignore the orphaned row
      const driver: LiveDriver = {
        id: entry._id.toString(),
        userId: user._id.toString(),
        ...(user.name ? { name: user.name } : {}),
        joinedAt: entry.joinedAt.getTime(),
        batteryPct: null,
        emergency: false,
        expectedChargeMinutes: DEFAULT_CHARGE_MINUTES,
        status: entry.status === 'charging' ? 'charging' : 'waiting',
        portIndex: entry.portIndex ?? null,
        startedChargingAt: entry.startedChargingAt ? entry.startedChargingAt.getTime() : null,
        persistedPosition: entry.position,
      };
      if (driver.status === 'charging') line.charging.set(driver.userId, driver);
      else line.enqueue(driver);
    }
    this.lines.set(stationId, line);
    return line;
  }

  /**
   * Hand free ports to the front of the line, persist positions, write the
   * denormalised queueLength and port board, and keep the index in step.
   */
  private async allocateAndPersist(station: StationDocument, line: StationLine, now: number): Promise<void> {
    const ops: Parameters<typeof QueueEntry.bulkWrite>[0] = [];

    for (const port of [...station.ports].sort((a, b) => a.index - b.index)) {
      if (line.waiting.isEmpty) break;
      if (port.status !== 'free') continue;
      const driver = line.popNext() as LiveDriver;
      station.setPortStatus(port.index, 'occupied');
      driver.status = 'charging';
      driver.portIndex = port.index;
      driver.startedChargingAt = now;
      driver.persistedPosition = 0;
      line.charging.set(driver.userId, driver);
      ops.push({
        updateOne: {
          filter: { _id: driver.id },
          update: { $set: { status: 'charging', position: 0, portIndex: port.index, startedChargingAt: new Date(now) } },
        },
      });
    }

    line.waiting.forEach((driver, index) => {
      const position = index + 1;
      if (driver.persistedPosition !== position) {
        driver.persistedPosition = position;
        ops.push({ updateOne: { filter: { _id: driver.id }, update: { $set: { position } } } });
      }
    });
    if (ops.length) await QueueEntry.bulkWrite(ops);

    station.queueLength = line.waiting.size;
    await station.save();
    // THE RULE: queueLength and free ports feed the recommendation score.
    if (station.isActive) stationIndex.upsert(station.toIndexed());
    else stationIndex.remove(station._id.toString());
  }

  private buildSnapshot(station: StationDocument, line: StationLine, viewerId: string | undefined, now: number): QueueSnapshot {
    const stationId = station._id.toString();
    const chargingByPort = new Map<number, LiveDriver>();
    line.charging.forEach((driver) => {
      if (driver.portIndex !== null) chargingByPort.set(driver.portIndex, driver);
    });

    // Minutes until each usable port frees up.
    const portFreeIn: number[] = [];
    for (const port of station.ports) {
      if (port.status === 'faulted') continue;
      if (port.status === 'free') portFreeIn.push(0);
      else {
        const driver = chargingByPort.get(port.index);
        portFreeIn.push(driver ? remainingMinutes(driver, now) : UNKNOWN_SESSION_REMAINING_MINUTES);
      }
    }

    const waitingDrivers = line.waitingDrivers();
    const estimates = estimateWaits(portFreeIn, waitingDrivers.map((d) => d.expectedChargeMinutes));
    const finite = (value: number | undefined): number | null =>
      value === undefined || !Number.isFinite(value) ? null : value;

    const waiting = waitingDrivers.map((driver, index) => ({
      position: index + 1,
      joinedAt: new Date(driver.joinedAt).toISOString(),
      estimatedWaitMinutes: finite(estimates[index]),
      urgent: isUrgent(driver),
      you: driver.userId === viewerId,
    }));

    const charging = [...line.charging.values()]
      .sort((a, b) => (a.portIndex ?? 0) - (b.portIndex ?? 0))
      .map((driver) => ({
        portIndex: driver.portIndex ?? -1,
        startedAt: driver.startedChargingAt ? new Date(driver.startedChargingAt).toISOString() : null,
        expectedRemainingMinutes: Math.round(remainingMinutes(driver, now)),
        you: driver.userId === viewerId,
      }));

    // Fast/slow pointers find the middle in one pass.
    const middleNode = line.waiting.middleNode();
    const middle = middleNode
      ? (() => {
          const position = line.waiting.positionOf(middleNode) + 1;
          return { position, estimatedWaitMinutes: finite(estimates[position - 1]) };
        })()
      : null;

    return {
      stationId,
      stationName: station.name,
      totalPorts: station.ports.length,
      freePorts: station.ports.filter((p) => p.status === 'free').length,
      usablePorts: portFreeIn.length,
      queueLength: line.waiting.size,
      charging,
      waiting,
      middle,
      you: viewerId ? this.viewFor(stationId, line, viewerId, waiting, now) : null,
      updatedAt: new Date(now).toISOString(),
    };
  }

  private viewFor(
    stationId: string,
    line: StationLine,
    userId: string,
    waiting: QueueSnapshot['waiting'],
    now: number,
  ): YouView | null {
    const node = line.waitingByUser.get(userId);
    if (node) {
      const position = line.waiting.positionOf(node) + 1;
      const row = waiting[position - 1];
      return {
        stationId,
        status: 'waiting',
        position,
        carsAhead: position - 1,
        estimatedWaitMinutes: row?.estimatedWaitMinutes ?? undefined,
        urgent: isUrgent(node.value),
      } as YouView;
    }
    const charging = line.charging.get(userId);
    if (charging) {
      return {
        stationId,
        status: 'charging',
        portIndex: charging.portIndex ?? undefined,
        expectedRemainingMinutes: Math.round(remainingMinutes(charging, now)),
      } as YouView;
    }
    return null;
  }

  private buildChange(station: StationDocument, line: StationLine, now: number): QueueChange {
    const stationId = station._id.toString();
    const snapshot = this.buildSnapshot(station, line, undefined, now);
    const personal: QueueChange['personal'] = [];
    line.waiting.forEach((driver, index) => {
      personal.push({
        userId: driver.userId,
        view: {
          stationId,
          status: 'waiting',
          position: index + 1,
          carsAhead: index,
          ...(snapshot.waiting[index]?.estimatedWaitMinutes !== null
            ? { estimatedWaitMinutes: snapshot.waiting[index].estimatedWaitMinutes as number }
            : {}),
          urgent: isUrgent(driver),
        },
      });
    });
    line.charging.forEach((driver) => {
      personal.push({
        userId: driver.userId,
        view: {
          stationId,
          status: 'charging',
          ...(driver.portIndex !== null ? { portIndex: driver.portIndex } : {}),
          expectedRemainingMinutes: Math.round(remainingMinutes(driver, now)),
        },
      });
    });
    return {
      stationId,
      snapshot,
      ports: {
        stationId,
        totalPorts: station.ports.length,
        freePorts: station.ports.filter((p) => p.status === 'free').length,
        ports: station.ports.map((p) => ({
          index: p.index,
          status: p.status,
          connectorType: p.connectorType,
          powerKw: p.powerKw,
        })),
      },
      personal,
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function remainingMinutes(driver: LiveDriver, now: number): number {
  if (driver.startedChargingAt === null) return driver.expectedChargeMinutes;
  const elapsed = (now - driver.startedChargingAt) / 60_000;
  return Math.max(0, driver.expectedChargeMinutes - elapsed);
}

function usablePorts(ports: readonly Port[]): number {
  return ports.filter((p) => p.status !== 'faulted').length;
}

/** Free a port only if it is occupied - never "repair" a faulted one by accident. */
function freePort(station: StationDocument, portIndex: number): void {
  const port = station.ports.find((p) => p.index === portIndex);
  if (port && port.status === 'occupied') station.setPortStatus(portIndex, 'free');
}

/**
 * Process-wide singleton, like `stationIndex`: a per-request queue is not a
 * queue.
 */
export const queueService = new QueueService();
export default queueService;
