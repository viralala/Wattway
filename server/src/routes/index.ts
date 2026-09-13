/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Indexing & Backend
 * ============================================================================
 *
 *  routes/index.ts — the single place every API route is mounted.
 *
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  IF YOU ARE ADDING A MODULE, THIS IS YOUR FILE. READ THIS BOX.       │
 *  ├──────────────────────────────────────────────────────────────────────┤
 *  │  1. Create `src/routes/<yours>.routes.ts` exporting a default Router.│
 *  │  2. Import it below.                                                 │
 *  │  3. Replace the matching `pendingRouter(...)` line with your mount.  │
 *  │  4. Update the endpoint list in controllers/metaController.ts.       │
 *  │                                                                      │
 *  │  Do NOT mount routes anywhere else — not in app.ts, not from inside  │
 *  │  a controller. One file, one list, no surprises.                     │
 *  └──────────────────────────────────────────────────────────────────────┘
 *
 *  Routes that are not built yet are mounted as *pending* routers rather than
 *  left absent. A pending route answers 501 with the name of the module that
 *  owes it, which means the client team can code against the final URLs today
 *  and gets a message that says who to chase instead of a bare 404.
 * ============================================================================
 */

import { Router } from 'express';
import authRoutes from './auth.routes';
import stationRoutes from './station.routes';
import searchRoutes from './search.routes';
import indexRoutes from './index.routes';
import * as metaController from '../controllers/metaController';
import { asyncHandler } from '../middleware/asyncHandler';
import { fail } from '../utils/respond';

const router = Router();

// ─── Meta ───────────────────────────────────────────────────────────────────
router.get('/health', asyncHandler(metaController.health));
router.get('/meta', asyncHandler(metaController.meta));

// ─── Shipped: Indexing & Backend module (Viral) ─────────────────────────────
router.use('/auth', authRoutes);
router.use('/stations', stationRoutes);
router.use('/search', searchRoutes);
router.use('/index', indexRoutes);

// ─── Pending modules ────────────────────────────────────────────────────────
// Replace each line with a real mount when the module lands.

// import routePlannerRoutes from './route.routes';
// router.use('/routes', routePlannerRoutes);
router.use(
  '/routes',
  pendingRouter('Routing & Pathfinding', ['POST /api/routes/plan — battery-aware Dijkstra']),
);

// import queueRoutes from './queue.routes';
// router.use('/queue', queueRoutes);
router.use(
  '/queue',
  pendingRouter('Queue & Realtime', [
    'POST   /api/queue/:stationId/join',
    'DELETE /api/queue/:stationId/leave',
    'GET    /api/queue/:stationId',
  ]),
);

// import tripRoutes from './trip.routes';
// router.use('/trips', tripRoutes);
router.use(
  '/trips',
  pendingRouter('Queue & Realtime', ['GET /api/trips — linked-list trip history']),
);

/**
 * A router that answers every method and path under its mount with a 501 and a
 * note about who owns it.
 */
function pendingRouter(moduleName: string, endpoints: string[]): Router {
  const pending = Router();
  // Express 4 wildcard: matches every path under the mount, '/' included.
  pending.all('*', (_req, res) =>
    fail(res, 501, 'NOT_IMPLEMENTED', `The ${moduleName} module has not landed yet.`, {
      module: moduleName,
      plannedEndpoints: endpoints,
      seeAlso: 'followthis.md',
    }),
  );
  return pending;
}

export default router;
