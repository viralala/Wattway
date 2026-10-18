// WattWay data structures — from docs/DATA-STRUCTURES.md
// This is hardcoded documentation. The backend implementations are in server/src/datastructures/

export interface DataStructure {
  name: string;
  status: 'shipped' | 'pending';
  file: string;
  usedBy: string;
  prdSection: string;
  why: string;
  complexity: Record<string, string>;
}

export const STRUCTURES: DataStructure[] = [
  {
    name: 'Array',
    status: 'shipped',
    file: 'server/src/models/Station.ts',
    usedBy: 'Port-status board per station',
    prdSection: '5',
    why: "Fixed-size array of port states: free / occupied / faulted. O(1) random access to check or flip a specific port's status.",
    complexity: {
      'Get port status': 'O(1)',
      'Set port status': 'O(1)',
    },
  },
  {
    name: 'Binary Search Tree (BST)',
    status: 'shipped',
    file: 'server/src/datastructures/BST.ts',
    usedBy: 'Price + rating index for range queries',
    prdSection: '5',
    why: 'Stations have mutable prices and ratings. A sorted array costs O(n) to update; a BST gives O(log n) for both point updates and range scans. Duplicate keys live in buckets, and every node caches its subtree size.',
    complexity: {
      'insert / search / remove': 'O(h)',
      'Range query': 'O(h + k)',
      'Count in range': 'O(h)',
    },
  },
  {
    name: 'Trie',
    status: 'shipped',
    file: 'server/src/datastructures/Trie.ts',
    usedBy: 'Autocomplete for station-name / locality search',
    prdSection: '5',
    why: 'Answers O(L) prefix lookup regardless of dataset size, vs O(n) database regex per keystroke. Ranked by score; supports de-duplication across multiple tokens per station; removable in O(L).',
    complexity: {
      'insert': 'O(L)',
      'search (exact)': 'O(L)',
      'suggest (top-K)': 'O(L + P log A + K log K)',
      'remove': 'O(L) per term',
    },
  },
  {
    name: 'Linked List',
    status: 'pending',
    file: 'server/src/datastructures/LinkedList.ts',
    usedBy: 'Graph adjacency; per-station queue with O(1) mid-queue removal',
    prdSection: '5',
    why: 'Allows efficient insertion/deletion at arbitrary positions without shifting. Essential for graphs and fair queue management.',
    complexity: {},
  },
  {
    name: 'Stack',
    status: 'pending',
    file: 'server/src/datastructures/Stack.ts',
    usedBy: 'Iterative DFS; frontend undo-last-search',
    prdSection: '5',
    why: 'LIFO access for depth-first traversal and undo/redo UI state.',
    complexity: {},
  },
  {
    name: 'Queue',
    status: 'pending',
    file: 'server/src/datastructures/Queue.ts',
    usedBy: 'Per-station FIFO waiting line; BFS traversal',
    prdSection: '5',
    why: 'FIFO access for breadth-first search and fair station queueing.',
    complexity: {},
  },
  {
    name: 'Min-Heap',
    status: 'pending',
    file: 'server/src/datastructures/MinHeap.ts',
    usedBy: "Dijkstra's frontier; top-N station ranking by composite score",
    prdSection: '5',
    why: 'Priority queue for greedy algorithms. Extract-min in O(log n).',
    complexity: {},
  },
  {
    name: 'Graph',
    status: 'pending',
    file: 'server/src/datastructures/Graph.ts',
    usedBy: 'Weighted directed road + station network',
    prdSection: '5',
    why: 'Road network with battery-range edge pruning; adjacency lists via linked lists.',
    complexity: {},
  },
];

export const shipped = STRUCTURES.filter((s) => s.status === 'shipped');
export const pending = STRUCTURES.filter((s) => s.status === 'pending');
