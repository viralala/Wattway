/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * algorithms.test.ts — the Algorithm Lab over HTTP. The Lab is database-free, so
 * this suite needs no mongod.
 * ---------------------------------------------------------------------------
 */

import request from 'supertest';
import { app } from '../../src/app';

describe('POST /api/algorithms/compare', () => {
  it('compares all four pathfinding algorithms on one input', async () => {
    const res = await request(app)
      .post('/api/algorithms/compare')
      .send({ nodes: 50, seed: 4, start: 'n0', end: 'n49' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { pathfinding, graph } = res.body.data;
    expect(graph.nodes).toBe(50);
    expect(pathfinding).toHaveLength(4);
    for (const r of pathfinding) {
      expect(r).toEqual(
        expect.objectContaining({
          path: expect.any(Array),
          cost: expect.any(Number),
          nodesExplored: expect.any(Number),
          visitedOrder: expect.any(Array),
          runtimeMs: expect.any(Number),
          optimal: true,
        }),
      );
    }
  });

  it('accepts a list of stops for TSP and returns exact vs nearest-neighbour', async () => {
    const res = await request(app)
      .post('/api/algorithms/compare')
      .send({ nodes: 40, seed: 2, stops: ['n0', 'n8', 'n16', 'n24', 'n32'] });

    expect(res.status).toBe(200);
    const [exact, nn] = res.body.data.tsp;
    expect(exact.algorithm).toBe('tspExact');
    expect(nn.algorithm).toBe('tspNearestNeighbour');
    expect(nn.cost).toBeGreaterThanOrEqual(exact.cost - 1e-9);
    expect(exact.tour).toHaveLength(6);
  });

  it('energy mode exposes negative edges and marks Dijkstra as unreliable', async () => {
    const res = await request(app)
      .post('/api/algorithms/compare')
      .send({ nodes: 80, seed: 5, mode: 'energy', regenStrength: 1, start: 'n0', end: 'n79' });

    expect(res.status).toBe(200);
    expect(res.body.data.graph.hasNegativeEdges).toBe(true);
    const bf = res.body.data.pathfinding.find((r: { algorithm: string }) => r.algorithm === 'bellmanFord');
    const dj = res.body.data.pathfinding.find((r: { algorithm: string }) => r.algorithm === 'dijkstra');
    expect(bf.optimal).toBe(true);
    expect(dj.notes.join(' ')).toMatch(/negative/i);
  });

  it('weighted A* runs and reports the heuristic weight', async () => {
    const res = await request(app)
      .post('/api/algorithms/compare')
      .send({ nodes: 100, seed: 1, astarWeight: 5, start: 'n0', end: 'n99', algorithms: ['astar'] });
    expect(res.status).toBe(200);
    expect(res.body.data.pathfinding[0].notes.join(' ')).toMatch(/Heuristic weight 5/);
  });

  it.each([
    ['unknown node', { start: 'n0', end: 'n500' }],
    ['malformed node id', { start: 'zero', end: 'n1' }],
    ['start without end', { start: 'n0' }],
    ['nothing to run', {}],
    ['too few stops', { stops: ['n0', 'n1'] }],
    ['too many stops', { stops: Array.from({ length: 13 }, (_, i) => `n${i}`) }],
    ['regen out of range', { start: 'n0', end: 'n1', regenStrength: 2 }],
    ['too many nodes', { nodes: 5000, start: 'n0', end: 'n1' }],
    ['duplicate stops', { stops: ['n0', 'n1', 'n1'] }],
  ])('rejects %s with 422', async (_label, body) => {
    const res = await request(app).post('/api/algorithms/compare').send(body);
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/algorithms/graph', () => {
  it('returns drawable nodes and roads, reproducibly', async () => {
    const a = await request(app).get('/api/algorithms/graph?nodes=30&seed=9&regenStrength=0.5');
    const b = await request(app).get('/api/algorithms/graph?nodes=30&seed=9&regenStrength=0.5');
    expect(a.status).toBe(200);
    expect(a.body.data.nodes).toHaveLength(30);
    expect(a.body.data.roads.length).toBeGreaterThanOrEqual(29);
    expect(a.body.data).toEqual(b.body.data);
  });

  it('validates its query', async () => {
    expect((await request(app).get('/api/algorithms/graph?nodes=2')).status).toBe(422);
  });
});

describe('POST /api/algorithms/benchmark', () => {
  it('returns runtime per algorithm per graph size', async () => {
    const res = await request(app).post('/api/algorithms/benchmark').send({ sizes: [20, 60], repeats: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows[0].runtimeMs).toHaveProperty('dijkstra');
    expect(res.body.data.rows[0].runtimeMs).toHaveProperty('tspExact');
  });

  it('rejects oversized graphs', async () => {
    expect((await request(app).post('/api/algorithms/benchmark').send({ sizes: [10000] })).status).toBe(422);
  });
});

describe('POST /api/algorithms/ev-route', () => {
  it('plans a battery-aware route with the charger list it used', async () => {
    const res = await request(app)
      .post('/api/algorithms/ev-route')
      .send({ nodes: 40, seed: 1, start: 'n0', end: 'n39', capacity: 15, startCharge: 0.6 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.stations)).toBe(true);
    expect(res.body.data).toHaveProperty('chargeStops');
    if (res.body.data.reachable) expect(res.body.data.path[0]).toBe('n0');
  });

  it('rejects a node outside the graph', async () => {
    const res = await request(app).post('/api/algorithms/ev-route').send({ nodes: 10, start: 'n0', end: 'n99' });
    expect(res.status).toBe(422);
  });
});
