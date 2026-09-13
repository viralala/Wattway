/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * searchController.ts — the two endpoints this whole module was built for.
 *
 *   GET /api/search/autocomplete   Trie      PRD 10.3
 *   GET /api/search/range          BST       PRD 10.4
 *
 * Both answer entirely from memory. Neither touches MongoDB.
 *
 * Every response carries an `explain` block (`?explain=true` for the verbose
 * one) reporting which structure was used, how many candidates it scanned and
 * how long it took. That exists for the demo: PRD Section 13 asks for each
 * course requirement to be "traceable to a specific, working piece of the
 * system", and it is far more convincing to show the API reporting
 * "price BST, 1240 candidates pruned to 23, 0.4ms" than to assert it on a
 * slide.
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import { stationIndex } from '../services/stationIndex';
import { ApiError } from '../utils/ApiError';
import { ok, paginate } from '../utils/respond';
import { isValidLatLng, type LatLng } from '../utils/geo';
import type { ConnectorType, RangeSearchCriteria, RangeSortKey } from '../types';

/** Both endpoints are useless until the index has been built at least once. */
function assertIndexReady(): void {
  if (!stationIndex.isReady) {
    throw new ApiError(
      503,
      'INDEX_UNAVAILABLE',
      'The station index is still building. Retry in a moment.',
    );
  }
}

/**
 * GET /api/search/autocomplete?q=andh&limit=8&lat=&lng=
 *
 * O(L + pruned subtree). Called on every keystroke, so it does the minimum:
 * no database, no auth, no serialisation of full station documents.
 */
export async function autocompleteSearch(req: Request, res: Response): Promise<void> {
  assertIndexReady();

  const { q, limit, lat, lng, explain } = req.query as unknown as {
    q: string;
    limit?: number;
    lat?: number;
    lng?: number;
    explain?: boolean;
  };

  const near: LatLng | undefined =
    lat !== undefined && lng !== undefined && isValidLatLng({ lat, lng }) ? { lat, lng } : undefined;

  const result = stationIndex.suggest(q, {
    ...(limit !== undefined ? { limit } : {}),
    ...(near ? { near } : {}),
  });

  ok(
    res,
    { query: q, suggestions: result.suggestions },
    {
      dataStructure: 'Trie',
      tookMs: result.explain.tookMs,
      ...(explain ? { explain: result.explain } : {}),
    },
  );
}

/**
 * GET /api/search/range?minPrice=8&maxPrice=12&minRating=4&sort=price_asc
 *
 * The BST range query. See algorithms/rangeQuery.ts for how the driving index
 * is chosen when both a price and a rating bound are supplied.
 */
export async function rangeSearch(req: Request, res: Response): Promise<void> {
  assertIndexReady();

  const query = req.query as unknown as {
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    maxRating?: number;
    connectorType?: ConnectorType;
    city?: string;
    lat?: number;
    lng?: number;
    radiusKm?: number;
    onlyWithFreePorts?: boolean;
    sort?: RangeSortKey;
    page?: number;
    limit?: number;
    explain?: boolean;
  };

  const near: LatLng | undefined =
    query.lat !== undefined && query.lng !== undefined && isValidLatLng({ lat: query.lat, lng: query.lng })
      ? { lat: query.lat, lng: query.lng }
      : undefined;

  // `distance_asc` without a position would silently sort by Infinity.
  if (query.sort === 'distance_asc' && !near) {
    throw ApiError.badRequest('sort=distance_asc requires both lat and lng');
  }
  if (query.radiusKm !== undefined && !near) {
    throw ApiError.badRequest('radiusKm requires both lat and lng');
  }

  const criteria: RangeSearchCriteria = {
    ...(query.minPrice !== undefined ? { minPrice: query.minPrice } : {}),
    ...(query.maxPrice !== undefined ? { maxPrice: query.maxPrice } : {}),
    ...(query.minRating !== undefined ? { minRating: query.minRating } : {}),
    ...(query.maxRating !== undefined ? { maxRating: query.maxRating } : {}),
    ...(query.connectorType ? { connectorType: query.connectorType } : {}),
    ...(query.city ? { city: query.city } : {}),
    ...(near ? { near } : {}),
    ...(query.radiusKm !== undefined ? { radiusKm: query.radiusKm } : {}),
    ...(query.onlyWithFreePorts !== undefined
      ? { onlyWithFreePorts: query.onlyWithFreePorts }
      : {}),
    ...(query.sort ? { sort: query.sort } : {}),
    ...(query.page !== undefined ? { page: query.page } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  };

  const result = stationIndex.search(criteria);

  ok(
    res,
    { stations: result.stations },
    {
      dataStructure: 'BST',
      tookMs: result.explain.tookMs,
      pagination: paginate(criteria.page ?? 1, criteria.limit ?? 20, result.total),
      ...(query.explain ? { explain: result.explain } : {}),
    },
  );
}

/**
 * GET /api/search/nearest-price?price=10
 *
 * The BST's `nearest()` in its own endpoint: "nothing in my budget — what is
 * closest to it?". A sorted array could answer this too; a hash index could
 * not, which is the point worth making in the demo.
 */
export async function nearestPrice(req: Request, res: Response): Promise<void> {
  assertIndexReady();

  const { price, limit = 5 } = req.query as unknown as { price: number; limit?: number };

  const entry = stationIndex.structures.price.nearest(price);
  if (!entry) throw ApiError.notFound('The price index is empty');

  ok(
    res,
    {
      requestedPrice: price,
      nearestPrice: entry.key,
      difference: round(Math.abs(entry.key - price), 2),
      stations: entry.values.slice(0, limit),
    },
    { dataStructure: 'BST' },
  );
}

/**
 * GET /api/search/price-bounds
 *
 * Min and max of each BST — what the client needs to render the range slider
 * with sensible ends. O(h) per tree, no scan.
 */
export async function searchBounds(_req: Request, res: Response): Promise<void> {
  assertIndexReady();

  const { price, rating } = stationIndex.structures;
  const priceStats = price.stats();
  const ratingStats = rating.stats();

  ok(
    res,
    {
      price: { min: priceStats.minKey, max: priceStats.maxKey, distinctValues: priceStats.keys },
      rating: { min: ratingStats.minKey, max: ratingStats.maxKey, distinctValues: ratingStats.keys },
      stations: stationIndex.size,
    },
    { dataStructure: 'BST' },
  );
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
