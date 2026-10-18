/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * lab/pathfinding.ts — Dijkstra, A*, Bellman-Ford and Floyd-Warshall, each
 * instrumented to report what it did, not just what it found.
 *
 * Every function returns the same raw shape (`PathRun`): the path, its cost, the
 * order nodes were explored in, and an operation count. `compare.ts` wraps these
 * with timing and the optimality check.
 *
 * "Explored" means a different thing for each, on purpose:
 *   · Dijkstra / A*  — a node is explored when it is popped and settled.
 *   · Bellman-Ford   — a node is explored the first time its distance improves.
 *   · Floyd-Warshall — a node is explored when it is used as the pivot `k`.
 * That difference is exactly what the Lab's animation is meant to show.
 * ---------------------------------------------------------------------------
 */

import { LabMinHeap } from './MinHeap';
import type { LabGraph, WeightedGraph } from './types';

export interface PathRun {
  /** Node indices from start to end; empty when unreachable. */
  path: number[];
  cost: number | null;
  /** Node indices in exploration order. */
  visited: number[];
  operations: number;
  notes: string[];
  negativeCycle?: boolean;
}

const EPS = 1e-9;

function rebuildPath(previous: Int32Array, start: number, end: number): number[] {
  const path: number[] = [];
  for (let at = end; at !== -1; at = previous[at]) {
    path.push(at);
    if (at === start) break;
  }
  path.reverse();
  return path[0] === start ? path : [];
}

/**
 * Dijkstra with a binary heap and lazy deletion. O((V + E) log V).
 *
 * Correct only for non-negative weights. It is run on negative-weight graphs on
 * purpose — in the Lab's energy mode — so the result can be compared with
 * Bellman-Ford's. A settled node is never re-expanded, so it always terminates;
 * it just may not be optimal, and the notes say so.
 */
export function dijkstra(graph: WeightedGraph, start: number, end: number): PathRun {
  return bestFirst(graph, start, end, () => 0, 'Dijkstra');
}

/**
 * A* — Dijkstra with the frontier ordered by g + weight·h, where h is the
 * straight-line distance to the goal scaled by the cheapest cost per km on the
 * graph. weight = 1 is standard A* (optimal, since h never overestimates);
 * weight > 1 is "weighted A*": fewer nodes explored, possibly a costlier path.
 */
export function aStar(
  graph: WeightedGraph,
  labGraph: LabGraph,
  start: number,
  end: number,
  heuristicWeight = 1,
): PathRun {
  const goal = labGraph.nodes[end];
  const rate = Math.max(0, graph.minCostPerKm);
  const h = (node: number): number => {
    const n = labGraph.nodes[node];
    return Math.hypot(n.x - goal.x, n.y - goal.y) * rate * heuristicWeight;
  };
  const run = bestFirst(graph, start, end, h, 'A*');
  if (rate === 0) {
    run.notes.push(
      'No admissible heuristic exists when an edge costs ≤ 0 per km, so the heuristic is 0 and A* behaves like Dijkstra.',
    );
  }
  if (heuristicWeight !== 1) {
    run.notes.push(`Heuristic weight ${heuristicWeight}: faster, but the path is no longer guaranteed optimal.`);
  }
  return run;
}

function bestFirst(
  graph: WeightedGraph,
  start: number,
  end: number,
  h: (node: number) => number,
  name: string,
): PathRun {
  const n = graph.size;
  const dist = new Float64Array(n).fill(Infinity);
  const previous = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const visited: number[] = [];
  const heap = new LabMinHeap<number>();
  let operations = 0;
  const notes: string[] = [];

  dist[start] = 0;
  heap.push(h(start), start);

  while (!heap.isEmpty()) {
    const top = heap.pop()!;
    const u = top.value;
    if (settled[u]) continue; // stale entry from an earlier, worse push
    settled[u] = 1;
    visited.push(u);
    if (u === end) break;

    for (const arc of graph.adjacency[u]) {
      operations += 1;
      if (settled[arc.to]) continue;
      const candidate = dist[u] + arc.weight;
      if (candidate < dist[arc.to] - EPS) {
        dist[arc.to] = candidate;
        previous[arc.to] = u;
        heap.push(candidate + h(arc.to), arc.to);
      }
    }
  }

  if (graph.hasNegativeEdges) {
    notes.push(`${name} assumes non-negative edges; this graph has negative ones, so the result may not be optimal.`);
  }
  const reachable = Number.isFinite(dist[end]);
  return {
    path: reachable ? rebuildPath(previous, start, end) : [],
    cost: reachable ? dist[end] : null,
    visited,
    operations,
    notes,
  };
}

/**
 * Bellman-Ford over the edge list, stopping early once a full pass changes
 * nothing. O(V·E) worst case. Handles negative edges; detects negative cycles
 * (an Nth pass that still improves something).
 */
export function bellmanFord(graph: WeightedGraph, start: number, end: number): PathRun {
  const n = graph.size;
  const dist = new Float64Array(n).fill(Infinity);
  const previous = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const visited: number[] = [start];
  seen[start] = 1;
  dist[start] = 0;
  let operations = 0;
  let passes = 0;

  for (let pass = 1; pass <= n - 1; pass += 1) {
    passes = pass;
    let changed = false;
    for (const edge of graph.edges) {
      operations += 1;
      if (dist[edge.from] === Infinity) continue;
      const candidate = dist[edge.from] + edge.weight;
      if (candidate < dist[edge.to] - EPS) {
        dist[edge.to] = candidate;
        previous[edge.to] = edge.from;
        changed = true;
        if (!seen[edge.to]) {
          seen[edge.to] = 1;
          visited.push(edge.to);
        }
      }
    }
    if (!changed) break;
  }

  // One more pass: any further improvement means a negative cycle.
  let negativeCycle = false;
  for (const edge of graph.edges) {
    operations += 1;
    if (dist[edge.from] !== Infinity && dist[edge.from] + edge.weight < dist[edge.to] - EPS) {
      negativeCycle = true;
      break;
    }
  }

  const notes = [`Converged after ${passes} pass${passes === 1 ? '' : 'es'} over ${graph.edges.length} edges.`];
  if (negativeCycle) {
    notes.push('Negative cycle reachable from the start: shortest path is undefined.');
    return { path: [], cost: null, visited, operations, notes, negativeCycle: true };
  }
  const reachable = Number.isFinite(dist[end]);
  return {
    path: reachable ? rebuildPath(previous, start, end) : [],
    cost: reachable ? dist[end] : null,
    visited,
    operations,
    notes,
  };
}

export interface FloydResult {
  /** Row-major n×n shortest costs; Infinity where unreachable. */
  dist: Float64Array;
  /** Row-major n×n "next hop" matrix for path reconstruction; -1 when none. */
  next: Int32Array;
  size: number;
  /** Pivot order (always 0..n-1). */
  pivots: number[];
  operations: number;
  negativeCycle: boolean;
}

/**
 * Floyd-Warshall: all-pairs shortest paths. O(V³) time, O(V²) space.
 * Precomputed once, it answers any station-to-station distance in O(1) — which
 * is what the operator dashboard's distance table is.
 */
export function floydWarshallMatrix(graph: WeightedGraph): FloydResult {
  const n = graph.size;
  const dist = new Float64Array(n * n).fill(Infinity);
  const next = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    dist[i * n + i] = 0;
    next[i * n + i] = i;
  }
  for (const edge of graph.edges) {
    const idx = edge.from * n + edge.to;
    if (edge.weight < dist[idx]) {
      dist[idx] = edge.weight;
      next[idx] = edge.to;
    }
  }

  let operations = 0;
  const pivots: number[] = [];
  for (let k = 0; k < n; k += 1) {
    pivots.push(k);
    for (let i = 0; i < n; i += 1) {
      const ik = dist[i * n + k];
      if (ik === Infinity) continue;
      for (let j = 0; j < n; j += 1) {
        operations += 1;
        const candidate = ik + dist[k * n + j];
        if (candidate < dist[i * n + j] - EPS) {
          dist[i * n + j] = candidate;
          next[i * n + j] = next[i * n + k];
        }
      }
    }
  }

  let negativeCycle = false;
  for (let i = 0; i < n; i += 1) if (dist[i * n + i] < -EPS) negativeCycle = true;
  return { dist, next, size: n, pivots, operations, negativeCycle };
}

export function floydPath(result: FloydResult, from: number, to: number): number[] {
  const n = result.size;
  if (result.next[from * n + to] === -1) return [];
  const path = [from];
  let at = from;
  let guard = 0;
  while (at !== to && guard <= n) {
    at = result.next[at * n + to];
    if (at === -1) return [];
    path.push(at);
    guard += 1;
  }
  return at === to ? path : [];
}

/** Floyd-Warshall answering one start→end query from a freshly built matrix. */
export function floydWarshall(graph: WeightedGraph, start: number, end: number): PathRun & { matrix: FloydResult } {
  const matrix = floydWarshallMatrix(graph);
  const notes = [`Built the full ${matrix.size}×${matrix.size} all-pairs matrix, then read one cell.`];
  if (matrix.negativeCycle) {
    notes.push('Negative cycle detected: some diagonal entries are below zero.');
    return { path: [], cost: null, visited: matrix.pivots, operations: matrix.operations, notes, negativeCycle: true, matrix };
  }
  const cost = matrix.dist[start * matrix.size + end];
  const reachable = Number.isFinite(cost);
  return {
    path: reachable ? floydPath(matrix, start, end) : [],
    cost: reachable ? cost : null,
    visited: matrix.pivots,
    operations: matrix.operations,
    notes,
    matrix,
  };
}
