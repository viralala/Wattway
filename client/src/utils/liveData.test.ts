import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUnreachable, ApiRequestError, request } from '../services/api';
import { normaliseUser } from '../services/auth';
import { toOpStation } from '../services/dashboard';
import { normaliseQueue } from '../services/queue';
import { clearStationCache, loadStations, mapServerStation, SAMPLE_STATIONS, toPortStatus } from '../services/stations';
import { tokenStore } from '../services/tokenStore';

describe('mapServerStation', () => {
  const listItem = {
    id: 'abc',
    name: 'Andheri Hub',
    operator: 'Tata Power',
    address: { line1: 'x', locality: 'Andheri East', city: 'Mumbai', state: 'MH' },
    location: { lat: 19.11, lng: 72.87 },
    pricePerKwh: 14.5,
    rating: 4.6,
    ratingCount: 10,
    connectorTypes: ['CCS2', 'Type2'],
    totalPorts: 3,
    freePorts: 1,
    queueLength: 2,
    amenities: ['cafe'],
    isActive: true,
  };

  it('maps a list item and rebuilds the port board from the counts', () => {
    const s = mapServerStation(listItem);
    expect(s.location).toEqual({ lat: 19.11, lng: 72.87 });
    expect(s.rating).toBe(4.6);
    expect(s.portsApprox).toBe(true);
    expect(s.ports).toHaveLength(3);
    expect(s.ports.filter((p) => p.status === 'free')).toHaveLength(1);
    expect(s.freePorts).toBe(1);
  });

  it('maps the full document: GeoJSON, { average, count } rating, real ports', () => {
    const s = mapServerStation({
      ...listItem,
      location: { type: 'Point', coordinates: [72.87, 19.11] },
      rating: { average: 4.2, count: 7 },
      ratingCount: undefined,
      ports: [
        { index: 0, connectorType: 'CCS2', powerKw: 60, status: 'occupied', occupiedSince: '2026-01-01T00:00:00Z' },
        { index: 1, connectorType: 'Type2', powerKw: 22, status: 'offline' },
      ],
    });
    expect(s.location).toEqual({ lat: 19.11, lng: 72.87 });
    expect(s.rating).toBe(4.2);
    expect(s.ratingCount).toBe(7);
    expect(s.portsApprox).toBeUndefined();
    expect(s.ports.map((p) => p.status)).toEqual(['occupied', 'faulted']);
    expect(s.freePorts).toBe(0);
  });

  it('survives junk input', () => {
    expect(mapServerStation(null).ports).toEqual([]);
    expect(toPortStatus('free')).toBe('free');
  });
});

describe('queue and auth normalisers', () => {
  it('fills missing queue fields', () => {
    const q = normaliseQueue({ stationId: 's', waiting: [{ position: 1, joinedAt: 'x', estimatedWaitMinutes: 5, urgent: false, you: false }] });
    expect(q.queueLength).toBe(1);
    expect(q.charging).toEqual([]);
    expect(q.you).toBeNull();
  });

  it('defaults unknown roles to driver', () => {
    expect(normaliseUser({ id: '1', name: 'A', email: 'a@b.c', role: 'operator' }).role).toBe('operator');
    expect(normaliseUser({ _id: '2', role: 'wizard' })).toMatchObject({ id: '2', role: 'driver' });
  });

  it('builds an operator view from a live station and queue', () => {
    const st = mapServerStation({ ...SAMPLE_STATIONS[1], id: 'u1' });
    const op = toOpStation(st, normaliseQueue({ queueLength: 2, waiting: [{ position: 1, joinedAt: new Date().toISOString(), estimatedWaitMinutes: 3, urgent: true, you: false }] }));
    expect(op.live).toBe(true);
    expect(op.station.queueLength).toBe(2);
    expect(op.waiting[0].plate).toContain('priority');
  });
});

describe('API fallback and token handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearStationCache();
    tokenStore.clear();
  });

  it('classifies unreachable errors', () => {
    expect(isUnreachable(new ApiRequestError('x', 'NETWORK'))).toBe(true);
    expect(isUnreachable(new ApiRequestError('x', 'X', 503))).toBe(true);
    expect(isUnreachable(new ApiRequestError('x', 'NOT_FOUND', 404))).toBe(false);
  });

  it('falls back to sample stations, flagged offline, when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    const r = await loadStations({ force: true });
    expect(r.offline).toBe(true);
    expect(r.stations).toBe(SAMPLE_STATIONS);
  });

  it('uses live stations when the API answers', async () => {
    const body = { success: true, data: { stations: [{ id: 'z', name: 'Z', totalPorts: 1, freePorts: 1 }] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body }));
    const r = await loadStations({ force: true });
    expect(r.offline).toBe(false);
    expect(r.stations.map((s) => s.id)).toEqual(['z']);
  });

  it('attaches the bearer token and refreshes once on a 401', async () => {
    tokenStore.set({ accessToken: 'old', refreshToken: 'r1' });
    const calls: { url: string; auth?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const auth = (init.headers as Record<string, string>).Authorization;
        calls.push({ url, auth });
        if (url.endsWith('/api/auth/refresh')) {
          return { status: 200, ok: true, json: async () => ({ success: true, data: { accessToken: 'new', refreshToken: 'r2' } }) };
        }
        if (auth === 'Bearer old') {
          return { status: 401, ok: false, json: async () => ({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } }) };
        }
        return { status: 200, ok: true, json: async () => ({ success: true, data: { hello: 1 } }) };
      }),
    );
    await expect(request('/api/auth/me')).resolves.toEqual({ hello: 1 });
    expect(calls.map((c) => c.auth)).toEqual(['Bearer old', undefined, 'Bearer new']);
    expect(tokenStore.get()?.refreshToken).toBe('r2');
  });
});
