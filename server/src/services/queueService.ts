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
 *  Postgres (`queue_entries`) is the durable log; this service is the hot
 *  path. Every mutation, in one database transaction:
 *      1. updates the in-memory line,
 *      2. persists the affected QueueEntry rows (status, port, position),
 *      3. writes `Station.queueLength` and any port flips,
 *      4. calls `stationIndex.upsert()` - queueLength and free ports feed the
 *         recommendation score, so a socket push alone is not enough,
 *  and then the controller broadcasts the change over Socket.IO.
 *
 *  The line is rehydrated from Postgres on every request, in stored
 *  `position` order. On serverless hosting many instances serve the API, so
 *  an in-memory copy could not be trusted between requests.
 *
 *  CONCURRENCY
 *  -----------
 *  Each mutation runs in a transaction that first locks the station's row
 *  (`select ... for update`), so two requests for the same station - even on
 *  different serverless instances - run one after the other. Within one
 *  process a promise-chain mutex per station also keeps them in order. The
 *  merge operation locks both stations in id order, so two opposite merges
 *  cannot deadlock. Urgency details (battery %, emergency, expected charge
 *  minutes) are stored on the entry, so priorities survive between requests.
 * ============================================================================
 */

import { DoublyLinkedList, type DListNode } from '../datastructures/LinkedList';
import { Stations, setPortStatus, toIndexed, type Station } from '../models/Station';
import { QueueEntries } from '../models/QueueEntry';
import { db, type Queryable } from '../config/db';
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
  /** Last position written to Postgres, so unchanged rows are not rewritten. */
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
  private readonly locks = new Map<string, Promise<void>>();

  // ── reads ──

  async snapshot(stationId: string, viewerId?: string): Promise<QueueSnapshot> {
    return this.withLock(stationId, async () => {
      const station = await this.loadStation(db, stationId);
      const line = await this.loadLine(db, stationId);
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
      const station = await this.loadStation(db, stationId);
      const line = await this.loadLine(db, stationId);
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
      const station = await this.loadStation(db, stationId);
      const line = await this.loadLine(db, stationId);
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
    return this.mutate(stationId, async (q) => {
      const station = await this.loadStation(q, stationId);
      const line = await this.loadLine(q, stationId);
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
        entryId = await QueueEntries.create(q, {
          stationId: station.id,
          userId: user.id,
          position: preview.you?.position ?? 0,
          joinedAt: new Date(now),
          estimatedWaitMinutesAtJoin: preview.you?.estimatedWaitMinutes ?? 0,
          batteryPct: driver.batteryPct,
          emergency: driver.emergency,
          expectedChargeMinutes: driver.expectedChargeMinutes,
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          // The partial unique index: this user already has a live entry here.
          throw ApiError.conflict('You are already in this station’s queue');
        }
        throw error;
      }

      driver.id = entryId;
      driver.persistedPosition = preview.you?.position ?? 0;
      line.enqueue(driver);

      await this.allocateAndPersist(q, station, line, now);
      const change = this.buildChange(station, line, now);
      return { change, entryId, startedCharging: driver.status === 'charging' };
    });
  }

  /** Leave the line, or finish charging. Either way the next car moves up. */
  async leave(stationId: string, userId: string): Promise<{ change: QueueChange; left: 'waiting' | 'charging' }> {
    return this.mutate(stationId, async (q) => {
      const station = await this.loadStation(q, stationId, { allowInactive: true });
      const line = await this.loadLine(q, stationId);
      const now = Date.now();

      let left: 'waiting' | 'charging';
      const waiting = line.removeWaiting(userId);
      if (waiting) {
        left = 'waiting';
        await QueueEntries.finish(q, waiting.id, 'cancelled', new Date(now));
      } else {
        const charging = line.charging.get(userId);
        if (!charging) throw ApiError.notFound('You are not in this station’s queue');
        left = 'charging';
        line.charging.delete(userId);
        if (charging.portIndex !== null) freePort(station, charging.portIndex);
        await QueueEntries.finish(q, charging.id, 'completed', new Date(now));
      }

      await this.allocateAndPersist(q, station, line, now);
      const change = this.buildChange(station, line, now);
      change.personal.push({ userId, view: { stationId, status: 'left', reason: left === 'charging' ? 'completed' : 'cancelled' } });
      return { change, left };
    });
  }

  /** Re-run slot allocation, e.g. after an operator freed a port by hand. */
  async allocate(stationId: string): Promise<{ change: QueueChange; started: number }> {
    return this.mutate(stationId, async (q) => {
      const station = await this.loadStation(q, stationId);
      const line = await this.loadLine(q, stationId);
      const now = Date.now();
      const before = line.charging.size;
      await this.allocateAndPersist(q, station, line, now);
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
    options: { targetStationId?: string; faultPorts?: boolean; canManage: (station: Station) => boolean },
  ): Promise<{
    source: QueueChange;
    target: QueueChange;
    moved: number;
    skippedDuplicates: number;
    targetDistanceKm: number;
    merge: MergeResult<LiveDriver>['stats'];
  }> {
    const sourceStation = await this.loadStation(db, sourceId, { allowInactive: true });
    const targetStation = options.targetStationId
      ? await this.loadStation(db, options.targetStationId)
      : await this.nearestActiveStation(sourceStation);
    const targetId = targetStation.id;
    if (targetId === sourceId) throw ApiError.badRequest('A station cannot merge its queue into itself');
    if (!options.canManage(targetStation)) {
      throw ApiError.forbidden('You do not manage the target station');
    }

    const [first, second] = [sourceId, targetId].sort();
    return this.withLock(first, () =>
      this.mutate(second, async (q) => {
        // Lock both rows in id order, then re-read: the stations above may be stale by now.
        await this.loadStation(q, first, { allowInactive: true });
        await this.loadStation(q, second, { allowInactive: true });
        const source = await this.loadStation(q, sourceId, { allowInactive: true });
        const target = await this.loadStation(q, targetId);
        const sourceLine = await this.loadLine(q, sourceId);
        const targetLine = await this.loadLine(q, targetId);
        const now = Date.now();

        const incoming: LiveDriver[] = [];
        const duplicates: LiveDriver[] = [];
        for (const driver of sourceLine.waitingDrivers()) {
          (targetLine.has(driver.userId) ? duplicates : incoming).push(driver);
        }

        const result = mergeWaitingLines(targetLine.waitingDrivers(), incoming);
        sourceLine.rebuild([]);
        targetLine.rebuild(result.merged);

        await QueueEntries.moveTo(q, incoming.map((driver) => driver.id), target.id);
        for (const driver of duplicates) await QueueEntries.finish(q, driver.id, 'cancelled', new Date(now));

        if (options.faultPorts) {
          source.ports.forEach((port) => {
            if (port.status === 'free') setPortStatus(source, port.index, 'faulted');
          });
        }

        await this.allocateAndPersist(q, source, sourceLine, now);
        await this.allocateAndPersist(q, target, targetLine, now);

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
            Math.round(haversineKm(toIndexed(source).location, toIndexed(target).location) * 1000) / 1000,
          merge: result.stats,
        };
      }),
    );
  }

  /** Drop the in-process locks. Tests call this between cases. */
  reset(): void {
    this.locks.clear();
  }

  // ── internals ──

  /** withLock, plus one database transaction around the work: a write that
   *  fails half-way rolls back entirely. */
  private async mutate<R>(key: string, work: (q: Queryable) => Promise<R>): Promise<R> {
    return this.withLock(key, () => db.tx(work));
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

  /** Inside a transaction (`q` from mutate) this also locks the station's row. */
  private async loadStation(q: Queryable, stationId: string, options: { allowInactive?: boolean } = {}): Promise<Station> {
    const station = q === db ? await Stations.findById(stationId) : await Stations.findByIdForUpdate(stationId, q);
    if (!station || (!station.isActive && !options.allowInactive)) throw ApiError.notFound('Station not found');
    return station;
  }

  private async nearestActiveStation(source: Station): Promise<Station> {
    const [lng, lat] = source.location.coordinates;
    const nearest = await Stations.nearestActive(source.id, { lat, lng });
    if (!nearest) throw ApiError.notFound('No other active station to merge into');
    return nearest;
  }

  /** Rehydrate the live line from Postgres, in stored position order. */
  private async loadLine(q: Queryable, stationId: string): Promise<StationLine> {
    const entries = await QueueEntries.live(q, stationId);

    const line = new StationLine();
    for (const entry of entries) {
      const driver: LiveDriver = {
        id: entry.id,
        userId: entry.userId,
        ...(entry.userName ? { name: entry.userName } : {}),
        joinedAt: entry.joinedAt.getTime(),
        batteryPct: entry.batteryPct,
        emergency: entry.emergency,
        expectedChargeMinutes: entry.expectedChargeMinutes ?? DEFAULT_CHARGE_MINUTES,
        status: entry.status === 'charging' ? 'charging' : 'waiting',
        portIndex: entry.portIndex,
        startedChargingAt: entry.startedChargingAt ? entry.startedChargingAt.getTime() : null,
        persistedPosition: entry.position,
      };
      if (driver.status === 'charging') line.charging.set(driver.userId, driver);
      else line.enqueue(driver);
    }
    return line;
  }

  /**
   * Hand free ports to the front of the line, persist positions, write the
   * denormalised queueLength and port board, and keep the index in step.
   */
  private async allocateAndPersist(q: Queryable, station: Station, line: StationLine, now: number): Promise<void> {

    for (const port of [...station.ports].sort((a, b) => a.index - b.index)) {
      if (line.waiting.isEmpty) break;
      if (port.status !== 'free') continue;
      const driver = line.popNext() as LiveDriver;
      setPortStatus(station, port.index, 'occupied');
      driver.status = 'charging';
      driver.portIndex = port.index;
      driver.startedChargingAt = now;
      driver.persistedPosition = 0;
      line.charging.set(driver.userId, driver);
      await QueueEntries.startCharging(q, driver.id, port.index, new Date(now));
    }

    const moved: { id: string; position: number }[] = [];
    line.waiting.forEach((driver, index) => {
      const position = index + 1;
      if (driver.persistedPosition !== position) {
        driver.persistedPosition = position;
        moved.push({ id: driver.id, position });
      }
    });
    await QueueEntries.setPositions(q, moved);

    station.queueLength = line.waiting.size;
    await Stations.save(station, q);
    // THE RULE: queueLength and free ports feed the recommendation score.
    if (station.isActive) stationIndex.upsert(toIndexed(station));
    else stationIndex.remove(station.id);
  }

  private buildSnapshot(station: Station, line: StationLine, viewerId: string | undefined, now: number): QueueSnapshot {
    const stationId = station.id;
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

  private buildChange(station: Station, line: StationLine, now: number): QueueChange {
    const stationId = station.id;
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
function freePort(station: Station, portIndex: number): void {
  const port = station.ports.find((p) => p.index === portIndex);
  if (port && port.status === 'occupied') setPortStatus(station, portIndex, 'free');
}

/**
 * Process-wide singleton, like `stationIndex`: a per-request queue is not a
 * queue.
 */
export const queueService = new QueueService();
export default queueService;
