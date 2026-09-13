/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Indexing & Backend
 * ============================================================================
 *
 *  stationIndex.ts — the live, in-memory station index.
 *
 *  This is the service the whole "Indexing" half of my role exists to produce.
 *  It owns three structures over the same station set:
 *
 *      priceIndex   BST<IndexedStation>  keyed by pricePerKwh
 *      ratingIndex  BST<IndexedStation>  keyed by rating.average
 *      nameIndex    Trie<IndexedStation> keyed by name / locality / operator
 *
 *  WHY IN MEMORY AT ALL?
 *  ---------------------
 *  MongoDB could answer both of these queries. It would also cost a network
 *  round trip per keystroke, and the course brief is explicitly about
 *  demonstrating the structures rather than delegating to someone else's
 *  B-tree. A metro-sized dataset (PRD Section 11: "a few hundred nodes") is a
 *  few hundred kilobytes — holding it resident is the obvious call.
 *
 *  CONSISTENCY MODEL
 *  -----------------
 *  Mongo is the source of truth; this index is a derived, eventually-consistent
 *  view of it.
 *
 *    · Writes that go through the station controller call `upsert()` /
 *      `remove()` synchronously, so the index is correct immediately for
 *      anything this server did.
 *    · A periodic `rebuildFromDatabase()` (INDEX_REFRESH_MS) catches writes
 *      made by another process, a second server instance, or a direct database
 *      edit during the demo.
 *
 *  A rebuild is atomic from a reader's point of view: new structures are built
 *  off to the side and swapped in by reference assignment, so a search running
 *  concurrently never observes a half-built tree.
 * ============================================================================
 */

import { BST } from '../datastructures/BST';
import { Trie } from '../datastructures/Trie';
import { rangeQuery, type RangeQueryResult } from '../algorithms/rangeQuery';
import { autocomplete, type AutocompleteResult } from '../algorithms/autocomplete';
import { Station } from '../models/Station';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { IndexedStation, RangeSearchCriteria } from '../types';
import type { LatLng } from '../utils/geo';

export interface StationIndexStats {
  ready: boolean;
  stations: number;
  lastBuiltAt: string | null;
  lastBuildMs: number | null;
  buildCount: number;
  priceIndex: ReturnType<BST<IndexedStation>['stats']>;
  ratingIndex: ReturnType<BST<IndexedStation>['stats']>;
  nameIndex: ReturnType<Trie<IndexedStation>['stats']>;
}

/**
 * Prior used to damp the rating of a barely-reviewed station.
 *
 * Without it, one five-star review outranks a 4.6 average over 400 reviews,
 * which is exactly the failure mode that makes an autocomplete feel broken.
 * `RATING_PRIOR_WEIGHT` is the number of imaginary average reviews every
 * station starts with.
 */
const RATING_PRIOR_WEIGHT = 8;
const RATING_PRIOR_VALUE = 3.2;

export class StationIndex {
  private priceIndex: BST<IndexedStation> = new BST<IndexedStation>();
  private ratingIndex: BST<IndexedStation> = new BST<IndexedStation>();
  private nameIndex: Trie<IndexedStation> = new Trie<IndexedStation>();

  /** id -> the station as currently indexed, so incremental updates can find
   *  the old keys they need to remove. Without this, `upsert` after a price
   *  change would leave a ghost entry at the old price. */
  private byId = new Map<string, IndexedStation>();

  private ready = false;
  private buildCount = 0;
  private lastBuiltAt: Date | null = null;
  private lastBuildMs: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  /** Guards against two rebuilds overlapping. */
  private rebuilding: Promise<number> | null = null;

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  /**
   * Replace the whole index from a station list. O(n log n), dominated by the
   * two balanced bulk-builds.
   *
   * Built into locals and swapped in at the end — see the atomicity note above.
   */
  build(stations: readonly IndexedStation[]): number {
    const startedAt = Date.now();
    const active = stations.filter((station) => station.isActive);

    const price = BST.build(active, (station) => station.pricePerKwh);
    const rating = BST.build(active, (station) => station.rating);

    const names = new Trie<IndexedStation>();
    const lookup = new Map<string, IndexedStation>();

    for (const station of active) {
      const score = StationIndex.scoreOf(station);
      for (const term of StationIndex.termsFor(station)) {
        names.insertPhrase(term, { id: station.id, value: station, score });
      }
      lookup.set(station.id, station);
    }

    // Swap. Readers holding a reference to the old structures finish safely
    // against a consistent, if slightly stale, snapshot.
    this.priceIndex = price;
    this.ratingIndex = rating;
    this.nameIndex = names;
    this.byId = lookup;

    this.ready = true;
    this.buildCount += 1;
    this.lastBuiltAt = new Date();
    this.lastBuildMs = Date.now() - startedAt;

    logger.info(
      `Station index built: ${active.length} stations in ${this.lastBuildMs}ms ` +
        `(price BST h=${price.height}, rating BST h=${rating.height}, ` +
        `trie nodes=${names.stats().nodes})`,
    );

    return active.length;
  }

  /**
   * Pull every active station out of MongoDB and rebuild.
   *
   * `.lean()` is deliberate: we want plain objects, not hydrated documents with
   * change tracking, and this is the one query in the codebase that reads the
   * whole collection.
   */
  async rebuildFromDatabase(): Promise<number> {
    if (this.rebuilding) return this.rebuilding;

    this.rebuilding = (async () => {
      const documents = await Station.find({ isActive: true }).sort({ pricePerKwh: 1 }).exec();
      return this.build(documents.map((document) => document.toIndexed()));
    })();

    try {
      return await this.rebuilding;
    } finally {
      this.rebuilding = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Incremental maintenance
  // ---------------------------------------------------------------------------

  /**
   * Insert or update one station. O(log n + L).
   *
   * The remove-then-insert is not an optimisation detail — it is required for
   * correctness. A station whose price moved from Rs.12 to Rs.14 must leave the
   * Rs.12 bucket, and only the previously indexed copy knows where that was.
   */
  upsert(station: IndexedStation): void {
    this.remove(station.id);
    if (!station.isActive) return;

    this.priceIndex.insert(station.pricePerKwh, station);
    this.ratingIndex.insert(station.rating, station);

    const score = StationIndex.scoreOf(station);
    for (const term of StationIndex.termsFor(station)) {
      this.nameIndex.insertPhrase(term, { id: station.id, value: station, score });
    }

    this.byId.set(station.id, station);
    this.ready = true;
  }

  /** Drop a station from all three structures. Returns true if it was present. */
  remove(stationId: string): boolean {
    const existing = this.byId.get(stationId);
    if (!existing) return false;

    this.priceIndex.remove(existing.pricePerKwh, (station) => station.id === stationId);
    this.ratingIndex.remove(existing.rating, (station) => station.id === stationId);
    this.nameIndex.removeById(stationId);
    this.byId.delete(stationId);

    return true;
  }

  /**
   * Rebalance the two BSTs if incremental churn has left them lopsided. Cheap
   * O(n) and idempotent, so the refresh loop can call it unconditionally.
   */
  maybeRebalance(): boolean {
    let rebalanced = false;
    if (!this.priceIndex.isBalanced()) {
      this.priceIndex.rebalance();
      rebalanced = true;
    }
    if (!this.ratingIndex.isBalanced()) {
      this.ratingIndex.rebalance();
      rebalanced = true;
    }
    if (rebalanced) logger.debug('Station index BSTs rebalanced after incremental churn');
    return rebalanced;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** BST-backed price / rating range search. */
  search(criteria: RangeSearchCriteria): RangeQueryResult {
    return rangeQuery({
      priceIndex: this.priceIndex,
      ratingIndex: this.ratingIndex,
      criteria,
    });
  }

  /** Trie-backed autocomplete. */
  suggest(query: string, options: { limit?: number; near?: LatLng } = {}): AutocompleteResult {
    return autocomplete({
      index: this.nameIndex,
      query,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.near ? { near: options.near } : {}),
    });
  }

  /** The indexed projection of one station, without touching the database. */
  get(stationId: string): IndexedStation | undefined {
    return this.byId.get(stationId);
  }

  /** Every indexed station, ascending by price. Used by the seed verifier. */
  all(): IndexedStation[] {
    return this.priceIndex.toSortedValues();
  }

  get size(): number {
    return this.byId.size;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Direct handles for the other modules.
   *
   * The routing module's top-N ranking wants to pull candidates straight out of
   * the price tree rather than round-trip through the HTTP layer. Exposing the
   * structures read-only is cheaper than making them re-derive the index.
   * Treat them as read-only — mutate through `upsert`/`remove` only.
   */
  get structures(): {
    price: BST<IndexedStation>;
    rating: BST<IndexedStation>;
    names: Trie<IndexedStation>;
  } {
    return { price: this.priceIndex, rating: this.ratingIndex, names: this.nameIndex };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Build once, then refresh on a timer if one is configured. */
  async start(): Promise<void> {
    await this.rebuildFromDatabase();

    if (env.INDEX_REFRESH_MS > 0) {
      this.refreshTimer = setInterval(() => {
        this.rebuildFromDatabase().catch((error: unknown) => {
          logger.error('Scheduled station-index rebuild failed', error);
        });
      }, env.INDEX_REFRESH_MS);
      // Do not hold the event loop open on account of the refresh timer.
      this.refreshTimer.unref?.();
      logger.info(`Station index auto-refresh every ${env.INDEX_REFRESH_MS}ms`);
    }
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Wipe everything. Used between integration tests. */
  reset(): void {
    this.stop();
    this.priceIndex = new BST<IndexedStation>();
    this.ratingIndex = new BST<IndexedStation>();
    this.nameIndex = new Trie<IndexedStation>();
    this.byId = new Map();
    this.ready = false;
    this.buildCount = 0;
    this.lastBuiltAt = null;
    this.lastBuildMs = null;
  }

  stats(): StationIndexStats {
    return {
      ready: this.ready,
      stations: this.byId.size,
      lastBuiltAt: this.lastBuiltAt ? this.lastBuiltAt.toISOString() : null,
      lastBuildMs: this.lastBuildMs,
      buildCount: this.buildCount,
      priceIndex: this.priceIndex.stats(),
      ratingIndex: this.ratingIndex.stats(),
      nameIndex: this.nameIndex.stats(),
    };
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  /**
   * The station's intrinsic quality, in roughly 0-1, baked into its trie
   * entries at index time.
   *
   * Three signals:
   *   · a confidence-weighted rating (see RATING_PRIOR_* above);
   *   · availability right now — free ports are what the driver actually wants;
   *   · queue depth, as a penalty, because PRD Section 2 is explicit that "a
   *     closer station with a ten-car queue is worse than a slightly farther
   *     one that is free".
   *
   * Query-dependent signals (prefix quality, distance) are deliberately NOT
   * here — they belong in `autocomplete.ts`, because they change per request
   * whereas this score changes only when the station does.
   */
  static scoreOf(station: IndexedStation): number {
    const smoothedRating =
      (station.rating * station.ratingCount + RATING_PRIOR_VALUE * RATING_PRIOR_WEIGHT) /
      (station.ratingCount + RATING_PRIOR_WEIGHT);
    const ratingTerm = smoothedRating / 5;

    const availability =
      station.totalPorts > 0 ? station.freePorts / station.totalPorts : 0;

    // Saturating penalty: the difference between a 9- and a 10-car queue
    // barely matters, the difference between 0 and 1 very much does.
    const queuePenalty = station.queueLength / (station.queueLength + 3);

    const score = 0.55 * ratingTerm + 0.3 * availability + 0.15 * (1 - queuePenalty);
    return Math.max(0.001, score);
  }

  /** The strings a station should be findable by. */
  private static termsFor(station: IndexedStation): string[] {
    const { locality, city, state } = station.address;
    return [
      station.name,
      `${station.name} ${locality}`,
      locality,
      `${locality} ${city}`,
      city,
      state,
      station.operator,
      `${station.operator} ${locality}`,
    ].filter((term) => term && term.trim().length > 1);
  }
}

/**
 * Process-wide singleton. One index per server, shared by every request — a
 * per-request index would rebuild the trees on every keystroke, which is the
 * exact cost this whole file exists to avoid.
 */
export const stationIndex = new StationIndex();

export default stationIndex;
