/**
 * WattWay · Team Kothimbir
 * ---------------------------------------------------------------------------
 * lab/mst.ts — minimum spanning trees: the cheapest set of roads that links
 * every node, with no loops. Think "shortest service loop an operator's van
 * must keep clear to reach every charger".
 *
 * Both work on the undirected road network weighted by road length (km). An
 * MST is a question about undirected roads, and energy depends on which way
 * you drive, so the cost mode does not apply here.
 *
 *   · Kruskal  O(E log E). Sort every road, then take the cheapest one that
 *              does not close a loop. "Does it close a loop?" is answered by a
 *              union-find (disjoint-set) with path compression + union by
 *              rank — nearly O(1) per check. The tree grows as a forest of
 *              fragments that merge.
 *   · Prim     O(E log V). Grow ONE tree from the start node, always adding
 *              the cheapest road leaving it, using the Lab's min-heap with
 *              lazy deletion (same trick as Dijkstra).
 *
 * With distinct road lengths the MST is unique, so the two must agree on the
 * total; each is the other's yardstick.
 * ---------------------------------------------------------------------------
 */

import { LabMinHeap } from './MinHeap';
import type { LabGraph } from './types';

export interface MstRun {
  /** Always empty: a spanning tree is not a route. Kept so every run has one shape. */
  path: number[];
  /** Total road length of the tree in km; `null` only for an empty graph. */
  cost: number | null;
  /** Node indices in the order they joined the tree. */
  visited: number[];
  /** Accepted roads [a, b], in the order they were accepted. */
  tree: Array<[number, number]>;
  operations: number;
  notes: string[];
}

/** Union-find over node indices. From scratch: the course forbids library stand-ins. */
export class DisjointSet {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;
  /** Number of `find` steps taken — part of Kruskal's honest work count. */
  steps = 0;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i += 1) this.parent[i] = i;
    this.rank = new Uint8Array(size);
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) {
      root = this.parent[root];
      this.steps += 1;
    }
    // Path compression: point everything on the way straight at the root.
    while (this.parent[i] !== root) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }

  /** Merge the sets holding a and b. Returns false when they were already one set. */
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra] += 1;
    }
    return true;
  }
}

/** Every road once (a < b) with its length. Roads are stored as two directed edges. */
function roads(graph: LabGraph): Array<{ a: number; b: number; km: number }> {
  return graph.edges.filter((e) => e.from < e.to).map((e) => ({ a: e.from, b: e.to, km: e.distance }));
}

function spanNote(graph: LabGraph, tree: Array<[number, number]>): string[] {
  const n = graph.nodes.length;
  return tree.length === n - 1
    ? [`${tree.length} roads link all ${n} nodes.`]
    : [`The road graph is disconnected: this is a spanning forest of ${tree.length} roads.`];
}

export function kruskal(graph: LabGraph): MstRun {
  const n = graph.nodes.length;
  const sorted = roads(graph).sort((p, q) => p.km - q.km || p.a - q.a || p.b - q.b);
  const sets = new DisjointSet(n);
  const joined = new Uint8Array(n);
  const visited: number[] = [];
  const tree: Array<[number, number]> = [];
  let cost = 0;
  let examined = 0;

  for (const road of sorted) {
    if (tree.length === n - 1) break; // already spanning: the rest would all close loops
    examined += 1;
    if (!sets.union(road.a, road.b)) continue; // same fragment → would close a loop
    tree.push([road.a, road.b]);
    cost += road.km;
    for (const v of [road.a, road.b]) {
      if (!joined[v]) {
        joined[v] = 1;
        visited.push(v);
      }
    }
  }
  return {
    path: [],
    cost: n === 0 ? null : cost,
    visited,
    tree,
    operations: examined + sets.steps,
    notes: [`Sorted ${sorted.length} roads, examined ${examined} of them.`, ...spanNote(graph, tree)],
  };
}

export function prim(graph: LabGraph, start = 0): MstRun {
  const n = graph.nodes.length;
  if (n === 0) return { path: [], cost: null, visited: [], tree: [], operations: 0, notes: [] };

  const adjacency: Array<Array<{ to: number; km: number }>> = Array.from({ length: n }, () => []);
  for (const road of roads(graph)) {
    adjacency[road.a].push({ to: road.b, km: road.km });
    adjacency[road.b].push({ to: road.a, km: road.km });
  }

  const inTree = new Uint8Array(n);
  const visited: number[] = [];
  const tree: Array<[number, number]> = [];
  const heap = new LabMinHeap<{ from: number; to: number }>();
  let cost = 0;
  let operations = 0;

  const add = (v: number): void => {
    inTree[v] = 1;
    visited.push(v);
    for (const arc of adjacency[v]) {
      operations += 1;
      if (!inTree[arc.to]) heap.push(arc.km, { from: v, to: arc.to });
    }
  };

  add(start);
  while (!heap.isEmpty() && visited.length < n) {
    const { priority, value } = heap.pop()!;
    if (inTree[value.to]) continue; // stale: reached more cheaply already
    tree.push([value.from, value.to]);
    cost += priority;
    add(value.to);
  }
  return {
    path: [],
    cost,
    visited,
    tree,
    operations,
    notes: [`Grown outward from ${graph.nodes[start].id}.`, ...spanNote(graph, tree)],
  };
}
