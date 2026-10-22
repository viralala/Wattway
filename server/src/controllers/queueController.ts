/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  queueController.ts - /api/queue request handlers.
 *
 *  Thin by design: the line lives in `services/queueService.ts`, the maths in
 *  `algorithms/scheduler.ts` and `algorithms/queueAnalytics.ts`. Every handler
 *  that changes a line hands the resulting `QueueChange` to
 *  `broadcastQueueChange()` so connected clients hear about it at once.
 *
 *  Index coherence (followthis.md section 6) is handled inside the service:
 *  each mutation writes `Station.queueLength` / the port board and calls
 *  `stationIndex.upsert()` before it returns.
 * ============================================================================
 */

import type { Request, Response } from 'express';
import { queueService, type JoinOptions } from '../services/queueService';
import { broadcastQueueChange } from '../sockets/queueHandlers';
import { currentUser } from '../middleware/auth';
import { created, ok } from '../utils/respond';
import { ApiError } from '../utils/ApiError';
import {
  DEMO_JOBS,
  SCHEDULING_POLICIES,
  compareSchedules,
  simulateSchedule,
  type ChargeJob,
  type SchedulingPolicy,
} from '../algorithms/scheduler';
import { josephus, josephusSurvivorIndex } from '../datastructures/LinkedList';
import type { StationDocument } from '../models/Station';

/** GET /api/queue/:stationId — public; personalised when signed in. */
export async function getQueue(req: Request, res: Response): Promise<void> {
  const snapshot = await queueService.snapshot(req.params.stationId, req.user?.id);
  ok(res, { queue: snapshot });
}

/** GET /api/queue/:stationId/position — your own place. */
export async function getPosition(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const you = await queueService.position(req.params.stationId, user.id);
  ok(res, { you });
}

/** POST /api/queue/:stationId/join */
export async function join(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = (req.body ?? {}) as JoinOptions;
  const { change, entryId, startedCharging } = await queueService.join(req.params.stationId, user, body);
  broadcastQueueChange(change);

  const you = change.personal.find((p) => p.userId === user.id)?.view ?? null;
  const queue = {
    ...change.snapshot,
    waiting: change.snapshot.waiting.map((row) => ({ ...row, you: you?.status === 'waiting' && row.position === you.position })),
    charging: change.snapshot.charging.map((row) => ({ ...row, you: you?.status === 'charging' && row.portIndex === you.portIndex })),
    you,
  };
  created(res, { entryId, startedCharging, you, queue });
}

/** DELETE /api/queue/:stationId/leave — leave the line, or finish charging. */
export async function leave(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { change, left } = await queueService.leave(req.params.stationId, user.id);
  broadcastQueueChange(change);
  ok(res, { left, queue: change.snapshot });
}

/** POST /api/queue/:stationId/allocate — operator: hand free ports to the line. */
export async function allocate(req: Request, res: Response): Promise<void> {
  const { change, started } = await queueService.allocate(req.params.stationId);
  broadcastQueueChange(change);
  ok(res, { started, queue: change.snapshot });
}

/** GET /api/queue/:stationId/report — operator: heapsort, max-heap, DEPQ. */
export async function report(req: Request, res: Response): Promise<void> {
  const { top = 5 } = req.query as unknown as { top?: number };
  const result = await queueService.report(req.params.stationId, top);
  ok(res, { report: result });
}

/**
 * GET /api/queue/:stationId/simulate?policy=fifo|priority|round-robin|compare
 *
 * Runs the charger-slot scheduler on this station's live line (or a fixed demo
 * set when the line is empty, or when `source=demo`).
 */
export async function simulate(req: Request, res: Response): Promise<void> {
  const { policy = 'compare', source = 'auto', quantum = 15, ports } = req.query as unknown as {
    policy?: SchedulingPolicy | 'compare';
    source?: 'auto' | 'live' | 'demo';
    quantum?: number;
    ports?: number;
  };

  const live = await queueService.liveJobs(req.params.stationId);
  let jobs: readonly ChargeJob[] = live.jobs;
  let usedSource: 'live' | 'demo' = 'live';
  if (source === 'demo' || (source === 'auto' && live.jobs.length === 0)) {
    jobs = DEMO_JOBS;
    usedSource = 'demo';
  }
  const portCount = ports ?? (usedSource === 'demo' ? 2 : Math.max(1, live.usablePorts));

  if (jobs.length === 0) {
    ok(res, { source: usedSource, ports: portCount, jobs: [], message: 'The line is empty — try source=demo' });
    return;
  }

  if (policy === 'compare') {
    const comparison = compareSchedules(jobs, portCount, quantum);
    ok(res, { source: usedSource, ports: portCount, policies: SCHEDULING_POLICIES, ...comparison });
    return;
  }

  ok(res, { source: usedSource, ports: portCount, result: simulateSchedule(jobs, { policy, ports: portCount, quantum }) });
}

/** POST /api/queue/:stationId/merge — operator: a station faulted, move its line. */
export async function merge(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { targetStationId, faultPorts = false } = req.body as { targetStationId?: string; faultPorts?: boolean };

  const canManage = (station: StationDocument): boolean =>
    user.role === 'admin' || (station.managedBy !== undefined && station.managedBy?.toString() === user.id);

  const result = await queueService.mergeInto(req.params.stationId, {
    ...(targetStationId ? { targetStationId } : {}),
    faultPorts,
    canManage,
  });
  broadcastQueueChange(result.source);
  broadcastQueueChange(result.target);

  ok(res, {
    moved: result.moved,
    skippedDuplicates: result.skippedDuplicates,
    targetDistanceKm: result.targetDistanceKm,
    leftistHeap: result.merge,
    source: result.source.snapshot,
    target: result.target.snapshot,
  });
}

/** GET /api/queue/demo/josephus?n=7&k=3 — the classic, on the circular list. */
export async function josephusDemo(req: Request, res: Response): Promise<void> {
  const { n, k } = req.query as unknown as { n: number; k: number };
  const people = Array.from({ length: n }, (_, i) => i + 1);
  const { order, survivor } = josephus(people, k);
  const formula = josephusSurvivorIndex(n, k) + 1;
  if (formula !== survivor) throw ApiError.internal('Josephus simulation disagrees with the recurrence');
  ok(res, { n, k, eliminationOrder: order, survivor, recurrenceSurvivor: formula });
}
