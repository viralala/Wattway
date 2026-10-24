/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Algorithm Lab barrel. Self-contained: nothing here is exported from the
 * parent `algorithms/index.ts`, so it cannot clash with the Routing module's
 * `dijkstra` / `Graph` / `MinHeap` when those land.
 * ---------------------------------------------------------------------------
 */

export { compareAlgorithms, describeGraph, benchmark, LabInputError, LABELS } from './compare';
export type { CompareInput, CompareOutput, BenchmarkRow } from './compare';
export { generateGraph, buildWeighted, edgeEnergy } from './graph';
export { dijkstra, aStar, bellmanFord, floydWarshall, floydWarshallMatrix, floydPath } from './pathfinding';
export { kruskal, prim, DisjointSet } from './mst';
export { tspExact, tspNearestNeighbour, MAX_TSP_STOPS } from './tsp';
export { LabMinHeap } from './MinHeap';
export * from './types';
export { evRoute, pickStations } from './evRoute';
export type { EvRouteOptions, EvRouteResult, ChargeStop } from './evRoute';
