/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * algorithm.routes.ts — /api/algorithms (the Algorithm Lab)
 *
 * Public and database-free. The caps below exist because Floyd-Warshall is
 * O(V³) and Held-Karp is O(k²·2ᵏ): an unbounded request would be a cheap way to
 * pin a CPU core.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import { z } from 'zod';
import * as lab from '../controllers/algorithmController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { ALGORITHM_IDS, MAX_TSP_STOPS } from '../algorithms/lab';
import { zNumber } from '../utils/zod';

const router = Router();

const MAX_NODES = 500;
const nodeIdSchema = z.string().regex(/^n\d+$/, "Node ids look like 'n12'");
const seedSchema = z.coerce.number().int().min(0).max(2_147_483_647);
const nodesSchema = z.coerce.number().int().min(5).max(MAX_NODES);
const regenSchema = zNumber.min(0).max(1);

const compareBody = z
  .object({
    nodes: nodesSchema.default(40),
    seed: seedSchema.default(1),
    mode: z.enum(['distance', 'energy']).default('distance'),
    regenStrength: regenSchema.default(0.6),
    astarWeight: zNumber.min(1).max(10).default(1),
    start: nodeIdSchema.optional(),
    end: nodeIdSchema.optional(),
    stops: z.array(nodeIdSchema).min(3).max(MAX_TSP_STOPS).optional(),
    algorithms: z.array(z.enum(ALGORITHM_IDS)).min(1).optional(),
  })
  .refine((body) => (body.start === undefined) === (body.end === undefined), 'start and end must be supplied together')
  .refine((body) => body.start !== undefined || body.stops !== undefined, 'Provide start+end and/or stops');

const graphQuery = z.object({
  nodes: nodesSchema.default(40),
  seed: seedSchema.default(1),
  regenStrength: regenSchema.default(0.6),
});

const benchmarkBody = z.object({
  sizes: z.array(z.coerce.number().int().min(5).max(400)).min(1).max(8).default([20, 50, 100, 200, 400]),
  seed: seedSchema.default(1),
  mode: z.enum(['distance', 'energy']).default('distance'),
  regenStrength: regenSchema.default(0.6),
  repeats: z.coerce.number().int().min(1).max(9).default(3),
});

router.post('/compare', validate({ body: compareBody }), asyncHandler(lab.compare));
router.get('/graph', validate({ query: graphQuery }), asyncHandler(lab.graph));
router.post('/benchmark', validate({ body: benchmarkBody }), asyncHandler(lab.runBenchmark));

export default router;
