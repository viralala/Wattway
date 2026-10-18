/**
 * WattWay · Team Kothimbir 🌿
 * route.ts — pure route-planner logic: is a charging stop needed, which
 * stations are viable, and how they rank under the driver's weights.
 *
 * This is a stand-in for the routing module (Dijkstra over the road graph).
 * Road distance is approximated as straight-line × ROAD_FACTOR, which is
 * honest enough for a city-scale preview and keeps the page backend-free.
 */
import type { ConnectorType, LatLng, Station } from '../services/stations';
import { haversineKm, SESSION_MIN } from './stations';

export const ROAD_FACTOR = 1.3; // roads wind; crow-flies distance undersells them
export const CITY_KMH = 24; // average Pune city speed
export const RESERVE = 0.1; // never plan to arrive below 10%
export const CHARGE_TO = 0.8; // DC charging slows sharply past 80%

export interface Vehicle {
  id: string;
  label: string;
  capacityKwh: number;
  rangeKm: number;
  maxKw: number;
  connectors: ConnectorType[];
}

export interface TripInput {
  from: LatLng;
  to: LatLng;
  batteryPct: number;
  rangeKm: number;
  vehicle: Vehicle;
  maxDetourKm: number;
}

export interface Candidate {
  station: Station;
  legKm: number; // from → station
  onwardKm: number; // station → to
  detourKm: number; // extra distance versus driving direct
  arrivePct: number; // battery on arrival at the station
  waitMin: number;
  chargeKwh: number;
  chargeMin: number;
  chargeCost: number;
  tripMin: number; // driving + waiting + charging
  finalPct: number; // battery on arrival at the destination
}

export type Exclusion = 'connector' | 'offline' | 'range' | 'detour' | 'onward';

export interface RoutePlan {
  directKm: number;
  directMin: number;
  arrivePctDirect: number;
  needsStop: boolean;
  candidates: Candidate[];
  excluded: Record<Exclusion, number>;
}

export const roadKm = (a: LatLng, b: LatLng) => haversineKm(a, b) * ROAD_FACTOR;
const driveMin = (km: number) => (km / CITY_KMH) * 60;

/** Wait for a port this vehicle can actually use. */
function compatibleWait(s: Station, v: Vehicle): number {
  const usable = s.ports.filter((p) => v.connectors.includes(p.connectorType) && p.status !== 'faulted');
  if (usable.some((p) => p.status === 'free')) return 0;
  return Math.ceil((s.queueLength + 1) / usable.length) * SESSION_MIN;
}

export function planTrip(stations: Station[], t: TripInput): RoutePlan {
  const directKm = roadKm(t.from, t.to);
  const pctPerKm = 100 / t.rangeKm;
  const arrivePctDirect = t.batteryPct - directKm * pctPerKm;
  const floor = RESERVE * 100;
  const excluded: Record<Exclusion, number> = { connector: 0, offline: 0, range: 0, detour: 0, onward: 0 };
  const candidates: Candidate[] = [];

  for (const s of stations) {
    const ports = s.ports.filter((p) => t.vehicle.connectors.includes(p.connectorType));
    if (ports.length === 0) {
      excluded.connector += 1;
      continue;
    }
    if (ports.every((p) => p.status === 'faulted')) {
      excluded.offline += 1;
      continue;
    }
    const legKm = roadKm(t.from, s.location);
    const arrivePct = t.batteryPct - legKm * pctPerKm;
    if (arrivePct < floor) {
      excluded.range += 1;
      continue;
    }
    const onwardKm = roadKm(s.location, t.to);
    const detourKm = Math.max(0, legKm + onwardKm - directKm);
    if (detourKm > t.maxDetourKm) {
      excluded.detour += 1;
      continue;
    }
    const leavePct = Math.max(arrivePct, CHARGE_TO * 100);
    if (leavePct - onwardKm * pctPerKm < floor) {
      excluded.onward += 1;
      continue;
    }

    const kw = Math.min(t.vehicle.maxKw, Math.max(...ports.filter((p) => p.status !== 'faulted').map((p) => p.powerKw)));
    const chargeKwh = ((leavePct - arrivePct) / 100) * t.vehicle.capacityKwh;
    const chargeMin = (chargeKwh / kw) * 60;
    const waitMin = compatibleWait(s, t.vehicle);
    candidates.push({
      station: s,
      legKm,
      onwardKm,
      detourKm,
      arrivePct,
      waitMin,
      chargeKwh,
      chargeMin,
      chargeCost: chargeKwh * s.pricePerKwh,
      tripMin: driveMin(legKm + onwardKm) + waitMin + chargeMin,
      finalPct: leavePct - onwardKm * pctPerKm,
    });
  }

  return {
    directKm,
    directMin: driveMin(directKm),
    arrivePctDirect,
    needsStop: arrivePctDirect < floor,
    candidates,
    excluded,
  };
}

// ─── Weighted ranking ───────────────────────────────────────────────────────

export const WEIGHT_KEYS = ['distance', 'wait', 'price'] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export type Weights = Record<WeightKey, number>;

/**
 * Set one weight and share what's left between the other two in their
 * current proportion, so the three always sum to exactly 100.
 */
export function rebalance(w: Weights, key: WeightKey, value: number): Weights {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const [a, b] = WEIGHT_KEYS.filter((k) => k !== key);
  const rest = 100 - v;
  const sum = w[a] + w[b];
  const share = sum === 0 ? Math.ceil(rest / 2) : Math.round((rest * w[a]) / sum);
  return { ...w, [key]: v, [a]: share, [b]: rest - share } as Weights;
}

export interface Ranked extends Candidate {
  score: number;
  /** Points lost to each factor; score = 100 − their sum. */
  lost: Weights;
}

const METRIC: Record<WeightKey, (c: Candidate) => number> = {
  distance: (c) => c.detourKm,
  wait: (c) => c.waitMin,
  price: (c) => c.station.pricePerKwh,
};

/**
 * Min-max normalise each factor across the candidates (best = 0, worst = 1),
 * then lose `weight × normalised` points per factor. A factor where every
 * candidate ties costs nobody anything.
 */
export function rankCandidates(cands: Candidate[], w: Weights): Ranked[] {
  const range = Object.fromEntries(
    WEIGHT_KEYS.map((k) => {
      const vals = cands.map(METRIC[k]);
      return [k, [Math.min(...vals), Math.max(...vals)]];
    }),
  ) as Record<WeightKey, [number, number]>;

  return cands
    .map((c) => {
      const lost = Object.fromEntries(
        WEIGHT_KEYS.map((k) => {
          const [lo, hi] = range[k];
          const norm = hi === lo ? 0 : (METRIC[k](c) - lo) / (hi - lo);
          return [k, w[k] * norm];
        }),
      ) as Weights;
      return { ...c, lost, score: 100 - lost.distance - lost.wait - lost.price };
    })
    .sort((a, b) => b.score - a.score || a.tripMin - b.tripMin);
}

export function formatMin(min: number): string {
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
