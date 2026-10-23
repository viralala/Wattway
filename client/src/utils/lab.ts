/**
 * WattWay · Team Kothimbir 🌿
 * lab.ts — small pure helpers for the Algorithm Lab (unit-tested).
 */
import type { AlgorithmId, LabNode } from '../services/algorithms';

/**
 * `kind` decides how a result is drawn: `search` grows a shaded search tree and
 * then its route, `mst` grows a thin spanning tree, `tour` is a dashed loop.
 */
export const ALGORITHM_META: Record<
  AlgorithmId,
  { label: string; short: string; color: string; kind: 'search' | 'mst' | 'tour'; dashed?: boolean }
> = {
  dijkstra: { label: 'Dijkstra', short: 'Dijkstra', color: 'var(--algo-dijkstra)', kind: 'search' },
  astar: { label: 'A*', short: 'A*', color: 'var(--algo-astar)', kind: 'search' },
  kruskal: { label: 'Kruskal (MST)', short: 'Kruskal', color: 'var(--algo-kruskal)', kind: 'mst' },
  prim: { label: 'Prim (MST)', short: 'Prim', color: 'var(--algo-prim)', kind: 'mst' },
  tspExact: { label: 'TSP · Held-Karp (exact)', short: 'TSP exact', color: 'var(--algo-tsp-exact)', kind: 'tour', dashed: true },
  tspNearestNeighbour: { label: 'TSP · Nearest neighbour', short: 'TSP nearest', color: 'var(--algo-tsp-nn)', kind: 'tour', dashed: true },
};

export const ALL_ALGORITHMS = Object.keys(ALGORITHM_META) as AlgorithmId[];

/**
 * Choose `count` well-spread stops, starting from `startId`, by repeatedly taking
 * the node farthest from everything already chosen (farthest-point sampling).
 * Deterministic, so the same graph always yields the same tour problem.
 */
export function pickStops(nodes: LabNode[], count: number, startId: string): string[] {
  const start = nodes.find((n) => n.id === startId) ?? nodes[0];
  if (!start) return [];
  const chosen: LabNode[] = [start];
  const target = Math.min(count, nodes.length);
  while (chosen.length < target) {
    let best: LabNode | null = null;
    let bestScore = -1;
    for (const candidate of nodes) {
      if (chosen.includes(candidate)) continue;
      const nearest = Math.min(...chosen.map((c) => Math.hypot(c.x - candidate.x, c.y - candidate.y)));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = candidate;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map((n) => n.id);
}

/**
 * Shift a polyline sideways by `offset` (same units as the points), so several
 * algorithms that found the *same* road can be drawn side by side instead of one
 * hiding the others. Each vertex moves along the average normal of its segments.
 */
export function offsetPolyline(points: Array<{ x: number; y: number }>, offset: number): Array<{ x: number; y: number }> {
  if (offset === 0 || points.length < 2) return points;
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (-dy / len) * offset, y: p.y + (dx / len) * offset };
  });
}

export function farthestFrom(nodes: LabNode[], fromId: string): string {
  const from = nodes.find((n) => n.id === fromId) ?? nodes[0];
  let best = nodes[0];
  let far = -1;
  for (const n of nodes) {
    const d = Math.hypot(n.x - from.x, n.y - from.y);
    if (d > far) {
      far = d;
      best = n;
    }
  }
  return best.id;
}

export function nearestNode(nodes: LabNode[], x: number, y: number, maxDistance = 2): LabNode | null {
  let best: LabNode | null = null;
  let bestD = maxDistance;
  for (const n of nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export function formatCost(cost: number | null, unit: 'km' | 'energy'): string {
  if (cost === null) return '—';
  return `${cost.toFixed(3)} ${unit === 'km' ? 'km' : 'e.u.'}`;
}

export function formatMs(ms: number): string {
  if (ms < 0.01) return '<0.01 ms';
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Decade ticks (…0.01, 0.1, 1, 10…) covering [min, max] for a log axis. */
export function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(Math.max(min, 1e-6)));
  const hi = Math.ceil(Math.log10(Math.max(max, min * 1.0001, 1e-6)));
  const ticks: number[] = [];
  for (let e = lo; e <= hi; e += 1) ticks.push(10 ** e);
  return ticks;
}

/** % extra cost of `cost` relative to `best`; 0 when equal or unknown. */
export function percentOver(cost: number | null, best: number | null): number {
  if (cost === null || best === null || best === 0) return 0;
  return Math.max(0, ((cost - best) / Math.abs(best)) * 100);
}

/** How many entries of an animation order to show at a given progress. */
export function revealedCount(total: number, progress: number): number {
  return Math.max(0, Math.min(total, Math.floor(progress)));
}
