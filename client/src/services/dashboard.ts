/**
 * WattWay · Team Kothimbir 🌿
 * dashboard.ts — data for the operator dashboard.
 *
 * HARDCODED for now. When the backend is wired up:
 *
 *   getOperatorSnapshot → request(`/api/stations?operator=${operator}`) + the queue module's
 *                         GET /api/queue/:stationId for each station
 *   setPortStatus       → request(`/api/stations/${id}/ports/${index}`, { method: 'PATCH',
 *                         body: JSON.stringify({ status }) })   ← this endpoint already exists
 *   removeFromQueue     → the queue module's operator removal endpoint
 *   getDayStats         → an analytics endpoint (not specified yet)
 *   getDistanceTable    → the routing module's road graph (GET /api/algorithms/graph is the lab's)
 *
 * Changes made on the page live in this module's memory for the session, so
 * switching operators and back keeps them. A reload resets everything.
 */
import { floydWarshall, type AllPairs, type Edge } from '../utils/floyd';
import { initSim } from '../utils/queueSim';
import { roadKm } from '../utils/route';
import { STATIONS, type PortStatus, type Station } from './stations';

export interface OpPort {
  index: number;
  connectorType: Station['ports'][number]['connectorType'];
  powerKw: number;
  status: PortStatus;
  plate: string | null;
  /** Minutes the current session has been running. */
  occupiedMin: number | null;
}

export interface Waiting {
  plate: string;
  waitingMin: number;
}

export interface OpStation {
  station: Station;
  ports: OpPort[];
  waiting: Waiting[];
}

export const OPERATORS = [...new Set(STATIONS.map((s) => s.operator))].sort();

// ─── In-memory store (stands in for the database) ──────────────────────────

const store = new Map<string, OpStation>();

/** Same plates and line as the queue page starts from, so the two pages agree. */
function seedStation(station: Station): OpStation {
  const sim = initSim(station);
  return {
    station,
    ports: sim.ports.map((p) => ({
      index: p.index,
      connectorType: p.connectorType,
      powerKw: p.powerKw,
      status: p.status,
      plate: p.driver?.plate ?? null,
      occupiedMin: p.status === 'occupied' ? Math.max(4, 70 - 2 * p.minsLeft) : null,
    })),
    waiting: sim.line.map((d, i) => ({ plate: d.plate, waitingMin: 6 * (sim.line.length - i) + 2 })),
  };
}

function get(id: string): OpStation {
  if (!store.has(id)) {
    const station = STATIONS.find((s) => s.id === id);
    if (!station) throw new Error(`No station ${id}`);
    store.set(id, seedStation(station));
  }
  return store.get(id) as OpStation;
}

/** Keep the station's derived counts in step with its ports and line. */
function save(op: OpStation): OpStation {
  const next: OpStation = {
    ...op,
    station: {
      ...op.station,
      ports: op.ports.map(({ index, connectorType, powerKw, status }) => ({ index, connectorType, powerKw, status })),
      freePorts: op.ports.filter((p) => p.status === 'free').length,
      queueLength: op.waiting.length,
    },
  };
  store.set(op.station.id, next);
  return next;
}

/** FIFO: a port that frees up goes straight to the driver at the front of the line. */
function serveLine(op: OpStation): OpStation {
  const ports = op.ports.map((p) => ({ ...p }));
  const waiting = [...op.waiting];
  for (const p of ports) {
    if (p.status === 'free' && waiting.length > 0) {
      const d = waiting.shift() as Waiting;
      Object.assign(p, { status: 'occupied', plate: d.plate, occupiedMin: 0 });
    }
  }
  return { ...op, ports, waiting };
}

// ─── Service functions ──────────────────────────────────────────────────────

export async function getOperatorSnapshot(operator: string): Promise<OpStation[]> {
  return STATIONS.filter((s) => s.operator === operator).map((s) => get(s.id));
}

export type PortAction = 'fault' | 'restore' | 'end';

/** fault: free → faulted · restore: faulted → free · end: stop an occupied session. */
export async function setPortStatus(stationId: string, index: number, action: PortAction): Promise<OpStation> {
  const op = get(stationId);
  const ports = op.ports.map((p) => {
    if (p.index !== index) return p;
    if (action === 'fault' && p.status === 'free') return { ...p, status: 'faulted' as const };
    if ((action === 'restore' && p.status === 'faulted') || (action === 'end' && p.status === 'occupied')) {
      return { ...p, status: 'free' as const, plate: null, occupiedMin: null };
    }
    return p;
  });
  return save(serveLine({ ...op, ports }));
}

export async function removeFromQueue(stationId: string, plate: string): Promise<OpStation> {
  const op = get(stationId);
  return save({ ...op, waiting: op.waiting.filter((w) => w.plate !== plate) });
}

/** Put every station back the way it started. */
export function resetData() {
  store.clear();
}

// ─── Today, hour by hour ──────────────────────────────────────────

export interface HourStat {
  hour: number;
  occupancyPct: number;
  queueDepth: number;
}

const bump = (h: number, centre: number, width: number) => Math.exp(-(((h - centre) / width) ** 2));

/** A commuter-shaped day: a morning peak, a lunchtime dip, a bigger evening peak. */
export async function getDayStats(operator: string): Promise<HourStat[]> {
  let seed = 0;
  for (const ch of operator) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const scale = 0.85 + (seed % 20) / 100;
  return Array.from({ length: 17 }, (_, i) => {
    const hour = 6 + i;
    const noise = (((seed >>> (i % 24)) & 7) - 3.5) / 100;
    const occ = Math.min(1, Math.max(0.05, (0.22 + 0.5 * bump(hour, 9.5, 1.8) + 0.72 * bump(hour, 18.5, 2) + noise) * scale));
    // A line only forms once most ports are taken.
    return { hour, occupancyPct: Math.round(occ * 100), queueDepth: Math.max(0, Math.round((occ - 0.55) * 14)) };
  });
}

// ─── Road links between stations (for Floyd–Warshall) ───────────────────────

/**
 * Which stations have a direct road between them. Not every pair does, so
 * some shortest paths go through other stations, which is the point of
 * running Floyd–Warshall instead of reading off straight-line distances.
 */
const LINKS: [string, string][] = [
  ['st-01', 'st-11'], ['st-01', 'st-12'], ['st-01', 'st-15'],
  ['st-11', 'st-06'], ['st-11', 'st-05'], ['st-11', 'st-07'],
  ['st-06', 'st-05'], ['st-06', 'st-09'], ['st-05', 'st-14'], ['st-05', 'st-02'],
  ['st-14', 'st-04'], ['st-04', 'st-10'], ['st-10', 'st-03'], ['st-03', 'st-04'], ['st-09', 'st-04'],
  ['st-02', 'st-08'], ['st-02', 'st-07'], ['st-08', 'st-13'], ['st-07', 'st-13'],
  ['st-15', 'st-07'], ['st-12', 'st-09'],
];

const byId = (id: string) => STATIONS.find((s) => s.id === id) as Station;

export const ROAD_LINKS: Edge[] = LINKS.map(([a, b]) => ({
  a,
  b,
  km: Math.round(roadKm(byId(a).location, byId(b).location) * 10) / 10,
}));

export async function getDistanceTable(): Promise<AllPairs & { stations: Station[] }> {
  const stations = STATIONS;
  return { ...floydWarshall(stations.map((s) => s.id), ROAD_LINKS), stations };
}
