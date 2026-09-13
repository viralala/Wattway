/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * indexController.ts — observability and manual control for the in-memory index.
 *
 * `GET /api/index/stats` is public on purpose. It is the endpoint the demo
 * points at to show the structures are real: node counts, actual tree height
 * against the theoretical minimum, trie depth, when the index was last built
 * and how long that took.
 *
 * The write operations are admin-only.
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import { stationIndex } from '../services/stationIndex';
import { ok } from '../utils/respond';
import { logger } from '../utils/logger';
import { currentUser } from '../middleware/auth';

/** GET /api/index/stats */
export async function indexStats(_req: Request, res: Response): Promise<void> {
  const stats = stationIndex.stats();

  ok(res, {
    ...stats,
    interpretation: {
      priceIndex:
        `Binary search tree over price-per-kWh. ${stats.priceIndex.keys} distinct prices ` +
        `across ${stats.priceIndex.values} stations, height ${stats.priceIndex.height} ` +
        `against a theoretical minimum of ${stats.priceIndex.idealHeight}.`,
      ratingIndex:
        `Binary search tree over average rating. ${stats.ratingIndex.keys} distinct ratings ` +
        `across ${stats.ratingIndex.values} stations, height ${stats.ratingIndex.height} ` +
        `against a theoretical minimum of ${stats.ratingIndex.idealHeight}.`,
      nameIndex:
        `Trie over station names, localities, cities and operators. ` +
        `${stats.nameIndex.terms} terms over ${stats.nameIndex.nodes} nodes, ` +
        `deepest path ${stats.nameIndex.maxDepth} characters.`,
    },
  });
}

/**
 * POST /api/index/rebuild — admin only.
 *
 * The escape hatch for when the database was edited out of band (a direct
 * mongosh insert during a demo, or a teammate's seed script).
 */
export async function rebuildIndex(req: Request, res: Response): Promise<void> {
  const actor = currentUser(req);
  const startedAt = Date.now();

  const count = await stationIndex.rebuildFromDatabase();
  const tookMs = Date.now() - startedAt;

  logger.info(`Station index rebuilt on demand by ${actor.email}: ${count} stations in ${tookMs}ms`);

  ok(res, { rebuilt: true, stations: count, tookMs, stats: stationIndex.stats() });
}

/**
 * POST /api/index/rebalance — admin only.
 *
 * Rebalances the BSTs in place without re-reading the database. Mostly a
 * teaching endpoint: hammer the index with incremental writes, watch `height`
 * drift above `idealHeight` in `/stats`, then call this and watch it snap back.
 */
export async function rebalanceIndex(_req: Request, res: Response): Promise<void> {
  const before = stationIndex.stats();
  const changed = stationIndex.maybeRebalance();
  const after = stationIndex.stats();

  ok(res, {
    rebalanced: changed,
    before: { price: before.priceIndex, rating: before.ratingIndex },
    after: { price: after.priceIndex, rating: after.ratingIndex },
  });
}
