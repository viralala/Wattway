/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * metaController.ts — health and self-description.
 *
 * `GET /api/meta` is the API's front door: it tells a teammate (or an examiner)
 * what exists, which module owns it, and which data structure backs it. When a
 * module has not landed yet, its routes are listed as `pending` rather than
 * being quietly absent, so the shape of the finished system is always visible.
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import { BRAND } from '../config/brand';
import { databaseState } from '../config/db';
import { stationIndex } from '../services/stationIndex';
import { ok } from '../utils/respond';

/** GET /api/health — cheap enough for a load balancer to poll. */
export async function health(_req: Request, res: Response): Promise<void> {
  const database = databaseState();
  const healthy = database === 'connected' && stationIndex.isReady;

  ok(
    res,
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      index: { ready: stationIndex.isReady, stations: stationIndex.size },
      uptimeSeconds: Math.round(process.uptime()),
    },
    {},
    healthy ? 200 : 503,
  );
}

/** GET /api/meta — who built this, and what is wired up. */
export async function meta(_req: Request, res: Response): Promise<void> {
  ok(res, {
    product: BRAND.product,
    tagline: BRAND.tagline,
    team: BRAND.team,
    repository: BRAND.repository,
    modules: BRAND.modules,
    dataStructures: {
      Array: 'Fixed-size port-status board per station (models/Station.ts)',
      'Linked List':
        'Doubly: live waiting line, O(1) leave (datastructures/LinkedList.ts) — shipped; singly: trip history; circular: round-robin ports + Josephus',
      Stack: 'Iterative DFS; frontend undo-last-search — pending',
      Queue: 'Circular array + linked queues; charger-slot job scheduler (datastructures/Queue.ts) — shipped',
      'Tree (BST)': 'Price and rating range index (datastructures/BST.ts) — shipped',
      Trie: 'Search autocomplete (datastructures/Trie.ts) — shipped',
      Heap: "Max-heap urgent queue, min-max DEPQ, heapsort, leftist-heap line merge (Queue & Realtime) — shipped; Dijkstra's frontier — pending",
      Graph: 'Road + station network — pending',
    },
    endpoints: {
      auth: [
        'POST   /api/auth/register',
        'POST   /api/auth/login',
        'POST   /api/auth/refresh',
        'POST   /api/auth/logout',
        'GET    /api/auth/me',
        'PATCH  /api/auth/me',
        'POST   /api/auth/change-password',
      ],
      stations: [
        'GET    /api/stations',
        'GET    /api/stations/:id',
        'POST   /api/stations',
        'PATCH  /api/stations/:id',
        'DELETE /api/stations/:id',
        'PATCH  /api/stations/:id/ports/:portIndex',
        'POST   /api/stations/:id/rating',
      ],
      search: [
        'GET    /api/search/autocomplete   [Trie]',
        'GET    /api/search/range          [BST]',
        'GET    /api/search/nearest-price  [BST]',
        'GET    /api/search/price-bounds   [BST]',
      ],
      index: [
        'GET    /api/index/stats',
        'POST   /api/index/rebuild    (admin)',
        'POST   /api/index/rebalance  (admin)',
      ],
      queue: [
        'GET    /api/queue/:stationId            [Doubly Linked List + Min-Heap estimates]',
        'GET    /api/queue/:stationId/position   [Hash index -> list node]',
        'POST   /api/queue/:stationId/join       [Doubly Linked List]',
        'DELETE /api/queue/:stationId/leave      [O(1) unlink]',
        'GET    /api/queue/:stationId/simulate   [Queue + Max-Heap + Circular List scheduler]',
        'GET    /api/queue/:stationId/report     [Heapsort + Max-Heap + DEPQ]  (operator)',
        'POST   /api/queue/:stationId/allocate   (operator)',
        'POST   /api/queue/:stationId/merge      [Leftist Heap]  (operator)',
        'GET    /api/queue/demo/josephus         [Circular Linked List]',
      ],
      trips: [
        'GET    /api/trips      [Singly Linked List]',
        'POST   /api/trips      [insert at head]',
        'GET    /api/trips/:id',
        'DELETE /api/trips/:id  [unlink node]',
      ],
      realtime: [
        'in  queue:watch / queue:unwatch / queue:position',
        'out queue:updated / ports:updated / queue:position',
      ],
      pending: {
        routes: ['POST /api/routes/plan  [Graph + Heap]'],
      },
    },
  });
}

/** GET / — a friendly root, so hitting the bare host is not a 404. */
export async function root(_req: Request, res: Response): Promise<void> {
  ok(res, {
    message: `${BRAND.emoji} ${BRAND.product} API — ${BRAND.tagline}`,
    team: BRAND.team,
    documentation: '/api/meta',
    health: '/api/health',
  });
}
