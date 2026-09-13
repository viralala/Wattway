/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Barrel for the from-scratch data-structures library (PRD Section 6: "The
 * custom data structures live in their own module so they are implemented from
 * scratch (not via a library) and can be unit-tested and demonstrated
 * independently of the web app around them.").
 *
 * OWNERSHIP — keep this list in sync as modules land. See followthis.md.
 *
 *   Shipped (Indexing & Backend module):
 *     · BST.ts    — price / rating range index          [Tree]
 *     · Trie.ts   — search autocomplete                 [Trie]
 *
 *   Expected from the other modules — add the export line next to your file:
 *     · Graph.ts      — road + station network          [Graph]
 *     · MinHeap.ts    — Dijkstra frontier, top-N rank   [Heap]
 *     · LinkedList.ts — adjacency lists, trip history   [Linked List]
 *     · Stack.ts      — iterative DFS, undo-last-search [Stack]
 *     · Queue.ts      — per-station waiting line, BFS   [Queue]
 *
 * Do not import a third-party implementation of any of these — the whole point
 * of the course brief is that they are ours.
 * ---------------------------------------------------------------------------
 */

export { BST, BSTNode } from './BST';
export type { BSTEntry, BSTStats, RangeOptions } from './BST';

export { Trie, TrieNode } from './Trie';
export type { TrieEntry, TrieStats, TrieSuggestion } from './Trie';

// export { Graph } from './Graph';           // TODO(routing module)
// export { MinHeap } from './MinHeap';       // TODO(routing module)
// export { LinkedList } from './LinkedList'; // TODO(graph/history module)
// export { Stack } from './Stack';           // TODO(traversal module)
// export { Queue } from './Queue';           // TODO(queue module)
