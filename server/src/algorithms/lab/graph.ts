/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * lab/graph.ts — a seeded, reproducible road graph for the Algorithm Lab, and
 * the conversion into the weighted form the algorithms consume.
 *
 * The repo has no road dataset yet, so the Lab generates one: nodes scattered
 * over a 30 km square, each joined to its nearest neighbours by two-way roads,
 * then stitched together so the graph is always connected. The same
 * (nodes, seed) always produces the same graph, so a client can redraw it and a
 * test can assert on it.
 *
 * ENERGY MODEL
 * ------------
 * Each node has an elevation. Driving an edge costs
 *
 *     energy = distance · 1.0                      (rolling resistance, per km)
 *            + 0.04 · rise       when climbing      (rise > 0, metres)
 *            + regen · 0.04 · rise  when descending (rise < 0 → negative!)
 *
 * `regen` ∈ [0, 1] is the share of descent energy the car claws back through
 * regenerative braking. On a steep, short downhill the regen term outweighs the
 * rolling cost and the edge goes NEGATIVE — which Dijkstra cannot handle and
 * Bellman-Ford can. Roads are two-way, so the reverse edge climbs; around any
 * closed loop climbs and descents cancel, so with regen ≤ 1 a loop never nets
 * negative energy. That guarantees no negative *cycles* — Bellman-Ford's
 * precondition for a meaningful answer.
 * ---------------------------------------------------------------------------
 */

import type { CostMode, LabEdge, LabGraph, LabNode, WeightedGraph } from './types';

export const MAP_SIZE_KM = 30;
export const ENERGY_PER_KM = 1.0;
export const ENERGY_PER_METRE_CLIMBED = 0.04;
const NEIGHBOURS = 3;

/** Small, fast, seedable PRNG (mulberry32). Deterministic across platforms. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const nodeId = (index: number): string => `n${index}`;

export function parseNodeId(graph: LabGraph, id: string): number {
  // Ids are `n<index>`; resolve through the array so a hand-edited id can't point outside it.
  const match = /^n(\d+)$/.exec(id);
  const index = match ? Number(match[1]) : -1;
  return index >= 0 && index < graph.nodes.length ? index : -1;
}

export function euclid(a: LabNode, b: LabNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function generateGraph(nodeCount: number, seed: number): LabGraph {
  const rng = makeRng(seed);
  const phaseX = rng() * Math.PI * 2;
  const phaseY = rng() * Math.PI * 2;

  const nodes: LabNode[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const x = rng() * MAP_SIZE_KM;
    const y = rng() * MAP_SIZE_KM;
    // Hilly terrain (0–~360 m): steep enough that fast descents out-recover their rolling cost.
    const elevation =
      150 + 120 * Math.sin(x / 3.2 + phaseX) + 70 * Math.sin(y / 2.6 + phaseY) + 20 * Math.sin((x + y) / 1.4);
    nodes.push({ id: nodeId(i), x: round(x), y: round(y), elevation: round(Math.max(0, elevation)) });
  }

  // Undirected neighbour pairs, stored once with the smaller index first.
  const pairs = new Set<string>();
  const addPair = (a: number, b: number): void => {
    if (a === b) return;
    pairs.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  };

  for (let i = 0; i < nodeCount; i += 1) {
    const nearest: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < nodeCount; j += 1) {
      if (j !== i) nearest.push({ j, d: euclid(nodes[i], nodes[j]) });
    }
    nearest.sort((p, q) => p.d - q.d || p.j - q.j);
    for (let k = 0; k < Math.min(NEIGHBOURS, nearest.length); k += 1) addPair(i, nearest[k].j);
  }

  // Stitch components together with the shortest bridge between them.
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  for (const key of pairs) {
    const [a, b] = key.split('-').map(Number);
    parent[find(a)] = find(b);
  }
  for (;;) {
    let best: { a: number; b: number; d: number } | null = null;
    for (let a = 0; a < nodeCount; a += 1) {
      for (let b = a + 1; b < nodeCount; b += 1) {
        if (find(a) === find(b)) continue;
        const d = euclid(nodes[a], nodes[b]);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best) break;
    addPair(best.a, best.b);
    parent[find(best.a)] = find(best.b);
  }

  // Two-way roads. A per-road "wiggle" makes road length ≥ straight-line length.
  const edges: LabEdge[] = [];
  const sortedPairs = [...pairs].sort((p, q) => {
    const [pa, pb] = p.split('-').map(Number);
    const [qa, qb] = q.split('-').map(Number);
    return pa - qa || pb - qb;
  });
  for (const key of sortedPairs) {
    const [a, b] = key.split('-').map(Number);
    const wiggle = 1 + rng() * 0.25;
    // Round UP so the stored length can never undercut the straight line.
    const distance = Math.max(0.05, Math.ceil(euclid(nodes[a], nodes[b]) * wiggle * 1000) / 1000);
    const rise = round(nodes[b].elevation - nodes[a].elevation);
    edges.push({ from: a, to: b, distance, rise });
    edges.push({ from: b, to: a, distance, rise: -rise });
  }

  return { nodes, edges, seed };
}

/** Energy to drive one edge. Negative when regen on a descent beats rolling cost. */
export function edgeEnergy(edge: LabEdge, regen: number): number {
  const base = edge.distance * ENERGY_PER_KM;
  const slope = edge.rise > 0 ? edge.rise : regen * edge.rise;
  return round(base + ENERGY_PER_METRE_CLIMBED * slope);
}

export function edgeWeight(edge: LabEdge, mode: CostMode, regen: number): number {
  return mode === 'energy' ? edgeEnergy(edge, regen) : edge.distance;
}

export function buildWeighted(graph: LabGraph, mode: CostMode, regen: number): WeightedGraph {
  const size = graph.nodes.length;
  const adjacency: WeightedGraph['adjacency'] = Array.from({ length: size }, () => []);
  const edges: WeightedGraph['edges'] = [];
  let minCostPerKm = Infinity;
  let hasNegativeEdges = false;

  for (const edge of graph.edges) {
    const weight = edgeWeight(edge, mode, regen);
    adjacency[edge.from].push({ to: edge.to, weight });
    edges.push({ from: edge.from, to: edge.to, weight });
    if (weight < 0) hasNegativeEdges = true;
    const straight = euclid(graph.nodes[edge.from], graph.nodes[edge.to]);
    if (straight > 0) minCostPerKm = Math.min(minCostPerKm, weight / straight);
  }
  if (!Number.isFinite(minCostPerKm)) minCostPerKm = 0;
  return { size, adjacency, edges, minCostPerKm, hasNegativeEdges };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
