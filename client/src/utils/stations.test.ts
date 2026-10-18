import { describe, expect, it } from 'vitest';
import { HOME, SAMPLE_STATIONS, listStations, type Station } from '../services/stations';
import {
  availability,
  estimatedWait,
  filterStations,
  formatWait,
  haversineKm,
  makeProjection,
  SESSION_MIN,
  type StationFilters,
} from './stations';

const ANY: StationFilters = { text: '', connector: 'any', maxPrice: Infinity, freeOnly: false, sort: 'nearest' };
const byId = (id: string) => SAMPLE_STATIONS.find((s) => s.id === id) as Station;

describe('sample stations', () => {
  it('derive totalPorts, freePorts and connectorTypes from the port board', () => {
    for (const s of SAMPLE_STATIONS) {
      expect(s.totalPorts).toBe(s.ports.length);
      expect(s.freePorts).toBe(s.ports.filter((p) => p.status === 'free').length);
      expect(new Set(s.connectorTypes)).toEqual(new Set(s.ports.map((p) => p.connectorType)));
      s.ports.forEach((p, i) => expect(p.index).toBe(i));
    }
  });

  it('listStations filters by connector like the API would', async () => {
    const chademo = await listStations({ connectorType: 'CHAdeMO' });
    expect(chademo.length).toBeGreaterThan(0);
    expect(chademo.every((s) => s.connectorTypes.includes('CHAdeMO'))).toBe(true);
  });
});

describe('haversineKm', () => {
  it('is zero to itself and about 111 km per degree of latitude', () => {
    expect(haversineKm(HOME, HOME)).toBe(0);
    expect(haversineKm({ lat: 18, lng: 73 }, { lat: 19, lng: 73 })).toBeCloseTo(111.2, 0);
  });
});

describe('availability and wait', () => {
  it('classifies free, full and all-faulted stations', () => {
    expect(availability(byId('st-01'))).toBe('available');
    expect(availability(byId('st-02'))).toBe('full');
    expect(availability(byId('st-15'))).toBe('offline');
  });

  it('estimates wait from queue length over working ports', () => {
    expect(estimatedWait(byId('st-01'))).toBe(0);
    // st-03: 4 in queue, 3 working ports → you are 5th → 2 rounds
    expect(estimatedWait(byId('st-03'))).toBe(2 * SESSION_MIN);
    expect(estimatedWait(byId('st-15'))).toBe(Infinity);
  });

  it('formats waits for people', () => {
    expect(formatWait(0)).toBe('No wait');
    expect(formatWait(35)).toBe('~35 min');
    expect(formatWait(70)).toBe('~1 h 10 min');
    expect(formatWait(120)).toBe('~2 h');
    expect(formatWait(Infinity)).toBe('Unavailable');
  });
});

describe('filterStations', () => {
  it('sorts nearest first by default', () => {
    const r = filterStations(SAMPLE_STATIONS, ANY, HOME);
    expect(r).toHaveLength(SAMPLE_STATIONS.length);
    for (let i = 1; i < r.length; i += 1) expect(r[i].distanceKm).toBeGreaterThanOrEqual(r[i - 1].distanceKm);
  });

  it('applies connector, price and free-port filters together', () => {
    const r = filterStations(SAMPLE_STATIONS, { ...ANY, connector: 'CCS2', maxPrice: 19, freeOnly: true }, HOME);
    expect(r.length).toBeGreaterThan(0);
    for (const s of r) {
      expect(s.connectorTypes).toContain('CCS2');
      expect(s.pricePerKwh).toBeLessThanOrEqual(19);
      expect(s.freePorts).toBeGreaterThan(0);
    }
  });

  it('matches text against name, locality and operator, case-insensitively', () => {
    expect(filterStations(SAMPLE_STATIONS, { ...ANY, text: 'KOTHRUD' }, HOME).map((s) => s.id)).toEqual(['st-09']);
    expect(filterStations(SAMPLE_STATIONS, { ...ANY, text: 'voltvan' }, HOME).every((s) => s.operator === 'VoltVan')).toBe(true);
  });

  it('sorts by price, rating and wait', () => {
    const cheap = filterStations(SAMPLE_STATIONS, { ...ANY, sort: 'cheapest' }, HOME);
    expect(cheap[0].pricePerKwh).toBe(Math.min(...SAMPLE_STATIONS.map((s) => s.pricePerKwh)));
    const rated = filterStations(SAMPLE_STATIONS, { ...ANY, sort: 'rating' }, HOME);
    expect(rated[0].rating).toBe(Math.max(...SAMPLE_STATIONS.map((s) => s.rating)));
    const queue = filterStations(SAMPLE_STATIONS, { ...ANY, sort: 'queue' }, HOME);
    expect(queue[queue.length - 1].availability).toBe('offline');
  });
});

describe('makeProjection', () => {
  it('fits every point inside the box with north up', () => {
    const pts = SAMPLE_STATIONS.map((s) => s.location);
    const proj = makeProjection(pts);
    for (const p of pts) {
      const { x, y } = proj.project(p);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(proj.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(proj.height);
    }
    const north = proj.project({ lat: 18.6, lng: 73.85 });
    const south = proj.project({ lat: 18.45, lng: 73.85 });
    expect(north.y).toBeLessThan(south.y);
  });
});
