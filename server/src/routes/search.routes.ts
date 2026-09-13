/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * search.routes.ts — /api/search
 *
 * All four routes are public and answer from memory. `optionalAuth` is not
 * even applied to autocomplete: it fires on every keystroke and there is
 * nothing here worth the cost of a signature verification per character.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import { z } from 'zod';
import * as search from '../controllers/searchController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { CONNECTOR_TYPES, RANGE_SORT_KEYS } from '../types';
import { zBool, zLat, zLimit, zLng, zNumber, zPage } from '../utils/zod';

const router = Router();

const autocompleteQuery = z
  .object({
    q: z.string().trim().min(1, 'q is required').max(80),
    limit: zLimit(25, 8),
    lat: zLat.optional(),
    lng: zLng.optional(),
    explain: zBool.optional(),
  })
  .refine(
    (query) => (query.lat === undefined) === (query.lng === undefined),
    'lat and lng must be supplied together',
  );

const rangeQuerySchema = z
  .object({
    minPrice: zNumber.min(0).max(500).optional(),
    maxPrice: zNumber.min(0).max(500).optional(),
    minRating: zNumber.min(0).max(5).optional(),
    maxRating: zNumber.min(0).max(5).optional(),
    connectorType: z.enum(CONNECTOR_TYPES).optional(),
    city: z.string().trim().min(2).max(80).optional(),
    lat: zLat.optional(),
    lng: zLng.optional(),
    radiusKm: zNumber.min(0.1).max(500).optional(),
    onlyWithFreePorts: zBool.optional(),
    sort: z.enum(RANGE_SORT_KEYS).optional(),
    page: zPage,
    limit: zLimit(100, 20),
    explain: zBool.optional(),
  })
  .refine(
    (query) => (query.lat === undefined) === (query.lng === undefined),
    'lat and lng must be supplied together',
  )
  // Caught here so the client gets a 422 naming the problem rather than an
  // empty result set it has to puzzle over.
  .refine(
    (query) =>
      query.minPrice === undefined || query.maxPrice === undefined || query.minPrice <= query.maxPrice,
    'minPrice must not exceed maxPrice',
  )
  .refine(
    (query) =>
      query.minRating === undefined ||
      query.maxRating === undefined ||
      query.minRating <= query.maxRating,
    'minRating must not exceed maxRating',
  );

const nearestPriceQuery = z.object({
  price: zNumber.min(0).max(500),
  limit: zLimit(25, 5),
});

/** Trie — PRD 10.3. */
router.get(
  '/autocomplete',
  validate({ query: autocompleteQuery }),
  asyncHandler(search.autocompleteSearch),
);

/** BST — PRD 10.4. */
router.get('/range', validate({ query: rangeQuerySchema }), asyncHandler(search.rangeSearch));

/** BST nearest-key lookup. */
router.get(
  '/nearest-price',
  validate({ query: nearestPriceQuery }),
  asyncHandler(search.nearestPrice),
);

/** BST min/max — the ends of the client's range slider. */
router.get('/price-bounds', asyncHandler(search.searchBounds));

export default router;
