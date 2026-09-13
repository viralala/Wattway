/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Barrel for the algorithms built on top of the from-scratch data structures.
 *
 * OWNERSHIP — see followthis.md before adding a file here.
 *
 *   Shipped (Indexing & Backend module):
 *     · rangeQuery.ts   — BST price/rating range search   [Tree]
 *     · autocomplete.ts — Trie prefix search + re-ranking [Trie]
 *
 *   Expected from the routing module (PRD Section 8):
 *     · dijkstra.ts — battery-aware shortest path         [Graph + Heap]
 *     · bfs.ts      — range-limited reachability          [Queue]
 *     · dfs.ts      — alternate-route exploration         [Stack]
 *     · rank.ts     — heap-based top-N recommendation     [Heap]
 *
 * Every function in this folder is PURE: it takes data structures and criteria
 * in, and returns a result. No database calls, no Express types, no sockets.
 * That is what makes them unit-testable without a running server, which PRD
 * Section 11 requires.
 * ---------------------------------------------------------------------------
 */

export { rangeQuery } from './rangeQuery';
export type { RangeQueryInput, RangeQueryResult } from './rangeQuery';

export { autocomplete } from './autocomplete';
export type { AutocompleteInput, AutocompleteResult } from './autocomplete';

// export { dijkstra } from './dijkstra'; // TODO(routing module)
// export { bfs } from './bfs';           // TODO(routing module)
// export { dfs } from './dfs';           // TODO(routing module)
// export { rank } from './rank';         // TODO(routing module)
