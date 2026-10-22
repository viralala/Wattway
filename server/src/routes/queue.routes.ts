/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  queue.routes.ts - /api/queue
 *
 *  Reading a line is public (the map shows live queue lengths to signed-out
 *  visitors). Joining and leaving need a signed-in user. Operator tools need
 *  the operator who manages that station, or an admin.
 *
 *  `/demo/...` is mounted before `/:stationId` so "demo" is never parsed as a
 *  station id (it would fail the ObjectId check anyway).
 * ============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import * as queue from '../controllers/queueController';
import { asyncHandler } from '../middleware/asyncHandler';
import { optionalAuth, requireAuth, requireStationAccess } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { SCHEDULING_POLICIES } from '../algorithms/scheduler';
import { zBool, zObjectId } from '../utils/zod';

const router = Router();

const stationParams = z.object({ stationId: zObjectId });

const joinSchema = z
  .object({
    /** Current state of charge. Under 5 % counts as urgent. */
    batteryPct: z.number().min(0).max(100).optional(),
    /** Emergency vehicle — jumps ahead of ordinary drivers. */
    emergency: z.boolean().optional(),
    /** How long the driver expects to charge; feeds wait estimates. */
    expectedChargeMinutes: z.number().int().min(5).max(240).optional(),
  })
  .strict();

const simulateQuery = z.object({
  policy: z.enum([...SCHEDULING_POLICIES, 'compare']).default('compare'),
  source: z.enum(['auto', 'live', 'demo']).default('auto'),
  quantum: z.coerce.number().int().min(1).max(120).default(15),
  ports: z.coerce.number().int().min(1).max(32).optional(),
});

const reportQuery = z.object({ top: z.coerce.number().int().min(1).max(50).default(5) });

const mergeSchema = z
  .object({
    /** Omit to merge into the nearest active station. */
    targetStationId: zObjectId.optional(),
    /** Also mark the source's free ports as faulted. */
    faultPorts: zBool.optional(),
  })
  .strict();

const josephusQuery = z.object({
  n: z.coerce.number().int().min(1).max(1000).default(7),
  k: z.coerce.number().int().min(1).max(1000).default(3),
});

// ─── Demo (no station, no database) ─────────────────────────────────────────

router.get('/demo/josephus', validate({ query: josephusQuery }), asyncHandler(queue.josephusDemo));

// ─── Driver-facing ──────────────────────────────────────────────────────────

router.get('/:stationId', optionalAuth, validate({ params: stationParams }), asyncHandler(queue.getQueue));

router.get(
  '/:stationId/position',
  requireAuth,
  validate({ params: stationParams }),
  asyncHandler(queue.getPosition),
);

router.post(
  '/:stationId/join',
  requireAuth,
  validate({ params: stationParams, body: joinSchema }),
  asyncHandler(queue.join),
);

router.delete('/:stationId/leave', requireAuth, validate({ params: stationParams }), asyncHandler(queue.leave));

/** Job-scheduling demo (Lab 6). Public: it reveals no identities. */
router.get(
  '/:stationId/simulate',
  validate({ params: stationParams, query: simulateQuery }),
  asyncHandler(queue.simulate),
);

// ─── Operator tools ─────────────────────────────────────────────────────────

router.get(
  '/:stationId/report',
  requireAuth,
  validate({ params: stationParams, query: reportQuery }),
  requireStationAccess('stationId'),
  asyncHandler(queue.report),
);

router.post(
  '/:stationId/allocate',
  requireAuth,
  validate({ params: stationParams }),
  requireStationAccess('stationId'),
  asyncHandler(queue.allocate),
);

router.post(
  '/:stationId/merge',
  requireAuth,
  validate({ params: stationParams, body: mergeSchema }),
  requireStationAccess('stationId'),
  asyncHandler(queue.merge),
);

export default router;
