import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDayStats,
  getDistanceTable,
  getOperatorSnapshot,
  OPERATORS,
  removeFromQueue,
  resetDemo,
  ROAD_LINKS,
  setPortStatus,
} from '../services/dashboard';
import { SAMPLE_STATIONS } from '../services/stations';
import { floydWarshall, pathBetween, type Edge } from './floyd';

// A─1─B─1─C, plus a long direct A─C road that the path through B beats.
const IDS = ['A', 'B', 'C', 'D'];
const EDGES: Edge[] = [
  { a: 'A', b: 'B', km: 1 },
  { a: 'B', b: 'C', km: 1 },
  { a: 'A', b: 'C', km: 5 },
];

describe('floydWarshall', () => {
  const ap = floydWarshall(IDS, EDGES);

  it('finds shorter paths through intermediate nodes', () => {
    expect(ap.dist[0][2]).toBe(2);
    expect(pathBetween(ap, 0, 2)).toEqual([0, 1, 2]);
  });

  it('is symmetric for undirected roads, zero on the diagonal', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(ap.dist[i][i]).toBe(0);
      for (let j = 0; j < 3; j += 1) expect(ap.dist[i][j]).toBe(ap.dist[j][i]);
    }
  });

  it('marks unreachable pairs as Infinity with no path', () => {
    expect(ap.dist[0][3]).toBe(Infinity);
    expect(pathBetween(ap, 0, 3)).toEqual([]);
  });

  it('runs exactly V³ relaxations', () => {
    expect(ap.relaxations).toBe(64);
  });

  it('rejects edges to unknown nodes', () => {
    expect(() => floydWarshall(['A'], [{ a: 'A', b: 'Z', km: 1 }])).toThrow(/unknown/);
  });
});

describe('the station distance table', () => {
  it('connects every station and obeys the triangle inequality', async () => {
    const t = await getDistanceTable();
    const n = t.ids.length;
    expect(n).toBe(SAMPLE_STATIONS.length);
    for (let i = 0; i < n; i += 1)
      for (let j = 0; j < n; j += 1) {
        expect(Number.isFinite(t.dist[i][j])).toBe(true);
        for (let k = 0; k < n; k += 1) expect(t.dist[i][j]).toBeLessThanOrEqual(t.dist[i][k] + t.dist[k][j] + 1e-9);
      }
  });

  it('every path it reports adds up to the distance', async () => {
    const t = await getDistanceTable();
    const km = (x: string, y: string) =>
      ROAD_LINKS.find((e) => (e.a === x && e.b === y) || (e.a === y && e.b === x))?.km ?? NaN;
    const p = pathBetween(t, 2, 6); // Hinjewadi → Magarpatta, across town
    const total = p.slice(1).reduce((sum, k, n) => sum + km(t.ids[p[n]], t.ids[k]), 0);
    expect(total).toBeCloseTo(t.dist[2][6], 6);
    expect(p.length).toBeGreaterThan(2);
  });
});

describe('operator snapshot and actions', () => {
  beforeEach(() => resetDemo());

  it('lists each operator’s own stations with consistent counts', async () => {
    for (const op of OPERATORS) {
      const snap = await getOperatorSnapshot(op);
      expect(snap.length).toBeGreaterThan(0);
      for (const s of snap) {
        expect(s.station.operator).toBe(op);
        expect(s.waiting).toHaveLength(s.station.queueLength);
        expect(s.ports.filter((p) => p.status === 'occupied').every((p) => p.plate && p.occupiedMin !== null)).toBe(true);
      }
    }
  });

  it('a freed port goes to the front of the line (FIFO)', async () => {
    const [kp] = (await getOperatorSnapshot('AmpYard')).filter((s) => s.station.id === 'st-02');
    const front = kp.waiting[0].plate;
    const busy = kp.ports.find((p) => p.status === 'occupied')!;
    const after = await setPortStatus('st-02', busy.index, 'end');
    expect(after.ports[busy.index].plate).toBe(front);
    expect(after.waiting.map((w) => w.plate)).toEqual(kp.waiting.slice(1).map((w) => w.plate));
    expect(after.station.queueLength).toBe(kp.waiting.length - 1);
  });

  it('faults only free ports and restores only faulted ones', async () => {
    const free = (await getOperatorSnapshot('GreenPlug')).find((s) => s.station.id === 'st-01')!.ports.find((p) => p.status === 'free')!;
    let op = await setPortStatus('st-01', free.index, 'fault');
    expect(op.ports[free.index].status).toBe('faulted');
    expect(op.station.freePorts).toBe(op.ports.filter((p) => p.status === 'free').length);
    op = await setPortStatus('st-01', free.index, 'end'); // wrong action for a faulted port: no change
    expect(op.ports[free.index].status).toBe('faulted');
    op = await setPortStatus('st-01', free.index, 'restore');
    expect(op.ports[free.index].status).toBe('free');
  });

  it('removes a no-show from the middle of the line', async () => {
    const [w] = (await getOperatorSnapshot('Sahyadri Charge')).filter((s) => s.station.id === 'st-03');
    const victim = w.waiting[1].plate;
    const after = await removeFromQueue('st-03', victim);
    expect(after.waiting.map((x) => x.plate)).toEqual(w.waiting.filter((x) => x.plate !== victim).map((x) => x.plate));
  });
});

describe('getDayStats', () => {
  it('covers 6h–22h with sane values and an evening peak', async () => {
    const s = await getDayStats('AmpYard');
    expect(s.map((h) => h.hour)).toEqual(Array.from({ length: 17 }, (_, i) => 6 + i));
    for (const h of s) {
      expect(h.occupancyPct).toBeGreaterThanOrEqual(0);
      expect(h.occupancyPct).toBeLessThanOrEqual(100);
      expect(h.queueDepth).toBeGreaterThanOrEqual(0);
    }
    const peak = s.reduce((a, b) => (b.occupancyPct > a.occupancyPct ? b : a));
    expect(peak.hour).toBeGreaterThanOrEqual(16);
  });
});
