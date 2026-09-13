/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Indexing & Backend
 * ============================================================================
 *
 *  rangeQuery.ts — BST-backed price and rating range search.
 *
 *  PRD Section 10: "Filter/sort stations by price or rating within a range
 *                   (BST-backed)."
 *
 *  HOW IT WORKS
 *  ------------
 *  There are two BSTs over the same station set — one keyed by price-per-kWh,
 *  one keyed by average rating. A query can constrain either, or both.
 *
 *  When both are constrained we cannot walk both trees at once, so we pick one
 *  to *drive* the scan and apply the other as a residual filter. Picking well
 *  matters: "rating >= 4.5 AND price <= Rs.50" should be driven by the rating
 *  tree, because almost every station passes the price test.
 *
 *  `countInRange()` answers "how many rows would this bound return" in O(log n)
 *  without materialising anything, so we ask both trees and drive with the more
 *  selective one. That is a miniature query planner, and it is the reason the
 *  subtree-size caches exist in BST.ts.
 *
 *  COMPLEXITY
 *  ----------
 *      planning ......... O(log n)          (two countInRange probes)
 *      scan ............. O(log n + c)      c = candidates from driving index
 *      residual filter .. O(c)
 *      sort ............. O(m log m)        m = surviving matches, skipped
 *                                            entirely when the scan already
 *                                            emitted the requested order
 * ============================================================================
 */

import type { BST } from '../datastructures/BST';
import { haversineKm } from '../utils/geo';
import type {
  IndexedStation,
  RangeSearchCriteria,
  RangeSearchExplain,
  RangeSortKey,
  StationResult,
} from '../types';

export interface RangeQueryInput {
  priceIndex: BST<IndexedStation>;
  ratingIndex: BST<IndexedStation>;
  criteria: RangeSearchCriteria;
}

export interface RangeQueryResult {
  stations: StationResult[];
  /** Matches before pagination. */
  total: number;
  explain: RangeSearchExplain;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Rating is bounded 0-5; price has no meaningful ceiling. */
const RATING_FLOOR = 0;
const RATING_CEIL = 5;

export function rangeQuery({ priceIndex, ratingIndex, criteria }: RangeQueryInput): RangeQueryResult {
  const startedAt = Date.now();

  const minPrice = criteria.minPrice ?? -Infinity;
  const maxPrice = criteria.maxPrice ?? Infinity;
  const minRating = criteria.minRating ?? RATING_FLOOR;
  const maxRating = criteria.maxRating ?? RATING_CEIL;

  // An impossible bound short-circuits before we touch either tree.
  if (minPrice > maxPrice || minRating > maxRating) {
    return {
      stations: [],
      total: 0,
      explain: {
        drivingIndex: 'price',
        reason: 'Empty bound: the requested minimum exceeds the requested maximum.',
        candidatesScanned: 0,
        matched: 0,
        sortedByIndexScan: false,
        tookMs: Date.now() - startedAt,
      },
    };
  }

  // ── Plan: which tree drives the scan? ─────────────────────────────────────
  const priceConstrained = criteria.minPrice !== undefined || criteria.maxPrice !== undefined;
  const ratingConstrained = criteria.minRating !== undefined || criteria.maxRating !== undefined;

  const priceHits = priceIndex.countInRange(minPrice, maxPrice);
  const ratingHits = ratingIndex.countInRange(minRating, maxRating);

  let drivingIndex: 'price' | 'rating';
  let reason: string;

  if (priceConstrained && !ratingConstrained) {
    drivingIndex = 'price';
    reason = 'Only a price bound was supplied, so the price BST drives the scan.';
  } else if (ratingConstrained && !priceConstrained) {
    drivingIndex = 'rating';
    reason = 'Only a rating bound was supplied, so the rating BST drives the scan.';
  } else if (!priceConstrained && !ratingConstrained) {
    drivingIndex = 'price';
    reason = 'No range bound supplied; scanning the price BST in key order.';
  } else if (ratingHits < priceHits) {
    drivingIndex = 'rating';
    reason =
      `Both bounds supplied. The rating bound is more selective ` +
      `(${ratingHits} candidates vs ${priceHits}), so it drives the scan and price is ` +
      `applied as a residual filter.`;
  } else {
    drivingIndex = 'price';
    reason =
      `Both bounds supplied. The price bound is at least as selective ` +
      `(${priceHits} candidates vs ${ratingHits}), so it drives the scan and rating is ` +
      `applied as a residual filter.`;
  }

  // ── Scan ──────────────────────────────────────────────────────────────────
  const sort: RangeSortKey = criteria.sort ?? 'price_asc';

  // If the driving tree already emits the order the caller asked for, walk it
  // in that direction and skip the sort entirely.
  const descendingScan =
    (drivingIndex === 'price' && sort === 'price_desc') ||
    (drivingIndex === 'rating' && sort === 'rating_desc');

  const candidates =
    drivingIndex === 'price'
      ? priceIndex.rangeQuery(minPrice, maxPrice, { descending: descendingScan })
      : ratingIndex.rangeQuery(minRating, maxRating, { descending: descendingScan });

  // ── Residual filters ──────────────────────────────────────────────────────
  const matches: StationResult[] = [];

  for (const station of candidates) {
    if (!station.isActive) continue;

    // The bound the driving scan did not enforce.
    if (drivingIndex === 'price') {
      if (station.rating < minRating || station.rating > maxRating) continue;
    } else if (station.pricePerKwh < minPrice || station.pricePerKwh > maxPrice) {
      continue;
    }

    if (criteria.connectorType && !station.connectorTypes.includes(criteria.connectorType)) {
      continue;
    }

    if (criteria.city && !equalsLoose(station.address.city, criteria.city)) continue;

    if (criteria.onlyWithFreePorts && station.freePorts <= 0) continue;

    const result: StationResult = { ...station };

    if (criteria.near) {
      const distanceKm = haversineKm(criteria.near, station.location);
      if (criteria.radiusKm !== undefined && distanceKm > criteria.radiusKm) continue;
      result.distanceKm = round(distanceKm, 3);
    }

    matches.push(result);
  }

  // ── Order ─────────────────────────────────────────────────────────────────
  const scanAlreadyOrdered =
    (drivingIndex === 'price' && (sort === 'price_asc' || sort === 'price_desc')) ||
    (drivingIndex === 'rating' && sort === 'rating_desc');

  if (!scanAlreadyOrdered) {
    matches.sort(comparatorFor(sort));
  }

  // ── Paginate ──────────────────────────────────────────────────────────────
  const page = Math.max(DEFAULT_PAGE, criteria.page ?? DEFAULT_PAGE);
  const limit = clamp(criteria.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = (page - 1) * limit;

  return {
    stations: matches.slice(offset, offset + limit),
    total: matches.length,
    explain: {
      drivingIndex,
      reason,
      candidatesScanned: candidates.length,
      matched: matches.length,
      sortedByIndexScan: scanAlreadyOrdered,
      tookMs: Date.now() - startedAt,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function comparatorFor(sort: RangeSortKey): (a: StationResult, b: StationResult) => number {
  switch (sort) {
    case 'price_desc':
      return (a, b) => b.pricePerKwh - a.pricePerKwh;
    case 'rating_desc':
      // Unrated stations should not outrank a well-reviewed one, so ties break
      // on how many ratings backed the average.
      return (a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount;
    case 'distance_asc':
      return (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    case 'free_ports_desc':
      return (a, b) => b.freePorts - a.freePorts || a.queueLength - b.queueLength;
    case 'price_asc':
    default:
      return (a, b) => a.pricePerKwh - b.pricePerKwh;
  }
}

function equalsLoose(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export default rangeQuery;
