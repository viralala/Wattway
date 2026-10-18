/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * pathfinding.test.ts — Dijkstra, A*, Bellman-Ford and Floyd-Warshall, checked
 * against each other and against hand-built graphs. No database.
 * ---------------------------------------------------------------------------
 */

import { buildWeighted, generateGraph } from '../../../src/algorithms/lab/graph';
import {
  aStar,
  bellmanFord,
  dijkstra,
  floydPath,
  floydWarshall,
  floydWarshallMatrix,
} from '../../../src/algorithms/lab/pathfinding';
import type { WeightedGraph } from '../../../src/algorithms/lab/types';

/** Hand-build a weighted graph from directed edges. */
function wg(size: number, list: Array<[number, number, number]>): WeightedGraph {
  const adjacency: WeightedGraph['adjacency'] = Array.from({ length: size }, () => []);
  const edges: WeightedGraph['edges'] = [];
  for (const [from, to, weight] of list) {
    adjacency[from].push({ to, weight });
    edges.push({ from, to, weight });
  }
  return { size, adjacency, edges, minCostPerKm: 0, hasNegativeEdges: list.some(([, , w]) => w < 0) };
}

describe('hand-built graphs', () => {
  // 0 →1 (1), 1 →2 (1), 0 →2 (5), 2 →3 (1)
  const g = wg(5, [[0, 1, 1], [1, 2, 1], [0, 2, 5], [2, 3, 1]]);

  it('every algorithm finds the cheap multi-hop route', () => {
    for (const run of [dijkstra(g, 0, 3), bellmanFord(g, 0, 3), floydWarshall(g, 0, 3)]) {
      expect(run.path).toEqual([0, 1, 2, 3]);
      expect(run.cost).toBe(3);
    }
  });

  it('reports unreachable targets as no path and null cost', () => {
    for (const run of [dijkstra(g, 0, 4), bellmanFord(g, 0, 4), floydWarshall(g, 0, 4)]) {
      expect(run.path).toEqual([]);
      expect(run.cost).toBeNull();
    }
  });

  it('start === end is a zero-cost single-node path', () => {
    expect(dijkstra(g, 2, 2).path).toEqual([2]);
    expect(bellmanFord(g, 2, 2).cost).toBe(0);
    expect(floydWarshall(g, 2, 2).cost).toBe(0);
  });

  it('Bellman-Ford handles a negative edge that Dijkstra gets wrong', () => {
    // Dijkstra settles node 2 (cost 2) before it can see 1→2's rescue via 3? Build the classic trap:
    // 0→1 (4), 0→2 (5), 2→1 (-3): best to 1 is 2 via 0→2→1, but Dijkstra settles 1 at 4 first.
    const trap = wg(3, [[0, 1, 4], [0, 2, 5], [2, 1, -3]]);
    expect(bellmanFord(trap, 0, 1).cost).toBe(2);
    expect(floydWarshall(trap, 0, 1).cost).toBe(2);
    const d = dijkstra(trap, 0, 1);
    expect(d.cost).toBe(4);
    expect(d.notes.join(' ')).toMatch(/negative/i);
  });

  it('detects a negative cycle in Bellman-Ford and Floyd-Warshall', () => {
    const cyc = wg(3, [[0, 1, 1], [1, 2, -3], [2, 1, 1]]);
    const bf = bellmanFord(cyc, 0, 2);
    expect(bf.negativeCycle).toBe(true);
    expect(bf.cost).toBeNull();
    expect(floydWarshall(cyc, 0, 2).negativeCycle).toBe(true);
  });
});

describe('on generated road graphs (distance mode)', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it('all four algorithms agree on cost', () => {
    for (const seed of seeds) {
      const graph = generateGraph(70, seed);
      const w = buildWeighted(graph, 'distance', 0);
      const end = 69;
      const costs = [
        dijkstra(w, 0, end).cost,
        aStar(w, graph, 0, end, 1).cost,
        bellmanFord(w, 0, end).cost,
        floydWarshall(w, 0, end).cost,
      ];
      for (const c of costs) expect(c).toBeCloseTo(costs[2]!, 6);
    }
  });

  it('returned paths are real: consecutive nodes share an edge and costs add up', () => {
    const graph = generateGraph(60, 3);
    const w = buildWeighted(graph, 'distance', 0);
    const run = aStar(w, graph, 0, 59, 1);
    let sum = 0;
    for (let i = 0; i < run.path.length - 1; i += 1) {
      const arc = w.adjacency[run.path[i]].find((a) => a.to === run.path[i + 1]);
      expect(arc).toBeDefined();
      sum += arc!.weight;
    }
    expect(sum).toBeCloseTo(run.cost!, 6);
  });

  it('A* explores fewer nodes than Dijkstra, in total across seeds', () => {
    let dij = 0;
    let ast = 0;
    for (const seed of seeds) {
      const graph = generateGraph(150, seed);
      const w = buildWeighted(graph, 'distance', 0);
      dij += dijkstra(w, 0, 149).visited.length;
      ast += aStar(w, graph, 0, 149, 1).visited.length;
    }
    expect(ast).toBeLessThan(dij);
  });

  it('a heavier A* heuristic explores no more nodes and never beats the optimum', () => {
    let exploredStandard = 0;
    let exploredGreedy = 0;
    for (const seed of seeds) {
      const graph = generateGraph(150, seed);
      const w = buildWeighted(graph, 'distance', 0);
      const optimal = bellmanFord(w, 0, 149).cost!;
      const standard = aStar(w, graph, 0, 149, 1);
      const greedy = aStar(w, graph, 0, 149, 5);
      expect(greedy.cost!).toBeGreaterThanOrEqual(optimal - 1e-9);
      expect(greedy.notes.join(' ')).toMatch(/no longer guaranteed optimal/i);
      exploredStandard += standard.visited.length;
      exploredGreedy += greedy.visited.length;
    }
    expect(exploredGreedy).toBeLessThanOrEqual(exploredStandard);
  });

  it('Floyd-Warshall matrix is symmetric (two-way roads) with a zero diagonal', () => {
    const graph = generateGraph(30, 2);
    const m = floydWarshallMatrix(buildWeighted(graph, 'distance', 0));
    for (let i = 0; i < 30; i += 1) {
      expect(m.dist[i * 30 + i]).toBe(0);
      for (let j = 0; j < 30; j += 1) expect(m.dist[i * 30 + j]).toBeCloseTo(m.dist[j * 30 + i], 9);
    }
    expect(floydPath(m, 0, 29)[0]).toBe(0);
  });

  it('instruments exploration: visited order starts at the start, with no repeats', () => {
    const graph = generateGraph(50, 4);
    const w = buildWeighted(graph, 'distance', 0);
    for (const run of [dijkstra(w, 0, 49), aStar(w, graph, 0, 49), bellmanFord(w, 0, 49)]) {
      expect(run.visited[0]).toBe(0);
      expect(new Set(run.visited).size).toBe(run.visited.length);
      expect(run.operations).toBeGreaterThan(0);
    }
    expect(floydWarshall(w, 0, 49).visited).toHaveLength(50);
  });
});

describe('energy mode (negative edges from regenerative braking)', () => {
  it('Bellman-Ford and Floyd-Warshall agree; Dijkstra is never better, and sometimes worse', () => {
    let dijkstraWorse = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const graph = generateGraph(80, seed);
      const w = buildWeighted(graph, 'energy', 1);
      const bf = bellmanFord(w, 0, 79);
      const fw = floydWarshall(w, 0, 79);
      const dj = dijkstra(w, 0, 79);
      expect(bf.negativeCycle).toBeFalsy();
      expect(fw.cost!).toBeCloseTo(bf.cost!, 6);
      expect(dj.cost!).toBeGreaterThanOrEqual(bf.cost! - 1e-9);
      if (dj.cost! > bf.cost! + 1e-6) dijkstraWorse += 1;
    }
    expect(dijkstraWorse).toBeGreaterThan(0);
  });

  it('more regen never raises the cheapest energy cost, and lowers it on some routes', () => {
    let lower = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const graph = generateGraph(80, seed);
      const none = bellmanFord(buildWeighted(graph, 'energy', 0), 0, 79).cost!;
      const half = bellmanFord(buildWeighted(graph, 'energy', 0.5), 0, 79).cost!;
      const full = bellmanFord(buildWeighted(graph, 'energy', 1), 0, 79).cost!;
      expect(half).toBeLessThanOrEqual(none + 1e-9);
      expect(full).toBeLessThanOrEqual(half + 1e-9);
      if (full < none - 1e-6) lower += 1;
    }
    expect(lower).toBeGreaterThan(0);
  });
});
