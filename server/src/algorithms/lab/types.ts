/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * lab/types.ts — shared vocabulary for the Algorithm Lab.
 *
 * The Lab is deliberately self-contained inside `algorithms/lab/`: it owns its
 * own small graph and heap so it neither depends on nor collides with the
 * Routing module's `Graph.ts` / `MinHeap.ts` / `dijkstra.ts`. When those land,
 * the Lab can be pointed at them by swapping `LabMinHeap` and `buildAdjacency`.
 * ---------------------------------------------------------------------------
 */

/** `distance` weights edges in km; `energy` weights them in energy units (may be negative). */
export type CostMode = 'distance' | 'energy';

export const ALGORITHM_IDS = ['dijkstra', 'astar', 'kruskal', 'prim', 'tspExact', 'tspNearestNeighbour'] as const;
export type AlgorithmId = (typeof ALGORITHM_IDS)[number];

export const PATHFINDING_IDS = ['dijkstra', 'astar'] as const;
export const MST_IDS = ['kruskal', 'prim'] as const;
export const TSP_IDS = ['tspExact', 'tspNearestNeighbour'] as const;

export interface LabNode {
  id: string;
  /** Position in km on a square map; also used as the A* heuristic's coordinates. */
  x: number;
  y: number;
  /** Metres above the lowest point; drives the energy cost of each edge. */
  elevation: number;
}

export interface LabEdge {
  from: number;
  to: number;
  /** Road length in km. Never shorter than the straight line, so A* stays admissible. */
  distance: number;
  /** Elevation change in metres from `from` to `to` (negative = downhill). */
  rise: number;
}

export interface LabGraph {
  nodes: LabNode[];
  edges: LabEdge[];
  seed: number;
}

/** One outgoing arc with its weight already resolved for the chosen cost mode. */
export interface Arc {
  to: number;
  weight: number;
}

export interface WeightedGraph {
  size: number;
  adjacency: Arc[][];
  /** Edge list in the same weights — Bellman-Ford (the hidden reference) iterates edges, not adjacency. */
  edges: Array<{ from: number; to: number; weight: number }>;
  /** Lowest cost per straight-line km on any edge (used to build a safe A* heuristic). */
  minCostPerKm: number;
  hasNegativeEdges: boolean;
}

/** What every algorithm reports, so the table, chart and animation read one shape. */
export interface AlgorithmResult {
  algorithm: AlgorithmId;
  label: string;
  /** Node ids from start to end (for TSP: the full road path of the whole tour; empty for a spanning tree). */
  path: string[];
  /** Total cost in `unit`; `null` when no path exists. For a spanning tree: its total road length. */
  cost: number | null;
  /** Spanning trees are always measured in km; everything else follows the cost mode. */
  unit: 'km' | 'energy';
  /**
   * Roads the algorithm committed to, as [from, to] node ids, in the order it took them —
   * the search tree for Dijkstra / A*, the growing spanning tree for Kruskal / Prim.
   * Drives the map animation. Empty for TSP.
   */
  treeEdges: Array<[string, string]>;
  /** Distinct nodes the algorithm settled / expanded / used as a pivot. */
  nodesExplored: number;
  /** Order in which nodes were explored — drives the animation. */
  visitedOrder: string[];
  /** Edge relaxations (or DP transitions for exact TSP) — the honest "work done" counter. */
  operations: number;
  runtimeMs: number;
  /** Matches the best known answer for this input. `null` when there is nothing to compare. */
  optimal: boolean | null;
  reachable: boolean;
  /** Human-readable caveats: negative edges ignored, negative cycle found, heuristic weight, … */
  notes: string[];
  /** TSP only: the order the stops are visited, starting and ending at the first stop. */
  tour?: string[];
}
