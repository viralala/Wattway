/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * lab/tsp.ts — visiting several charging stops and coming home.
 *
 * Both solvers take the *stops* (graph node indices; the first is the start and
 * the end of the tour) and a Floyd-Warshall matrix, which supplies the road cost
 * between any two stops in O(1). That matrix is shared with the Floyd-Warshall
 * entry in the comparison, so each TSP runtime below measures the tour search
 * only, not the matrix build — `notes` says so.
 *
 *   · Held-Karp (exact)        O(k² · 2ᵏ) time, O(k · 2ᵏ) memory. Optimal.
 *                              Fine to ~10 stops; the Lab caps it at 12.
 *   · Nearest neighbour        O(k²). Always picks the closest unvisited stop.
 *                              Instant, but can be noticeably worse than optimal.
 * ---------------------------------------------------------------------------
 */

import { floydPath, type FloydResult, type PathRun } from './pathfinding';

export const MAX_TSP_STOPS = 12;
const EPS = 1e-9;

function leg(matrix: FloydResult, a: number, b: number): number {
  return matrix.dist[a * matrix.size + b];
}

/** Stitch the road path of every leg of a tour into one node-index path. */
function expandTour(matrix: FloydResult, tour: number[]): number[] | null {
  const full: number[] = [];
  for (let i = 0; i < tour.length - 1; i += 1) {
    const segment = floydPath(matrix, tour[i], tour[i + 1]);
    if (segment.length === 0) return null;
    full.push(...(i === 0 ? segment : segment.slice(1)));
  }
  return full;
}

export interface TspRun extends PathRun {
  /** Stop node indices in visiting order, starting and ending at stops[0]. */
  tour: number[];
}

function unreachableRun(visited: number[], operations: number, notes: string[]): TspRun {
  return { path: [], cost: null, visited, operations, notes, tour: [] };
}

export function tspExact(matrix: FloydResult, stops: number[]): TspRun {
  const k = stops.length;
  const notes = ['Runtime covers the Held-Karp search only; the shared all-pairs matrix is built separately.'];
  if (matrix.negativeCycle) return unreachableRun([], 0, [...notes, 'Negative cycle: tour cost undefined.']);

  // Stop 0 is fixed as the start; subsets range over stops 1..k-1.
  const m = k - 1;
  const full = (1 << m) - 1;
  const dp = new Float64Array((1 << m) * m).fill(Infinity);
  const parent = new Int8Array((1 << m) * m).fill(-1);
  let operations = 0;
  let states = 0;

  for (let j = 0; j < m; j += 1) dp[(1 << j) * m + j] = leg(matrix, stops[0], stops[j + 1]);

  for (let mask = 1; mask <= full; mask += 1) {
    for (let last = 0; last < m; last += 1) {
      if (!(mask & (1 << last))) continue;
      const here = dp[mask * m + last];
      if (here === Infinity) continue;
      states += 1;
      for (let next = 0; next < m; next += 1) {
        if (mask & (1 << next)) continue;
        operations += 1;
        const nextMask = mask | (1 << next);
        const candidate = here + leg(matrix, stops[last + 1], stops[next + 1]);
        if (candidate < dp[nextMask * m + next] - EPS) {
          dp[nextMask * m + next] = candidate;
          parent[nextMask * m + next] = last;
        }
      }
    }
  }

  let bestCost = Infinity;
  let bestLast = -1;
  for (let last = 0; last < m; last += 1) {
    const cost = dp[full * m + last] + leg(matrix, stops[last + 1], stops[0]);
    operations += 1;
    if (cost < bestCost - EPS) {
      bestCost = cost;
      bestLast = last;
    }
  }
  if (bestLast === -1 || !Number.isFinite(bestCost)) return unreachableRun([], operations, notes);

  // Walk the parent pointers back to recover the order.
  const order: number[] = [];
  let mask = full;
  for (let last = bestLast; last !== -1; ) {
    order.push(stops[last + 1]);
    const prev = parent[mask * m + last];
    mask &= ~(1 << last);
    last = prev;
  }
  order.reverse();
  const tour = [stops[0], ...order, stops[0]];
  const path = expandTour(matrix, tour);
  notes.push(`Evaluated ${states} DP states (${m} free stops → 2^${m} subsets).`);
  if (!path) return unreachableRun([], operations, notes);
  return { path, cost: bestCost, visited: tour.slice(0, -1), operations, notes, tour };
}

export function tspNearestNeighbour(matrix: FloydResult, stops: number[]): TspRun {
  const notes = [
    'Greedy: always drives to the closest unvisited stop. Fast, not guaranteed optimal.',
    'Runtime covers the greedy search only; the shared all-pairs matrix is built separately.',
  ];
  if (matrix.negativeCycle) return unreachableRun([], 0, [...notes, 'Negative cycle: tour cost undefined.']);

  const remaining = new Set(stops.slice(1));
  const tour = [stops[0]];
  let at = stops[0];
  let cost = 0;
  let operations = 0;

  while (remaining.size > 0) {
    let best = -1;
    let bestCost = Infinity;
    for (const candidate of remaining) {
      operations += 1;
      const c = leg(matrix, at, candidate);
      if (c < bestCost - EPS || (Math.abs(c - bestCost) <= EPS && candidate < best)) {
        bestCost = c;
        best = candidate;
      }
    }
    if (best === -1 || !Number.isFinite(bestCost)) return unreachableRun(tour, operations, notes);
    remaining.delete(best);
    tour.push(best);
    cost += bestCost;
    at = best;
  }
  const back = leg(matrix, at, stops[0]);
  if (!Number.isFinite(back)) return unreachableRun(tour, operations, notes);
  cost += back;
  tour.push(stops[0]);

  const path = expandTour(matrix, tour);
  if (!path) return unreachableRun(tour, operations, notes);
  return { path, cost, visited: tour.slice(0, -1), operations, notes, tour };
}
