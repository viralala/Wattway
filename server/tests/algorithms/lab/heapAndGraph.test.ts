/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * heapAndGraph.test.ts — the Lab's min-heap and its seeded road-graph generator.
 * No database.
 * ---------------------------------------------------------------------------
 */

import { LabMinHeap } from '../../../src/algorithms/lab/MinHeap';
import { buildWeighted, edgeEnergy, ENERGY_PER_METRE_CLIMBED as K, generateGraph, parseNodeId } from '../../../src/algorithms/lab/graph';
import { bellmanFord } from '../../../src/algorithms/lab/pathfinding';

describe('LabMinHeap', () => {
  it('pops in ascending priority order', () => {
    const heap = new LabMinHeap<string>();
    [5, 1, 4, 1, 9, 2, 8].forEach((p) => heap.push(p, `p${p}`));
    const out: number[] = [];
    while (!heap.isEmpty()) out.push(heap.pop()!.priority);
    expect(out).toEqual([1, 1, 2, 4, 5, 8, 9]);
  });

  it('handles empty, single-element and negative priorities', () => {
    const heap = new LabMinHeap<number>();
    expect(heap.pop()).toBeUndefined();
    expect(heap.peek()).toBeUndefined();
    heap.push(3, 3);
    expect(heap.pop()?.value).toBe(3);
    heap.push(-2, -2);
    heap.push(7, 7);
    expect(heap.peek()?.priority).toBe(-2);
    expect(heap.size).toBe(2);
  });

  it('sorts a large shuffled input correctly', () => {
    const heap = new LabMinHeap<number>();
    const values = Array.from({ length: 500 }, (_, i) => (i * 7919) % 503);
    values.forEach((v) => heap.push(v, v));
    const out: number[] = [];
    while (!heap.isEmpty()) out.push(heap.pop()!.priority);
    expect(out).toEqual([...values].sort((a, b) => a - b));
  });
});

describe('generateGraph', () => {
  it('is deterministic for a given (nodes, seed)', () => {
    expect(generateGraph(30, 7)).toEqual(generateGraph(30, 7));
    expect(generateGraph(30, 7)).not.toEqual(generateGraph(30, 8));
  });

  it('is connected and every road is two-way', () => {
    for (const seed of [1, 2, 3, 99]) {
      const graph = generateGraph(60, seed);
      const w = buildWeighted(graph, 'distance', 0);
      const seen = new Set<number>([0]);
      const stack = [0];
      while (stack.length) {
        const u = stack.pop()!;
        for (const arc of w.adjacency[u]) if (!seen.has(arc.to)) (seen.add(arc.to), stack.push(arc.to));
      }
      expect(seen.size).toBe(60);
      for (const e of graph.edges) {
        expect(graph.edges.some((r) => r.from === e.to && r.to === e.from && r.distance === e.distance)).toBe(true);
      }
    }
  });

  it('never makes a road shorter than the straight line (keeps A* admissible)', () => {
    const graph = generateGraph(80, 5);
    for (const e of graph.edges) {
      const a = graph.nodes[e.from];
      const b = graph.nodes[e.to];
      expect(e.distance).toBeGreaterThanOrEqual(Math.hypot(a.x - b.x, a.y - b.y) - 1e-9);
    }
  });

  it('resolves node ids and rejects out-of-range ones', () => {
    const graph = generateGraph(10, 1);
    expect(parseNodeId(graph, 'n0')).toBe(0);
    expect(parseNodeId(graph, 'n9')).toBe(9);
    expect(parseNodeId(graph, 'n10')).toBe(-1);
    expect(parseNodeId(graph, 'x1')).toBe(-1);
  });
});

describe('energy model', () => {
  it('equals distance with no elevation change, and charges more to climb', () => {
    const flat = { from: 0, to: 1, distance: 2, rise: 0 };
    expect(edgeEnergy(flat, 1)).toBeCloseTo(2);
    const up = { from: 0, to: 1, distance: 2, rise: 100 };
    expect(edgeEnergy(up, 0.5)).toBeCloseTo(2 + K * 100);
  });

  it('recovers energy on descent in proportion to regen, going negative on steep drops', () => {
    const down = { from: 0, to: 1, distance: 1, rise: -100 };
    expect(edgeEnergy(down, 0)).toBeCloseTo(1);
    expect(edgeEnergy(down, 0.5)).toBeCloseTo(1 - 0.5 * K * 100);
    expect(edgeEnergy(down, 1)).toBeLessThan(0);
  });

  it('produces negative edges at high regen but never a negative cycle', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const graph = generateGraph(60, seed);
      const w = buildWeighted(graph, 'energy', 1);
      expect(w.hasNegativeEdges).toBe(true);
      expect(bellmanFord(w, 0, 59).negativeCycle).toBeFalsy();
    }
    expect(buildWeighted(generateGraph(60, 1), 'energy', 0).hasNegativeEdges).toBe(false);
  });
});
