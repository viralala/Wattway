/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * lab/compare.ts — run several algorithms on the same input and report them in
 * one shape. Pure: no database, no Express.
 *
 * "Optimal" is judged against a reference computed on the same graph:
 *   · path algorithms  → Bellman-Ford's cost (the only one that is correct for
 *                        negative edges, so it is the honest yardstick);
 *   · TSP              → Held-Karp's cost.
 * ---------------------------------------------------------------------------
 */

import { performance } from 'node:perf_hooks';
import { buildWeighted, edgeEnergy, euclid, generateGraph, parseNodeId } from './graph';
import {
  aStar,
  bellmanFord,
  dijkstra,
  floydWarshall,
  floydWarshallMatrix,
  type FloydResult,
  type PathRun,
} from './pathfinding';
import { MAX_TSP_STOPS, tspExact, tspNearestNeighbour, type TspRun } from './tsp';
import {
  ALGORITHM_IDS,
  PATHFINDING_IDS,
  TSP_IDS,
  type AlgorithmId,
  type AlgorithmResult,
  type CostMode,
  type LabGraph,
} from './types';

export const LABELS: Record<AlgorithmId, string> = {
  dijkstra: 'Dijkstra',
  astar: 'A*',
  bellmanFord: 'Bellman-Ford',
  floydWarshall: 'Floyd-Warshall',
  tspExact: 'TSP · Held-Karp (exact)',
  tspNearestNeighbour: 'TSP · Nearest neighbour',
};

export interface CompareInput {
  nodes: number;
  seed: number;
  mode: CostMode;
  /** 0–1: share of downhill energy recovered by regenerative braking. */
  regenStrength: number;
  /** A* heuristic multiplier; 1 = standard. */
  astarWeight: number;
  start?: string;
  end?: string;
  /** Node ids to tour (first = start/end of the tour). 3–12 of them. */
  stops?: string[];
  algorithms?: AlgorithmId[];
}

export interface CompareOutput {
  graph: {
    nodes: number;
    edges: number;
    seed: number;
    mode: CostMode;
    regenStrength: number;
    hasNegativeEdges: boolean;
    unit: 'km' | 'energy';
  };
  /** Cost of the reference answer each `optimal` flag was judged against. */
  reference: { pathCost: number | null; tspCost: number | null };
  pathfinding: AlgorithmResult[];
  tsp: AlgorithmResult[];
}

/** A validation problem the caller caused (unknown node id, too many stops…). */
export class LabInputError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'LabInputError';
  }
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
}

function costsMatch(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

function toResult(
  graph: LabGraph,
  id: AlgorithmId,
  run: PathRun | TspRun,
  ms: number,
  referenceCost: number | null,
): AlgorithmResult {
  const ids = (indices: number[]): string[] => indices.map((i) => graph.nodes[i].id);
  const cost = run.cost === null ? null : Math.round(run.cost * 1e6) / 1e6;
  const result: AlgorithmResult = {
    algorithm: id,
    label: LABELS[id],
    path: ids(run.path),
    cost,
    nodesExplored: run.visited.length,
    visitedOrder: ids(run.visited),
    operations: run.operations,
    runtimeMs: Math.round(ms * 1000) / 1000,
    optimal: cost === null ? (referenceCost === null ? null : false) : referenceCost === null ? null : costsMatch(cost, referenceCost),
    reachable: run.cost !== null,
    notes: run.notes,
  };
  if ('tour' in run) result.tour = ids(run.tour);
  return result;
}

export function compareAlgorithms(input: CompareInput): CompareOutput {
  const graph = generateGraph(input.nodes, input.seed);
  const weighted = buildWeighted(graph, input.mode, input.regenStrength);
  const hasPair = input.start !== undefined && input.end !== undefined;
  const hasStops = input.stops !== undefined;
  // No explicit selection → run whatever the inputs make possible.
  const wanted = new Set<AlgorithmId>(
    input.algorithms ?? ALGORITHM_IDS.filter((id) => (PATHFINDING_IDS as readonly string[]).includes(id) ? hasPair : hasStops),
  );

  const resolve = (id: string, field: string): number => {
    const index = parseNodeId(graph, id);
    if (index === -1) throw new LabInputError(`Unknown node id '${id}' (graph has n0…n${graph.nodes.length - 1})`, field);
    return index;
  };

  const wantsPath = PATHFINDING_IDS.some((id) => wanted.has(id));
  const wantsTsp = TSP_IDS.some((id) => wanted.has(id));
  if (wantsPath && !hasPair) throw new LabInputError('start and end are required to run a pathfinding algorithm', 'start');
  if (wantsTsp && !hasStops) throw new LabInputError('stops are required to run a TSP algorithm', 'stops');
  if (!wantsPath && !wantsTsp) throw new LabInputError('Provide start+end and/or stops', 'start');

  const pathfinding: AlgorithmResult[] = [];
  const tsp: AlgorithmResult[] = [];
  let referencePath: number | null = null;
  let referenceTsp: number | null = null;
  let matrix: FloydResult | null = null;

  if (wantsPath) {
    const start = resolve(input.start!, 'start');
    const end = resolve(input.end!, 'end');

    // Bellman-Ford is always run: it is the reference, and a selected entry if asked for.
    const bf = timed(() => bellmanFord(weighted, start, end));
    referencePath = bf.value.negativeCycle ? null : bf.value.cost;

    const runs: Array<[AlgorithmId, () => PathRun & { matrix?: FloydResult }]> = [
      ['dijkstra', () => dijkstra(weighted, start, end)],
      ['astar', () => aStar(weighted, graph, start, end, input.astarWeight)],
      ['floydWarshall', () => floydWarshall(weighted, start, end)],
    ];
    for (const id of PATHFINDING_IDS) {
      if (!wanted.has(id)) continue;
      if (id === 'bellmanFord') {
        pathfinding.push(toResult(graph, id, bf.value, bf.ms, referencePath));
        continue;
      }
      const entry = runs.find(([key]) => key === id)!;
      const t = timed(entry[1]);
      if (t.value.matrix) matrix = t.value.matrix;
      pathfinding.push(toResult(graph, id, t.value, t.ms, referencePath));
    }
  }

  if (wantsTsp && input.stops) {
    const stops = input.stops.map((id) => resolve(id, 'stops'));
    if (new Set(stops).size !== stops.length) throw new LabInputError('stops must be distinct', 'stops');
    if (stops.length < 3) throw new LabInputError('TSP needs at least 3 stops', 'stops');
    if (stops.length > MAX_TSP_STOPS) throw new LabInputError(`TSP supports at most ${MAX_TSP_STOPS} stops`, 'stops');

    matrix ??= floydWarshallMatrix(weighted);
    const exact = timed(() => tspExact(matrix!, stops));
    referenceTsp = exact.value.cost;
    if (wanted.has('tspExact')) tsp.push(toResult(graph, 'tspExact', exact.value, exact.ms, referenceTsp));
    if (wanted.has('tspNearestNeighbour')) {
      const nn = timed(() => tspNearestNeighbour(matrix!, stops));
      tsp.push(toResult(graph, 'tspNearestNeighbour', nn.value, nn.ms, referenceTsp));
    }
  }

  return {
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      seed: graph.seed,
      mode: input.mode,
      regenStrength: input.regenStrength,
      hasNegativeEdges: weighted.hasNegativeEdges,
      unit: input.mode === 'energy' ? 'energy' : 'km',
    },
    reference: { pathCost: referencePath, tspCost: referenceTsp },
    pathfinding,
    tsp,
  };
}

/** The graph in a drawable form: every road once, with both directions' energy. */
export function describeGraph(nodeCount: number, seed: number, regen: number) {
  const graph = generateGraph(nodeCount, seed);
  const roads = graph.edges
    .filter((edge) => edge.from < edge.to)
    .map((edge) => {
      const back = graph.edges.find((e) => e.from === edge.to && e.to === edge.from)!;
      return {
        a: graph.nodes[edge.from].id,
        b: graph.nodes[edge.to].id,
        distance: edge.distance,
        rise: edge.rise,
        energyAB: edgeEnergy(edge, regen),
        energyBA: edgeEnergy(back, regen),
      };
    });
  return { seed, nodes: graph.nodes, roads };
}

export interface BenchmarkRow {
  size: number;
  edges: number;
  /** Median runtime in ms per algorithm; TSP rows use min(8, size) stops. */
  runtimeMs: Record<AlgorithmId, number>;
  nodesExplored: Record<AlgorithmId, number>;
}

export function benchmark(
  sizes: number[],
  seed: number,
  mode: CostMode,
  regenStrength: number,
  repeats: number,
): { rows: BenchmarkRow[]; tspStops: number } {
  const rows: BenchmarkRow[] = [];
  const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

  for (const size of sizes) {
    const graph = generateGraph(size, seed);
    const weighted = buildWeighted(graph, mode, regenStrength);
    // Far-apart endpoints give the algorithms something to chew on.
    let end = 0;
    let far = -1;
    for (let i = 1; i < size; i += 1) {
      const d = euclid(graph.nodes[0], graph.nodes[i]);
      if (d > far) {
        far = d;
        end = i;
      }
    }
    const stopCount = Math.min(8, size);
    const stops = Array.from({ length: stopCount }, (_, i) => Math.floor((i * size) / stopCount));
    const matrix = floydWarshallMatrix(weighted);

    const samples: Record<AlgorithmId, number[]> = {
      dijkstra: [], astar: [], bellmanFord: [], floydWarshall: [], tspExact: [], tspNearestNeighbour: [],
    };
    const explored: Record<AlgorithmId, number> = {
      dijkstra: 0, astar: 0, bellmanFord: 0, floydWarshall: 0, tspExact: 0, tspNearestNeighbour: 0,
    };
    for (let r = 0; r < repeats; r += 1) {
      const runs: Array<[AlgorithmId, () => PathRun]> = [
        ['dijkstra', () => dijkstra(weighted, 0, end)],
        ['astar', () => aStar(weighted, graph, 0, end, 1)],
        ['bellmanFord', () => bellmanFord(weighted, 0, end)],
        ['floydWarshall', () => floydWarshall(weighted, 0, end)],
        ['tspExact', () => tspExact(matrix, stops)],
        ['tspNearestNeighbour', () => tspNearestNeighbour(matrix, stops)],
      ];
      for (const [id, fn] of runs) {
        const t = timed(fn);
        samples[id].push(t.ms);
        explored[id] = t.value.visited.length;
      }
    }
    const runtimeMs = {} as Record<AlgorithmId, number>;
    for (const id of ALGORITHM_IDS) runtimeMs[id] = Math.round(median(samples[id]) * 1000) / 1000;
    rows.push({ size, edges: graph.edges.length, runtimeMs, nodesExplored: explored });
  }
  return { rows, tspStops: Math.min(8, Math.min(...sizes)) };
}
