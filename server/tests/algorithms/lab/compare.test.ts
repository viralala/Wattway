/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * compare.test.ts — the orchestrator: one shape for every algorithm, honest
 * optimality flags, input validation, and the benchmark. No database.
 * ---------------------------------------------------------------------------
 */

import { benchmark, compareAlgorithms, describeGraph, LabInputError } from '../../../src/algorithms/lab';

const base = { nodes: 60, seed: 3, mode: 'distance' as const, regenStrength: 0.6, astarWeight: 1 };

describe('compareAlgorithms', () => {
  it('returns the common result shape for each pathfinding algorithm', () => {
    const out = compareAlgorithms({ ...base, start: 'n0', end: 'n59' });
    expect(out.pathfinding.map((r) => r.algorithm)).toEqual(['dijkstra', 'astar', 'bellmanFord', 'floydWarshall']);
    for (const r of out.pathfinding) {
      expect(r.path[0]).toBe('n0');
      expect(r.path[r.path.length - 1]).toBe('n59');
      expect(r.cost).toEqual(expect.any(Number));
      expect(r.nodesExplored).toBeGreaterThan(0);
      expect(r.visitedOrder).toHaveLength(r.nodesExplored);
      expect(r.runtimeMs).toBeGreaterThanOrEqual(0);
      expect(r.reachable).toBe(true);
      expect(r.optimal).toBe(true);
    }
    expect(out.tsp).toEqual([]);
    expect(out.graph.unit).toBe('km');
  });

  it('flags weighted A* as non-optimal when it really is, and says why', () => {
    let flagged = 0;
    for (let seed = 1; seed <= 15; seed += 1) {
      const out = compareAlgorithms({ ...base, seed, nodes: 120, astarWeight: 8, start: 'n0', end: 'n119' });
      const astar = out.pathfinding.find((r) => r.algorithm === 'astar')!;
      const bf = out.pathfinding.find((r) => r.algorithm === 'bellmanFord')!;
      expect(astar.optimal).toBe(astar.cost === bf.cost || Math.abs(astar.cost! - bf.cost!) < 1e-6);
      if (!astar.optimal) flagged += 1;
    }
    expect(flagged).toBeGreaterThan(0);
  });

  it('energy mode: Bellman-Ford is the reference, and Dijkstra can be flagged non-optimal', () => {
    let flagged = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const out = compareAlgorithms({ ...base, seed, nodes: 80, mode: 'energy', regenStrength: 1, start: 'n0', end: 'n79' });
      expect(out.graph.hasNegativeEdges).toBe(true);
      expect(out.graph.unit).toBe('energy');
      expect(out.pathfinding.find((r) => r.algorithm === 'bellmanFord')!.optimal).toBe(true);
      if (out.pathfinding.find((r) => r.algorithm === 'dijkstra')!.optimal === false) flagged += 1;
    }
    expect(flagged).toBeGreaterThan(0);
  });

  it('runs TSP alone when only stops are given', () => {
    const out = compareAlgorithms({ ...base, stops: ['n0', 'n10', 'n20', 'n30', 'n40'] });
    expect(out.pathfinding).toEqual([]);
    expect(out.tsp.map((r) => r.algorithm)).toEqual(['tspExact', 'tspNearestNeighbour']);
    const [exact, nn] = out.tsp;
    expect(exact.optimal).toBe(true);
    expect(nn.cost!).toBeGreaterThanOrEqual(exact.cost! - 1e-9);
    expect(exact.tour![0]).toBe('n0');
    expect(exact.tour![exact.tour!.length - 1]).toBe('n0');
  });

  it('honours an explicit algorithm selection but still judges against the reference', () => {
    const out = compareAlgorithms({ ...base, start: 'n0', end: 'n40', algorithms: ['dijkstra'] });
    expect(out.pathfinding).toHaveLength(1);
    expect(out.pathfinding[0].optimal).toBe(true);
    expect(out.reference.pathCost).toBeCloseTo(out.pathfinding[0].cost!, 6);
  });

  it('rejects bad input with LabInputError', () => {
    expect(() => compareAlgorithms({ ...base, start: 'n0', end: 'n999' })).toThrow(LabInputError);
    expect(() => compareAlgorithms({ ...base, stops: ['n0', 'n1'] })).toThrow(/at least 3/);
    expect(() => compareAlgorithms({ ...base, stops: ['n0', 'n1', 'n1'] })).toThrow(/distinct/);
    expect(() => compareAlgorithms({ ...base, nodes: 30, stops: Array.from({ length: 13 }, (_, i) => `n${i}`) })).toThrow(/at most 12/);
    expect(() => compareAlgorithms({ ...base })).toThrow(LabInputError);
    expect(() => compareAlgorithms({ ...base, algorithms: ['dijkstra'], stops: ['n0', 'n1', 'n2'] })).toThrow(/start and end/);
  });
});

describe('describeGraph', () => {
  it('lists every road once with both directions’ energy', () => {
    const g = describeGraph(25, 2, 1);
    expect(g.nodes).toHaveLength(25);
    const keys = new Set(g.roads.map((r) => [r.a, r.b].sort().join('-')));
    expect(keys.size).toBe(g.roads.length);
    // a climb one way is a descent the other: the two energies differ
    expect(g.roads.some((r) => r.energyAB !== r.energyBA)).toBe(true);
  });
});

describe('benchmark', () => {
  it('returns a row per size with a runtime and exploration count for every algorithm', () => {
    const { rows, tspStops } = benchmark([10, 30, 60], 1, 'distance', 0.6, 1);
    expect(rows.map((r) => r.size)).toEqual([10, 30, 60]);
    expect(tspStops).toBe(8);
    for (const row of rows) {
      expect(Object.keys(row.runtimeMs)).toHaveLength(6);
      for (const ms of Object.values(row.runtimeMs)) expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('Floyd-Warshall grows much faster than Dijkstra as the graph grows', () => {
    const { rows } = benchmark([40, 250], 1, 'distance', 0.6, 1);
    const growth = (id: 'dijkstra' | 'floydWarshall') => (rows[1].runtimeMs[id] + 0.01) / (rows[0].runtimeMs[id] + 0.01);
    expect(growth('floydWarshall')).toBeGreaterThan(growth('dijkstra'));
  });
});
