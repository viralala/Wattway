/**
 * WattWay · Team Kothimbir 🌿
 * dashboard.ts — data for the operator dashboard.
 *
 * Live mode (API reachable): stations come from GET /api/stations (filtered by
 * operator), port boards from GET /api/stations/:id and lines from GET
 * /api/queue/:id. Changing a port calls PATCH /api/stations/:id/ports/:index
 * when the caller is a signed-in operator/admin (the page passes remote=true);
 * otherwise the change is local to this session. Removing a driver from a line,
 * day stats and the road table have no endpoint, so they are computed
 * client-side from the live station list.
 *
 * Offline mode: the sample stations drive the same in-memory store.
 */
import { floydWarshall, type AllPairs, type Edge } from '../utils/floyd';
import { initSim } from '../utils/queueSim';
import { roadKm } from '../utils/route';
import { json, request } from './api';
import { fetchLiveQueue, type LiveQueue } from './queue';
import { buildRoadLinks } from '../utils/roadLinks';
import { getStation, loadStations, SAMPLE_STATIONS, type PortStatus, type Station } from './stations';

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
  /** True when this came from the API rather than the sample data. */
  live?: boolean;
}

export const OPERATORS = [...new Set(SAMPLE_STATIONS.map((s) => s.operator))].sort();

// ─── In-memory store (stands in for the database) ──────────────────────────

const store = new Map<string, OpStation>();

/** Same plates and line as the queue page's simulation starts from, so the two pages agree. */
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
    const station = SAMPLE_STATIONS.find((s) => s.id === id);
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

/** Operator names present in the current station list. */
export async function listOperators(): Promise<{ operators: string[]; offline: boolean }> {
  const { stations, offline } = await loadStations();
  return { operators: [...new Set(stations.map((s) => s.operator))].sort(), offline };
}

const minutesSince = (iso: string | null | undefined) =>
  iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)) : 0;

/** Build an operator view of one live station from its detail and queue snapshot. */
export function toOpStation(station: Station, queue: LiveQueue | null): OpStation {
  const ports: OpPort[] = station.ports.map((p) => ({
    index: p.index,
    connectorType: p.connectorType,
    powerKw: p.powerKw,
    status: p.status,
    plate: p.status === 'occupied' ? 'Driver' : null,
    occupiedMin: p.status === 'occupied' ? minutesSince(p.occupiedSince) : null,
  }));
  const waiting: Waiting[] = (queue?.waiting ?? []).map((w) => ({
    plate: `Driver #${w.position}${w.urgent ? ' (priority)' : ''}`,
    waitingMin: minutesSince(w.joinedAt),
  }));
  return {
    live: true,
    station: { ...station, queueLength: queue ? queue.queueLength : station.queueLength },
    ports,
    waiting,
  };
}

async function fetchLiveOp(base: Station): Promise<OpStation> {
  const [detail, queue] = await Promise.all([
    getStation(base.id).then((s) => s ?? base, () => base),
    fetchLiveQueue(base.id).catch(() => null),
  ]);
  const op = toOpStation(detail, queue);
  store.set(base.id, op);
  return op;
}

export async function getOperatorSnapshot(operator: string): Promise<OpStation[]> {
  const { stations, offline } = await loadStations();
  const mine = stations.filter((s) => s.operator === operator);
  if (offline) return mine.map((s) => get(s.id));
  return Promise.all(mine.map(fetchLiveOp));
}

export type PortAction = 'fault' | 'restore' | 'end';

/** fault: free → faulted · restore: faulted → free · end: stop an occupied session. */
export async function setPortStatus(
  stationId: string,
  index: number,
  action: PortAction,
  remote = false,
): Promise<OpStation> {
  if (remote) {
    const status = action === 'fault' ? 'faulted' : 'free';
    await request(`/api/stations/${encodeURIComponent(stationId)}/ports/${index}`, json('PATCH', { status }));
    // A freed port should go to whoever is at the front of the line.
    if (action !== 'fault') await request(`/api/queue/${encodeURIComponent(stationId)}/allocate`, json('POST')).catch(() => undefined);
    const { stations } = await loadStations({ force: true });
    const base = stations.find((s) => s.id === stationId) ?? get(stationId).station;
    return fetchLiveOp(base);
  }
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
export function resetDemo() {
  store.clear();
}

// ─── Today, hour by hour (sample) ──────────────────────────────────────────

export interface HourStat {
  hour: number;
  occupancyPct: number;
  queueDepth: number;
}

const bump = (h: number, centre: number, width: number) => Math.exp(-(((h - centre) / width) ** 2));

/** A commuter-shaped day: a morning peak, a lunchtime dip, a bigger evening peak. */
export async function getDayStats(operator: string, ops?: OpStation[]): Promise<HourStat[]> {
  let seed = 0;
  for (const ch of operator) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  let scale = 0.85 + (seed % 20) / 100;
  if (ops && ops.length > 0) {
    // Anchor the typical-day curve to how busy this operator's stations are right now.
    const ports = ops.flatMap((o) => o.ports).filter((p) => p.status !== 'faulted');
    const now = ports.length ? ports.filter((p) => p.status === 'occupied').length / ports.length : 0;
    const h = new Date().getHours();
    const shape = 0.22 + 0.5 * bump(h, 9.5, 1.8) + 0.72 * bump(h, 18.5, 2);
    if (now > 0) scale = Math.min(1.5, Math.max(0.6, now / shape));
  }
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

const byId = (id: string) => SAMPLE_STATIONS.find((s) => s.id === id) as Station;

export const ROAD_LINKS: Edge[] = LINKS.map(([a, b]) => ({
  a,
  b,
  km: Math.round(roadKm(byId(a).location, byId(b).location) * 10) / 10,
}));

export async function getDistanceTable(): Promise<AllPairs & { stations: Station[]; links: Edge[] }> {
  const { stations, offline } = await loadStations();
  const links = offline ? ROAD_LINKS : buildRoadLinks(stations);
  return { ...floydWarshall(stations.map((s) => s.id), links), stations, links };
}
