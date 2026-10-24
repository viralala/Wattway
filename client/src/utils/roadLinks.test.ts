import { describe, expect, it } from 'vitest';
import { SAMPLE_STATIONS } from '../services/stations';
import { floydWarshall } from './floyd';
import { buildRoadLinks } from './roadLinks';

describe('buildRoadLinks', () => {
  it('connects every station to every other', () => {
    const ids = SAMPLE_STATIONS.map((s) => s.id);
    const ap = floydWarshall(ids, buildRoadLinks(SAMPLE_STATIONS));
    for (const row of ap.dist) for (const d of row) expect(Number.isFinite(d)).toBe(true);
  });

  it('bridges far-apart clusters', () => {
    const far = SAMPLE_STATIONS.slice(0, 4).map((s, i) => ({ ...s, id: `far-${i}`, location: { lat: 19 + i * 0.001, lng: 72.8 } }));
    const stations = [...SAMPLE_STATIONS.slice(0, 4), ...far];
    const ap = floydWarshall(stations.map((s) => s.id), buildRoadLinks(stations, 2));
    expect(Number.isFinite(ap.dist[0][7])).toBe(true);
  });

  it('has no duplicate or self links', () => {
    const edges = buildRoadLinks(SAMPLE_STATIONS);
    const keys = edges.map((e) => [e.a, e.b].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
    expect(edges.every((e) => e.a !== e.b)).toBe(true);
  });
});
