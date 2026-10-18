/**
 * WattWay · Team Kothimbir 🌿
 * floyd.ts — Floyd–Warshall all-pairs shortest paths for the operator
 * dashboard's distance table. O(V³) time, O(V²) space: fine for a city's worth
 * of stations, and it answers "how far is every station from every other" in
 * one pass, which is what an operator redirecting drivers needs.
 */

export interface Edge {
  a: string;
  b: string;
  km: number;
}

export interface AllPairs {
  ids: string[];
  /** dist[i][j]: shortest km from ids[i] to ids[j]; Infinity if unreachable. */
  dist: number[][];
  /** next[i][j]: index of the first hop on the shortest path, or -1. */
  next: number[][];
  /** How many times the inner loop ran (always V³), for the complexity read-out. */
  relaxations: number;
}

/** Undirected edges; the cheaper one wins if a pair is listed twice. */
export function floydWarshall(ids: string[], edges: Edge[]): AllPairs {
  const n = ids.length;
  const at = new Map(ids.map((id, i) => [id, i]));
  const dist = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  const next = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? i : -1)));

  for (const { a, b, km } of edges) {
    const i = at.get(a);
    const j = at.get(b);
    if (i === undefined || j === undefined) throw new Error(`Edge ${a}–${b} names an unknown node`);
    if (km < dist[i][j]) {
      dist[i][j] = dist[j][i] = km;
      next[i][j] = j;
      next[j][i] = i;
    }
  }

  let relaxations = 0;
  for (let k = 0; k < n; k += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        relaxations += 1;
        const via = dist[i][k] + dist[k][j];
        if (via < dist[i][j]) {
          dist[i][j] = via;
          next[i][j] = next[i][k];
        }
      }
    }
  }
  return { ids, dist, next, relaxations };
}

/** Rebuild the path i → j from the `next` matrix, as indices. Empty if unreachable. */
export function pathBetween(ap: AllPairs, i: number, j: number): number[] {
  if (ap.next[i][j] === -1) return [];
  const path = [i];
  let cur = i;
  while (cur !== j) {
    cur = ap.next[cur][j];
    path.push(cur);
  }
  return path;
}
