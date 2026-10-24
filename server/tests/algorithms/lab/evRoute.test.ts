/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * evRoute.test.ts — battery-aware A*, on hand-built roads and generated maps.
 * No database.
 * ---------------------------------------------------------------------------
 */

import { generateGraph } from '../../../src/algorithms/lab/graph';
import { evRoute, pickStations, type EvRouteOptions } from '../../../src/algorithms/lab/evRoute';
import { aStar } from '../../../src/algorithms/lab/pathfinding';
import { buildWeighted } from '../../../src/algorithms/lab/graph';
import type { LabGraph } from '../../../src/algorithms/lab/types';

/** A flat straight line of nodes 10 km apart: n0 — n1 — n2 — n3. */
function line(count: number, gapKm = 10): LabGraph {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, x: i * gapKm, y: 0, elevation: 0 }));
  const edges = [];
  for (let i = 0; i + 1 < count; i += 1) {
    edges.push({ from: i, to: i + 1, distance: gapKm, rise: 0 });
    edges.push({ from: i + 1, to: i, distance: gapKm, rise: 0 });
  }
  return { nodes, edges, seed: 0 };
}

const base = (overrides: Partial<EvRouteOptions>): EvRouteOptions => ({
  start: 0,
  end: 3,
  capacity: 40,
  startCharge: 1,
  reserve: 0,
  chargeRate: 1,
  speedKmh: 60,
  regen: 0,
  stations: [],
  ...overrides,
});

describe('evRoute', () => {
  it('drives straight through when the battery is enough', () => {
    const result = evRoute(line(4), base({}));
    expect(result.reachable).toBe(true);
    expect(result.path).toEqual(['n0', 'n1', 'n2', 'n3']);
    expect(result.chargeStops).toEqual([]);
    expect(result.totalMinutes).toBe(30);
    expect(result.arrivalCharge).toBeCloseTo(0.25);
  });

  it('is unreachable when no charger can cover the gap', () => {
    const result = evRoute(line(4), base({ capacity: 20 }));
    expect(result.reachable).toBe(false);
    expect(result.path).toEqual([]);
  });

  it('charges only as much as the rest of the trip needs', () => {
    // 30 km trip, 20-unit battery, charger at n1 → needs +10 units there, not a full top-up.
    const result = evRoute(line(4), base({ capacity: 20, stations: [1] }));
    expect(result.reachable).toBe(true);
    expect(result.chargeStops).toHaveLength(1);
    expect(result.chargeStops[0].station).toBe('n1');
    expect(result.chargeMinutes).toBe(10);
    expect(result.totalMinutes).toBe(40);
    expect(result.arrivalCharge).toBe(0);
  });

  it('respects the reserve', () => {
    const result = evRoute(line(4), base({ capacity: 40, reserve: 0.5, stations: [1, 2] }));
    expect(result.reachable).toBe(true);
    expect(result.arrivalCharge!).toBeGreaterThanOrEqual(0.5);
  });

  it('matches plain A* time when the battery is unlimited', () => {
    const graph = generateGraph(60, 7);
    const plain = aStar(buildWeighted(graph, 'distance', 0.6), graph, 0, 59);
    const ev = evRoute(graph, base({ start: 0, end: 59, capacity: 1000, regen: 0.6, stepEnergy: 5 }));
    expect(ev.reachable).toBe(true);
    expect(ev.totalMinutes).toBeCloseTo(plain.cost!, 2); // 60 km/h → minutes == km
  });

  it('plans charging stops on a generated map with a small battery', () => {
    const graph = generateGraph(80, 3);
    const stations = pickStations(graph, 3, 0.3, [0]);
    const ev = evRoute(graph, base({ start: 0, end: 79, capacity: 12, regen: 0.6, stations, stepEnergy: 0.5 }));
    if (ev.reachable) {
      expect(ev.path[0]).toBe('n0');
      expect(ev.path[ev.path.length - 1]).toBe('n79');
      expect(ev.totalMinutes!).toBeCloseTo(ev.driveMinutes! + ev.chargeMinutes!, 3);
      for (const stop of ev.chargeStops) expect(stations).toContain(Number(stop.station.slice(1)));
    }
    expect(ev.statesExplored).toBeGreaterThan(0);
  });

  it('picks the same stations for the same seed', () => {
    const graph = generateGraph(50, 9);
    expect(pickStations(graph, 9)).toEqual(pickStations(graph, 9));
    expect(pickStations(graph, 9, 0.2, [0])).not.toContain(0);
  });
});
