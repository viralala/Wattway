/**
 * WattWay · Team Kothimbir 🌿
 * algorithms.ts — typed client for /api/algorithms (the Algorithm Lab).
 */
import { request } from './api';

export type CostMode = 'distance' | 'energy';

export type AlgorithmId = 'dijkstra' | 'astar' | 'kruskal' | 'prim' | 'tspExact' | 'tspNearestNeighbour';

export interface LabNode {
  id: string;
  x: number;
  y: number;
  elevation: number;
}

export interface LabRoad {
  a: string;
  b: string;
  distance: number;
  rise: number;
  energyAB: number;
  energyBA: number;
}

export interface LabGraphData {
  seed: number;
  nodes: LabNode[];
  roads: LabRoad[];
}

export interface AlgorithmResult {
  algorithm: AlgorithmId;
  label: string;
  path: string[];
  cost: number | null;
  /** Spanning trees are always in km; the rest follow the cost mode. */
  unit: 'km' | 'energy';
  /** Roads committed to, in order: the search tree (Dijkstra / A*) or the spanning tree (Kruskal / Prim). */
  treeEdges: Array<[string, string]>;
  nodesExplored: number;
  visitedOrder: string[];
  operations: number;
  runtimeMs: number;
  optimal: boolean | null;
  reachable: boolean;
  notes: string[];
  tour?: string[];
}

export interface CompareRequest {
  nodes: number;
  seed: number;
  mode: CostMode;
  regenStrength: number;
  astarWeight: number;
  start: string;
  end: string;
  stops?: string[];
}

export interface CompareResponse {
  graph: { nodes: number; edges: number; seed: number; mode: CostMode; hasNegativeEdges: boolean; unit: 'km' | 'energy' };
  reference: { pathCost: number | null; mstCost: number | null; tspCost: number | null };
  pathfinding: AlgorithmResult[];
  mst: AlgorithmResult[];
  tsp: AlgorithmResult[];
}

export interface BenchmarkRow {
  size: number;
  edges: number;
  runtimeMs: Record<AlgorithmId, number>;
  nodesExplored: Record<AlgorithmId, number>;
}

export const fetchGraph = (nodes: number, seed: number, regenStrength: number, signal?: AbortSignal) =>
  request<LabGraphData>(`/api/algorithms/graph?nodes=${nodes}&seed=${seed}&regenStrength=${regenStrength}`, { signal });

export const compare = (body: CompareRequest, signal?: AbortSignal) =>
  request<CompareResponse>('/api/algorithms/compare', { method: 'POST', body: JSON.stringify(body), signal });

export const runBenchmark = (
  body: { sizes: number[]; seed: number; mode: CostMode; regenStrength: number; repeats: number },
  signal?: AbortSignal,
) =>
  request<{ rows: BenchmarkRow[]; tspStops: number }>('/api/algorithms/benchmark', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });
