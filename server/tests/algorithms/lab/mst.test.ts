/**
 * WattWay · Team Kothimbir
 * ---------------------------------------------------------------------------
 * mst.test.ts — Kruskal, Prim and the union-find behind Kruskal, checked against
 * each other, a hand-built graph and brute force. No database.
 * ---------------------------------------------------------------------------
 */

import { generateGraph } from '../../../src/algorithms/lab/graph';
import { DisjointSet, kruskal, prim } from '../../../src/algorithms/lab/mst';
import type { LabGraph } from '../../../src/algorithms/lab/types';

/** Hand-build a road graph from undirected [a, b, km] roads. */
function roads(size: number, list: Array<[number, number, number]>): LabGraph {
  const nodes = Array.from({ length: size }, (_, i) => ({ id: `n${i}`, x: i, y: 0, elevation: 0 }));
  const edges = list.flatMap(([a, b, distance]) => [
    { from: a, to: b, distance, rise: 0 },
    { from: b, to: a, distance, rise: 0 },
  ]);
  return { nodes, edges, seed: 0 };
}

/** True when `tree` links all n nodes with no loop. */
function spans(n: number, tree: Array<[number, number]>): boolean {
  const sets = new DisjointSet(n);
  for (const [a, b] of tree) if (!sets.union(a, b)) return false;
  const root = sets.find(0);
  return tree.length === n - 1 && Array.from({ length: n }, (_, i) => sets.find(i)).every((r) => r === root);
}

const roadLength = (graph: LabGraph, a: number, b: number): number | undefined =>
  graph.edges.find((e) => e.from === a && e.to === b)?.distance;

describe('DisjointSet', () => {
  it('merges sets and refuses to merge a set with itself', () => {
    const s = new DisjointSet(5);
    expect(s.union(0, 1)).toBe(true);
    expect(s.union(2, 3)).toBe(true);
    expect(s.find(0)).toBe(s.find(1));
    expect(s.find(1)).not.toBe(s.find(2));
    expect(s.union(1, 3)).toBe(true);
    expect(s.union(0, 2)).toBe(false); // already joined through 1–3
    expect(s.find(4)).toBe(4);
  });
});

describe('hand-built graph', () => {
  // A square 0-1-2-3 with one diagonal; the MST drops the two most expensive roads.
  const g = roads(4, [
    [0, 1, 1],
    [1, 2, 2],
    [2, 3, 3],
    [3, 0, 4],
    [0, 2, 5],
  ]);

  it('Kruskal takes the cheapest roads that do not close a loop', () => {
    const run = kruskal(g);
    expect(run.cost).toBe(6);
    expect(run.tree).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(run.path).toEqual([]);
  });

  it('Prim grows one tree from its start and reaches the same total', () => {
    const run = prim(g, 3);
    expect(run.cost).toBe(6);
    expect(run.visited[0]).toBe(3);
    expect(run.tree[0]).toEqual([3, 2]);
    expect(spans(4, run.tree)).toBe(true);
  });

  it('a single node is a zero-cost tree', () => {
    expect(kruskal(roads(1, [])).cost).toBe(0);
    expect(prim(roads(1, [])).tree).toEqual([]);
  });

  it('a disconnected graph yields a spanning forest, and says so', () => {
    const forest = roads(4, [
      [0, 1, 1],
      [2, 3, 1],
    ]);
    expect(kruskal(forest).tree).toHaveLength(2);
    expect(kruskal(forest).notes.join(' ')).toMatch(/disconnected/);
    expect(prim(forest, 0).tree).toHaveLength(1); // Prim only sees its own component
  });
});

describe('on generated road graphs', () => {
  it('Kruskal and Prim agree on total length and both span every node with real roads', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const graph = generateGraph(90, seed);
      const k = kruskal(graph);
      const p = prim(graph, seed % 90);
      expect(p.cost!).toBeCloseTo(k.cost!, 9);
      for (const run of [k, p]) {
        expect(spans(90, run.tree)).toBe(true);
        expect(new Set(run.visited).size).toBe(90);
        const sum = run.tree.reduce((acc, [a, b]) => acc + roadLength(graph, a, b)!, 0);
        expect(sum).toBeCloseTo(run.cost!, 9);
      }
    }
  });

  it('matches brute force over every possible tree on a small graph', () => {
    const graph = generateGraph(7, 3);
    const list = graph.edges.filter((e) => e.from < e.to);
    let best = Infinity;
    // Every subset of n-1 roads that spans is a spanning tree; keep the cheapest.
    const pick = (from: number, chosen: number[]): void => {
      if (chosen.length === 6) {
        const tree = chosen.map((i): [number, number] => [list[i].from, list[i].to]);
        if (spans(7, tree)) best = Math.min(best, chosen.reduce((acc, i) => acc + list[i].distance, 0));
        return;
      }
      for (let i = from; i < list.length; i += 1) pick(i + 1, [...chosen, i]);
    };
    pick(0, []);
    expect(kruskal(graph).cost!).toBeCloseTo(best, 9);
    expect(prim(graph).cost!).toBeCloseTo(best, 9);
  });

  it('the spanning tree is lighter than the whole road network', () => {
    const graph = generateGraph(60, 2);
    const total = graph.edges.filter((e) => e.from < e.to).reduce((acc, e) => acc + e.distance, 0);
    expect(kruskal(graph).cost!).toBeLessThan(total);
  });
});
