/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * index.routes.ts — /api/index
 *
 * Stats are public (they are the demo surface for the data structures);
 * anything that mutates the index is admin-only.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import * as indexControl from '../controllers/indexController';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/stats', asyncHandler(indexControl.indexStats));

router.post(
  '/rebuild',
  requireAuth,
  requireRole('admin'),
  asyncHandler(indexControl.rebuildIndex),
);

router.post(
  '/rebalance',
  requireAuth,
  requireRole('admin'),
  asyncHandler(indexControl.rebalanceIndex),
);

export default router;
