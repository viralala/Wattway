/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * tsp.test.ts — Held-Karp (exact) vs nearest neighbour. No database.
 * ---------------------------------------------------------------------------
 */

import { buildWeighted, generateGraph } from '../../../src/algorithms/lab/graph';
import { floydWarshallMatrix, type FloydResult } from '../../../src/algorithms/lab/pathfinding';
import { tspExact, tspNearestNeighbour } from '../../../src/algorithms/lab/tsp';

function setup(nodes: number, seed: number) {
  const graph = generateGraph(nodes, seed);
  const weighted = buildWeighted(graph, 'distance', 0);
  return { graph, weighted, matrix: floydWarshallMatrix(weighted) };
}

function bruteForce(matrix: FloydResult, stops: number[]): number {
  const rest = stops.slice(1);
  let best = Infinity;
  const permute = (arr: number[], used: boolean[], order: number[]): void => {
    if (order.length === arr.length) {
      let cost = matrix.dist[stops[0] * matrix.size + order[0]];
      for (let i = 0; i < order.length - 1; i += 1) cost += matrix.dist[order[i] * matrix.size + order[i + 1]];
      cost += matrix.dist[order[order.length - 1] * matrix.size + stops[0]];
      best = Math.min(best, cost);
      return;
    }
    for (let i = 0; i < arr.length; i += 1) {
      if (used[i]) continue;
      used[i] = true;
      permute(arr, used, [...order, arr[i]]);
      used[i] = false;
    }
  };
  permute(rest, new Array(rest.length).fill(false), []);
  return best;
}

describe('TSP', () => {
  it('Held-Karp matches brute force on small instances', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { matrix } = setup(40, seed);
      const stops = [0, 7, 13, 21, 30, 38];
      expect(tspExact(matrix, stops).cost!).toBeCloseTo(bruteForce(matrix, stops), 6);
    }
  });

  it('works with the minimum of 3 stops', () => {
    const { matrix } = setup(20, 1);
    const run = tspExact(matrix, [0, 5, 11]);
    expect(run.tour).toHaveLength(4);
    expect(run.cost).not.toBeNull();
  });

  it('both tours start and end at the first stop and visit every stop once', () => {
    const { matrix } = setup(50, 2);
    const stops = [4, 9, 17, 25, 33, 41, 48];
    for (const run of [tspExact(matrix, stops), tspNearestNeighbour(matrix, stops)]) {
      expect(run.tour[0]).toBe(4);
      expect(run.tour[run.tour.length - 1]).toBe(4);
      expect([...run.tour.slice(0, -1)].sort((a, b) => a - b)).toEqual([...stops].sort((a, b) => a - b));
      expect(run.visited).toEqual(run.tour.slice(0, -1));
    }
  });

  it('exact is never worse than the heuristic, and strictly better on some inputs', () => {
    let nnWorse = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const { matrix } = setup(60, seed);
      const stops = [0, 6, 12, 18, 24, 30, 36, 42, 48];
      const exact = tspExact(matrix, stops).cost!;
      const nn = tspNearestNeighbour(matrix, stops).cost!;
      expect(nn).toBeGreaterThanOrEqual(exact - 1e-9);
      if (nn > exact + 1e-6) nnWorse += 1;
    }
    expect(nnWorse).toBeGreaterThan(0);
  });

  it('the expanded road path is contiguous and its cost equals the tour cost', () => {
    const { weighted, matrix } = setup(50, 5);
    const run = tspExact(matrix, [0, 10, 20, 30, 40]);
    let sum = 0;
    for (let i = 0; i < run.path.length - 1; i += 1) {
      const arc = weighted.adjacency[run.path[i]].find((a) => a.to === run.path[i + 1]);
      expect(arc).toBeDefined();
      sum += arc!.weight;
    }
    expect(sum).toBeCloseTo(run.cost!, 6);
    expect(run.path[0]).toBe(0);
    expect(run.path[run.path.length - 1]).toBe(0);
  });

  it('reports DP states for exact and fewer operations for the heuristic', () => {
    const { matrix } = setup(60, 1);
    const stops = [0, 5, 10, 15, 20, 25, 30, 35];
    const exact = tspExact(matrix, stops);
    const nn = tspNearestNeighbour(matrix, stops);
    expect(exact.notes.join(' ')).toMatch(/DP states/);
    expect(nn.operations).toBeLessThan(exact.operations);
  });
});
