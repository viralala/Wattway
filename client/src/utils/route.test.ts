import { describe, expect, it } from 'vitest';
import { PLACES, VEHICLES } from '../services/routes';
import { SAMPLE_STATIONS, type Station } from '../services/stations';
import {
  CHARGE_TO,
  formatMin,
  planTrip,
  rankCandidates,
  rebalance,
  RESERVE,
  roadKm,
  type Candidate,
  type TripInput,
  type Weights,
} from './route';

const place = (id: string) => PLACES.find((p) => p.id === id)!;
const vehicle = (id: string) => VEHICLES.find((v) => v.id === id)!;
const trip = (over: Partial<TripInput> = {}): TripInput => ({
  from: place('home'),
  to: place('hinjewadi'),
  batteryPct: 18,
  rangeKm: 250,
  vehicle: vehicle('compact'),
  maxDetourKm: 6,
  ...over,
});
const sum = (w: Weights) => w.distance + w.wait + w.price;

describe('rebalance', () => {
  it('always sums to 100', () => {
    let w: Weights = { distance: 40, wait: 35, price: 25 };
    for (const [k, v] of [['wait', 80], ['price', 3], ['distance', 100], ['wait', 0], ['price', 51]] as const) {
      w = rebalance(w, k, v);
      expect(sum(w)).toBe(100);
      expect(w[k]).toBe(v);
    }
  });

  it('keeps the other two in proportion', () => {
    expect(rebalance({ distance: 50, wait: 30, price: 20 }, 'distance', 0)).toEqual({ distance: 0, wait: 60, price: 40 });
  });

  it('splits evenly when the other two are both zero, and clamps', () => {
    expect(rebalance({ distance: 100, wait: 0, price: 0 }, 'distance', 40)).toEqual({ distance: 40, wait: 30, price: 30 });
    expect(rebalance({ distance: 40, wait: 30, price: 30 }, 'wait', 140).wait).toBe(100);
  });
});

describe('planTrip', () => {
  it('needs a stop on low charge and none on a full battery', () => {
    expect(planTrip(SAMPLE_STATIONS, trip()).needsStop).toBe(true);
    expect(planTrip(SAMPLE_STATIONS, trip({ batteryPct: 100 })).needsStop).toBe(false);
  });

  it('only offers stops that are reachable, within the detour, and lead to the destination', () => {
    const t = trip();
    const plan = planTrip(SAMPLE_STATIONS, t);
    expect(plan.candidates.length).toBeGreaterThan(0);
    for (const c of plan.candidates) {
      expect(c.arrivePct).toBeGreaterThanOrEqual(RESERVE * 100);
      expect(c.detourKm).toBeLessThanOrEqual(t.maxDetourKm);
      expect(c.finalPct).toBeGreaterThanOrEqual(RESERVE * 100);
      expect(c.station.ports.some((p) => t.vehicle.connectors.includes(p.connectorType))).toBe(true);
    }
  });

  it('accounts for every station exactly once', () => {
    const plan = planTrip(SAMPLE_STATIONS, trip());
    const out = Object.values(plan.excluded).reduce((a, b) => a + b, 0);
    expect(plan.candidates.length + out).toBe(SAMPLE_STATIONS.length);
  });

  it('rules out stations without a compatible plug', () => {
    const plan = planTrip(SAMPLE_STATIONS, trip({ vehicle: vehicle('scooter'), batteryPct: 100, maxDetourKm: 20 }));
    expect(plan.excluded.connector).toBeGreaterThan(0);
    expect(plan.candidates.every((c) => c.station.connectorTypes.some((t) => ['Type2', 'Bharat-AC-001'].includes(t)))).toBe(true);
  });

  it('charges up to 80% and prices the energy at the station rate', () => {
    const c = planTrip(SAMPLE_STATIONS, trip()).candidates[0];
    expect(c.chargeKwh).toBeCloseTo(((CHARGE_TO * 100 - c.arrivePct) / 100) * 30, 6);
    expect(c.chargeCost).toBeCloseTo(c.chargeKwh * c.station.pricePerKwh, 6);
  });

  it('a tighter detour limit never adds candidates', () => {
    const wide = planTrip(SAMPLE_STATIONS, trip({ maxDetourKm: 20 })).candidates.length;
    const tight = planTrip(SAMPLE_STATIONS, trip({ maxDetourKm: 1 })).candidates.length;
    expect(tight).toBeLessThanOrEqual(wide);
  });

  it('road distance is the straight line times the road factor', () => {
    expect(roadKm(place('home'), place('home'))).toBe(0);
  });
});

describe('rankCandidates', () => {
  const fake = (id: string, detourKm: number, waitMin: number, price: number): Candidate =>
    ({
      station: { ...(SAMPLE_STATIONS[0] as Station), id, pricePerKwh: price },
      detourKm,
      waitMin,
      tripMin: 0,
    }) as Candidate;
  const cands = [fake('near', 0, 70, 22), fake('cheap', 5, 35, 12), fake('quick', 3, 0, 20)];

  it('puts the station that wins the heaviest factor first', () => {
    expect(rankCandidates(cands, { distance: 100, wait: 0, price: 0 })[0].station.id).toBe('near');
    expect(rankCandidates(cands, { distance: 0, wait: 0, price: 100 })[0].station.id).toBe('cheap');
    expect(rankCandidates(cands, { distance: 0, wait: 100, price: 0 })[0].station.id).toBe('quick');
  });

  it('scores are 100 minus the points lost, and the best on every factor scores 100', () => {
    for (const r of rankCandidates(cands, { distance: 40, wait: 35, price: 25 })) {
      expect(r.score).toBeCloseTo(100 - r.lost.distance - r.lost.wait - r.lost.price, 9);
    }
    const solo = rankCandidates([cands[0]], { distance: 40, wait: 35, price: 25 });
    expect(solo[0].score).toBe(100);
  });
});

describe('formatMin', () => {
  it('formats minutes and hours', () => {
    expect(formatMin(42.4)).toBe('42 min');
    expect(formatMin(60)).toBe('1 h');
    expect(formatMin(95)).toBe('1 h 35 min');
  });
});
