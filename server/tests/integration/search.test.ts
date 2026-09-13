/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * search.test.ts — the BST and the Trie over HTTP.
 *
 * PRD Section 10.3: "Search bar with autocomplete (Trie-backed)."
 * PRD Section 10.4: "Filter/sort stations by price or rating within a range
 *                    (BST-backed)."
 * ---------------------------------------------------------------------------
 */

import request from 'supertest';
import { app } from '../../src/app';
import { Station } from '../../src/models/Station';
import { stationIndex } from '../../src/services/stationIndex';
import { clearTestDatabase, startTestDatabase, stopTestDatabase, syncIndexes } from '../helpers/db';
import type { ConnectorType } from '../../src/types';

interface Fixture {
  name: string;
  locality: string;
  city: string;
  price: number;
  rating: number;
  ratingCount: number;
  lat: number;
  lng: number;
  connector: ConnectorType;
  freePorts: number;
}

const FIXTURES: Fixture[] = [
  {
    name: 'Andheri Metro Charge Hub',
    locality: 'Andheri East',
    city: 'Mumbai',
    price: 14.5,
    rating: 4.6,
    ratingCount: 212,
    lat: 19.1136,
    lng: 72.8697,
    connector: 'CCS2',
    freePorts: 2,
  },
  {
    name: 'Andaman Plaza Charge',
    locality: 'Vile Parle',
    city: 'Mumbai',
    price: 9.5,
    rating: 3.4,
    ratingCount: 20,
    lat: 19.0989,
    lng: 72.8517,
    connector: 'Type2',
    freePorts: 1,
  },
  {
    name: 'Bandra Kurla Fast Charge',
    locality: 'Bandra Kurla Complex',
    city: 'Mumbai',
    price: 18.0,
    rating: 4.8,
    ratingCount: 340,
    lat: 19.0662,
    lng: 72.8692,
    connector: 'CCS2',
    freePorts: 0,
  },
  {
    name: 'Hinjewadi Charge Park',
    locality: 'Hinjewadi',
    city: 'Pune',
    price: 9.5,
    rating: 4.3,
    ratingCount: 176,
    lat: 18.5913,
    lng: 73.7389,
    connector: 'CHAdeMO',
    freePorts: 3,
  },
  {
    name: 'Shivajinagar Depot Charge',
    locality: 'Shivajinagar',
    city: 'Pune',
    price: 8.25,
    rating: 3.2,
    ratingCount: 61,
    lat: 18.5308,
    lng: 73.8475,
    connector: 'Bharat-DC-001',
    freePorts: 2,
  },
];

const MUMBAI = { lat: 19.076, lng: 72.8777 };

beforeAll(async () => {
  await startTestDatabase();
  await syncIndexes();

  await Station.insertMany(
    FIXTURES.map((fixture) => ({
      name: fixture.name,
      operator: 'Tata Power',
      address: {
        line1: '1 Test Road',
        locality: fixture.locality,
        city: fixture.city,
        state: fixture.city === 'Pune' ? 'Maharashtra' : 'Maharashtra',
      },
      location: { type: 'Point', coordinates: [fixture.lng, fixture.lat] },
      pricePerKwh: fixture.price,
      rating: { average: fixture.rating, count: fixture.ratingCount },
      ports: Array.from({ length: 4 }, (_, index) => ({
        index,
        connectorType: fixture.connector,
        powerKw: 60,
        status: index < fixture.freePorts ? 'free' : 'occupied',
        occupiedSince: null,
      })),
      amenities: [],
      isActive: true,
    })),
  );

  await stationIndex.rebuildFromDatabase();
});

afterAll(async () => {
  stationIndex.stop();
  stationIndex.reset();
  await clearTestDatabase();
  await stopTestDatabase();
});

const names = (body: { data: { stations: Array<{ name: string }> } }): string[] =>
  body.data.stations.map((station) => station.name);

describe('GET /api/search/autocomplete — Trie', () => {
  it('returns suggestions for a prefix', async () => {
    const response = await request(app).get('/api/search/autocomplete?q=andh');

    expect(response.status).toBe(200);
    expect(response.body.meta.dataStructure).toBe('Trie');
    expect(response.body.data.suggestions.map((s: { name: string }) => s.name)).toContain(
      'Andheri Metro Charge Hub',
    );
  });

  it('narrows as more characters arrive', async () => {
    const two = await request(app).get('/api/search/autocomplete?q=an');
    const five = await request(app).get('/api/search/autocomplete?q=andhe');

    expect(five.body.data.suggestions.length).toBeLessThanOrEqual(
      two.body.data.suggestions.length,
    );
    expect(five.body.data.suggestions).toHaveLength(1);
  });

  it('matches a locality, not just a station name', async () => {
    const response = await request(app).get('/api/search/autocomplete?q=hinjew');
    expect(response.body.data.suggestions[0].name).toBe('Hinjewadi Charge Park');
  });

  it('matches a city', async () => {
    const response = await request(app).get('/api/search/autocomplete?q=pune');
    const ids = response.body.data.suggestions.map((s: { city: string }) => s.city);
    expect(ids.every((city: string) => city === 'Pune')).toBe(true);
    expect(response.body.data.suggestions.length).toBe(2);
  });

  it('is case- and punctuation-insensitive', async () => {
    const plain = await request(app).get('/api/search/autocomplete?q=andheri');
    const messy = await request(app).get('/api/search/autocomplete?q=%20%20ANDHERI!!');
    expect(messy.body.data.suggestions).toEqual(plain.body.data.suggestions);
  });

  it('returns an empty list rather than an error for no match', async () => {
    const response = await request(app).get('/api/search/autocomplete?q=zzzzz');
    expect(response.status).toBe(200);
    expect(response.body.data.suggestions).toEqual([]);
  });

  it('honours the limit', async () => {
    const response = await request(app).get('/api/search/autocomplete?q=a&limit=1');
    expect(response.body.data.suggestions.length).toBeLessThanOrEqual(1);
  });

  it('requires q', async () => {
    const response = await request(app).get('/api/search/autocomplete');
    expect(response.status).toBe(422);
  });

  it('prefers a nearby station when a position is supplied', async () => {
    const response = await request(app).get(
      `/api/search/autocomplete?q=charge&lat=${MUMBAI.lat}&lng=${MUMBAI.lng}`,
    );
    // Mumbai stations should lead over the Pune ones.
    expect(response.body.data.suggestions[0].city).toBe('Mumbai');
  });

  it('rejects a half-supplied position', async () => {
    const response = await request(app).get('/api/search/autocomplete?q=andh&lat=19');
    expect(response.status).toBe(422);
  });

  it('reports how it answered when asked to explain', async () => {
    const response = await request(app).get('/api/search/autocomplete?q=andh&explain=true');
    expect(response.body.meta.explain).toMatchObject({
      normalisedQuery: 'andh',
      returned: expect.any(Number),
    });
  });

  it('omits the explain block by default', async () => {
    const response = await request(app).get('/api/search/autocomplete?q=andh');
    expect(response.body.meta.explain).toBeUndefined();
  });
});

describe('GET /api/search/range — BST', () => {
  it('returns stations inside a price band, cheapest first', async () => {
    const response = await request(app).get('/api/search/range?minPrice=9&maxPrice=15');

    expect(response.status).toBe(200);
    expect(response.body.meta.dataStructure).toBe('BST');
    expect(names(response.body)).toEqual([
      'Andaman Plaza Charge',
      'Hinjewadi Charge Park',
      'Andheri Metro Charge Hub',
    ]);
  });

  it('filters by rating', async () => {
    const response = await request(app).get('/api/search/range?minRating=4.5&sort=rating_desc');
    expect(names(response.body)).toEqual([
      'Bandra Kurla Fast Charge',
      'Andheri Metro Charge Hub',
    ]);
  });

  it('combines price and rating bounds', async () => {
    const response = await request(app).get(
      '/api/search/range?minPrice=9&maxPrice=15&minRating=4',
    );
    expect(names(response.body)).toEqual(['Hinjewadi Charge Park', 'Andheri Metro Charge Hub']);
  });

  it('filters by city', async () => {
    const response = await request(app).get('/api/search/range?city=Pune');
    expect(names(response.body).sort()).toEqual([
      'Hinjewadi Charge Park',
      'Shivajinagar Depot Charge',
    ]);
  });

  it('filters by connector type', async () => {
    const response = await request(app).get('/api/search/range?connectorType=CHAdeMO');
    expect(names(response.body)).toEqual(['Hinjewadi Charge Park']);
  });

  it('filters out full stations when asked', async () => {
    const response = await request(app).get('/api/search/range?onlyWithFreePorts=true');
    expect(names(response.body)).not.toContain('Bandra Kurla Fast Charge');
  });

  it('treats onlyWithFreePorts=false as false, not as truthy', async () => {
    const response = await request(app).get('/api/search/range?onlyWithFreePorts=false');
    expect(names(response.body)).toContain('Bandra Kurla Fast Charge');
  });

  it('sorts by distance and reports it', async () => {
    const response = await request(app).get(
      `/api/search/range?lat=${MUMBAI.lat}&lng=${MUMBAI.lng}&sort=distance_asc`,
    );
    const distances = response.body.data.stations.map((s: { distanceKm: number }) => s.distanceKm);
    expect([...distances].sort((a: number, b: number) => a - b)).toEqual(distances);
  });

  it('filters by radius', async () => {
    const response = await request(app).get(
      `/api/search/range?lat=${MUMBAI.lat}&lng=${MUMBAI.lng}&radiusKm=40`,
    );
    expect(names(response.body)).not.toContain('Hinjewadi Charge Park'); // Pune
  });

  it('rejects distance sorting without a position', async () => {
    const response = await request(app).get('/api/search/range?sort=distance_asc');
    expect(response.status).toBe(400);
  });

  it('rejects an inverted price band with a message naming the problem', async () => {
    const response = await request(app).get('/api/search/range?minPrice=20&maxPrice=10');
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body.error.details)).toMatch(/minPrice/);
  });

  it('rejects a non-numeric bound', async () => {
    const response = await request(app).get('/api/search/range?minPrice=cheap');
    expect(response.status).toBe(422);
  });

  it('paginates while reporting the full total', async () => {
    const response = await request(app).get('/api/search/range?limit=2&page=1');
    expect(response.body.data.stations).toHaveLength(2);
    expect(response.body.meta.pagination).toMatchObject({ page: 1, limit: 2, total: 5, pages: 3 });
  });

  it('explains which index drove the scan', async () => {
    const response = await request(app).get(
      '/api/search/range?minPrice=0&maxPrice=100&minRating=4.8&maxRating=5&explain=true',
    );
    expect(response.body.meta.explain.drivingIndex).toBe('rating');
    expect(response.body.meta.explain.reason).toMatch(/selective/i);
  });

  it('returns an empty list, not an error, when nothing matches', async () => {
    const response = await request(app).get('/api/search/range?minPrice=400&maxPrice=500');
    expect(response.status).toBe(200);
    expect(response.body.data.stations).toEqual([]);
    expect(response.body.meta.pagination.total).toBe(0);
  });
});

describe('GET /api/search/nearest-price — BST nearest key', () => {
  it('finds the closest available price to a budget', async () => {
    const response = await request(app).get('/api/search/nearest-price?price=13');
    expect(response.status).toBe(200);
    expect(response.body.data.nearestPrice).toBe(14.5);
    expect(response.body.data.difference).toBe(1.5);
  });

  it('returns every station sharing that price', async () => {
    const response = await request(app).get('/api/search/nearest-price?price=9.4');
    expect(response.body.data.nearestPrice).toBe(9.5);
    expect(response.body.data.stations).toHaveLength(2); // two stations at 9.5
  });

  it('clamps to the cheapest and dearest ends', async () => {
    expect((await request(app).get('/api/search/nearest-price?price=0')).body.data.nearestPrice).toBe(
      8.25,
    );
    expect(
      (await request(app).get('/api/search/nearest-price?price=500')).body.data.nearestPrice,
    ).toBe(18);
  });

  it('requires a price', async () => {
    expect((await request(app).get('/api/search/nearest-price')).status).toBe(422);
  });
});

describe('GET /api/search/price-bounds — BST min/max', () => {
  it('reports the ends of both indexes', async () => {
    const response = await request(app).get('/api/search/price-bounds');
    expect(response.status).toBe(200);
    expect(response.body.data.price).toMatchObject({ min: 8.25, max: 18 });
    expect(response.body.data.rating).toMatchObject({ min: 3.2, max: 4.8 });
    expect(response.body.data.stations).toBe(5);
    // Two stations share 9.5, so distinct prices < station count.
    expect(response.body.data.price.distinctValues).toBe(4);
  });
});

describe('GET /api/index/stats', () => {
  it('exposes the shape of both structures', async () => {
    const response = await request(app).get('/api/index/stats');

    expect(response.status).toBe(200);
    expect(response.body.data.ready).toBe(true);
    expect(response.body.data.stations).toBe(5);
    expect(response.body.data.priceIndex).toMatchObject({
      keys: 4,
      values: 5,
      balanced: true,
    });
    expect(response.body.data.nameIndex.terms).toBeGreaterThan(0);
    expect(response.body.data.interpretation.priceIndex).toMatch(/Binary search tree/);
  });

  it('reports a height at or above the theoretical minimum', async () => {
    const { body } = await request(app).get('/api/index/stats');
    expect(body.data.priceIndex.height).toBeGreaterThanOrEqual(body.data.priceIndex.idealHeight);
  });
});

describe('index availability', () => {
  it('returns 503 rather than an empty result when the index is not built', async () => {
    stationIndex.reset();

    const response = await request(app).get('/api/search/autocomplete?q=andh');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('INDEX_UNAVAILABLE');

    await stationIndex.rebuildFromDatabase(); // restore for any later test
  });
});
