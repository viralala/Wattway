/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * algorithmController.ts — Algorithm Lab endpoints.
 *
 *   POST /api/algorithms/compare    run algorithms on the same input
 *   GET  /api/algorithms/graph      the generated road graph, for drawing
 *   POST /api/algorithms/benchmark  runtime vs graph size
 *
 * Pure computation over a seeded generated graph: no database, no auth, no
 * dependency on the station models. All the logic lives in algorithms/lab/.
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import {
  benchmark,
  compareAlgorithms,
  describeGraph,
  LabInputError,
  type AlgorithmId,
  type CostMode,
} from '../algorithms/lab';
import { ApiError } from '../utils/ApiError';
import { ok } from '../utils/respond';

interface CompareBody {
  nodes: number;
  seed: number;
  mode: CostMode;
  regenStrength: number;
  astarWeight: number;
  start?: string;
  end?: string;
  stops?: string[];
  algorithms?: AlgorithmId[];
}

export async function compare(req: Request, res: Response): Promise<void> {
  const body = req.body as CompareBody;
  try {
    const result = compareAlgorithms(body);
    ok(res, result, { explain: { generatedGraph: true, referenceAlgorithm: 'bellmanFord / tspExact' } });
  } catch (error) {
    if (error instanceof LabInputError) {
      throw ApiError.validation(error.message, [{ target: 'body', path: error.field, message: error.message }]);
    }
    throw error;
  }
}

export async function graph(req: Request, res: Response): Promise<void> {
  const { nodes, seed, regenStrength } = req.query as unknown as {
    nodes: number;
    seed: number;
    regenStrength: number;
  };
  ok(res, describeGraph(nodes, seed, regenStrength));
}

export async function runBenchmark(req: Request, res: Response): Promise<void> {
  const { sizes, seed, mode, regenStrength, repeats } = req.body as {
    sizes: number[];
    seed: number;
    mode: CostMode;
    regenStrength: number;
    repeats: number;
  };
  const result = benchmark([...sizes].sort((a, b) => a - b), seed, mode, regenStrength, repeats);
  ok(res, result, {
    explain: {
      note: 'Median of `repeats` runs. TSP rows use a shared all-pairs matrix, so their runtime excludes the matrix build.',
    },
  });
}
