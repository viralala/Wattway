/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Indexing & Backend
 * ============================================================================
 *
 *  autocomplete.ts — Trie-backed station / locality search.
 *
 *  PRD Section 10: "Search bar with autocomplete (Trie-backed) for station
 *                   names and localities."
 *
 *  WHAT THIS ADDS OVER `Trie.suggest()`
 *  ------------------------------------
 *  The trie ranks by the score baked in at insert time, which is a property of
 *  the *station* (rating, availability, popularity). That is only half of what
 *  a good dropdown needs — the other half is a property of the *query*:
 *
 *    · a station whose name starts with what you typed should beat one where
 *      the prefix only matched some middle word ("Andheri Hub" over
 *      "Tata Power Andheri" when you type "andh");
 *    · a shorter match is usually the one you meant ("Andheri" over
 *      "Andheri East Phase II");
 *    · a station 2 km away should beat an identical one 40 km away.
 *
 *  So we over-fetch from the trie (`limit * OVERFETCH`) and re-rank that small
 *  candidate set with the query-dependent signal. Over-fetching is what keeps
 *  the re-rank honest: re-ranking exactly `limit` results could never surface
 *  something the trie put at position 11.
 *
 *  COMPLEXITY
 *  ----------
 *      trie descent ..... O(L + P)   L = prefix length, P = pruned subtree
 *      re-rank .......... O(c log c) c = limit * OVERFETCH, a small constant
 * ============================================================================
 */

import type { Trie, TrieSuggestion } from '../datastructures/Trie';
import { haversineKm, type LatLng } from '../utils/geo';
import type { AutocompleteSuggestion, IndexedStation } from '../types';

export interface AutocompleteInput {
  index: Trie<IndexedStation>;
  query: string;
  limit?: number;
  /** Caller position, enabling the proximity term in the final score. */
  near?: LatLng;
  /** Distance beyond which the proximity bonus has fully decayed. */
  horizonKm?: number;
}

export interface AutocompleteResult {
  suggestions: AutocompleteSuggestion[];
  explain: {
    normalisedQuery: string;
    /** Total (term, station) pairs under this prefix — the unpruned universe. */
    prefixMatches: number;
    candidatesConsidered: number;
    returned: number;
    tookMs: number;
  };
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;
/** Pull this many times `limit` out of the trie before re-ranking. */
const OVERFETCH = 4;
const DEFAULT_HORIZON_KM = 25;

/** Relative weight of each signal in the final score. Tuned by eye on seed data. */
const WEIGHTS = {
  base: 1.0,
  prefixOfName: 0.45,
  exactTerm: 0.35,
  brevity: 0.2,
  proximity: 0.5,
} as const;

export function autocomplete({
  index,
  query,
  limit = DEFAULT_LIMIT,
  near,
  horizonKm = DEFAULT_HORIZON_KM,
}: AutocompleteInput): AutocompleteResult {
  const startedAt = Date.now();
  const normalised = normaliseQuery(query);

  // One character is not a search, it is a keystroke. Returning the whole
  // dataset for "a" would defeat the point of the index.
  if (normalised.length < 2) {
    return {
      suggestions: [],
      explain: {
        normalisedQuery: normalised,
        prefixMatches: 0,
        candidatesConsidered: 0,
        returned: 0,
        tookMs: Date.now() - startedAt,
      },
    };
  }

  const capped = clamp(limit, 1, MAX_LIMIT);
  const raw = index.suggest(normalised, capped * OVERFETCH);

  const reranked = raw
    .map((candidate) => ({
      candidate,
      score: rescore(candidate, normalised, near, horizonKm),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, capped);

  return {
    suggestions: reranked.map(({ candidate, score }) => toSuggestion(candidate, score)),
    explain: {
      normalisedQuery: normalised,
      prefixMatches: index.countWithPrefix(normalised),
      candidatesConsidered: raw.length,
      returned: reranked.length,
      tookMs: Date.now() - startedAt,
    },
  };
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/**
 * Blend the station's own quality score with how well it answers *this* query.
 *
 * Every term is normalised to roughly 0-1 before weighting, so the weights
 * above can be read as relative importance rather than as magic constants.
 */
function rescore(
  hit: TrieSuggestion<IndexedStation>,
  query: string,
  near: LatLng | undefined,
  horizonKm: number,
): number {
  const station = hit.value;
  let score = hit.score * WEIGHTS.base;

  const name = normaliseQuery(station.name);

  // The prefix matched the station's actual name, not an incidental token.
  if (name.startsWith(query)) score += WEIGHTS.prefixOfName;

  // The user has typed the whole term.
  if (hit.term === query) score += WEIGHTS.exactTerm;

  // Shorter matched terms are closer to what was meant. Decays smoothly, so a
  // 12-character term is not treated as categorically worse than an 11.
  score += WEIGHTS.brevity * (query.length / Math.max(query.length, hit.term.length));

  if (near) {
    const distanceKm = haversineKm(near, station.location);
    // Linear decay to zero at the horizon; never negative.
    const proximity = Math.max(0, 1 - distanceKm / horizonKm);
    score += WEIGHTS.proximity * proximity;
  }

  return score;
}

function toSuggestion(
  hit: TrieSuggestion<IndexedStation>,
  score: number,
): AutocompleteSuggestion {
  const station = hit.value;
  return {
    id: station.id,
    name: station.name,
    locality: station.address.locality,
    city: station.address.city,
    matchedTerm: hit.term,
    score: Math.round(score * 1000) / 1000,
    location: station.location,
    pricePerKwh: station.pricePerKwh,
    rating: station.rating,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Reuses the trie's own normalisation so a query and an indexed term can never
 * disagree about what "the same string" means.
 */
function normaliseQuery(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export default autocomplete;
