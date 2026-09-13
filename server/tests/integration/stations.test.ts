/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * stations.test.ts — station CRUD, the port board, and index coherence.
 *
 * The last group is the important one: every write path has to leave the
 * in-memory BST/Trie agreeing with MongoDB, or search quietly serves stale
 * data. These tests are what stop that regressing.
 * ---------------------------------------------------------------------------
 */

import request from 'supertest';
import { app } from '../../src/app';
import { Station } from '../../src/models/Station';
import { User } from '../../src/models/User';
import { stationIndex } from '../../src/services/stationIndex';
import { signAccessToken } from '../../src/services/tokenService';
import { clearTestDatabase, startTestDatabase, stopTestDatabase, syncIndexes } from '../helpers/db';
import { makeStationBody, makeUserBody } from '../helpers/factories';

let operatorToken: string;
let otherOperatorToken: string;
let driverToken: string;
let adminToken: string;

beforeAll(async () => {
  await startTestDatabase();
  await syncIndexes();
});

afterAll(async () => {
  stationIndex.stop();
  await stopTestDatabase();
});

beforeEach(async () => {
  const operator = await User.create({
    ...makeUserBody({ email: 'op1@wattway.test' }),
    passwordHash: 'kothimbir123',
    role: 'operator',
  });
  const otherOperator = await User.create({
    ...makeUserBody({ email: 'op2@wattway.test' }),
    passwordHash: 'kothimbir123',
    role: 'operator',
  });
  const driver = await User.create({
    ...makeUserBody({ email: 'driver@wattway.test' }),
    passwordHash: 'kothimbir123',
    role: 'driver',
  });
  const admin = await User.create({
    ...makeUserBody({ email: 'admin@wattway.test' }),
    passwordHash: 'kothimbir123',
    role: 'admin',
  });

  operatorToken = signAccessToken(operator.toAuthUser());
  otherOperatorToken = signAccessToken(otherOperator.toAuthUser());
  driverToken = signAccessToken(driver.toAuthUser());
  adminToken = signAccessToken(admin.toAuthUser());

  stationIndex.reset();
});

afterEach(async () => {
  await clearTestDatabase();
  stationIndex.reset();
});

async function createStation(overrides: Record<string, unknown> = {}, token = operatorToken) {
  return request(app)
    .post('/api/stations')
    .set('Authorization', `Bearer ${token}`)
    .send(makeStationBody(overrides));
}

describe('POST /api/stations', () => {
  it('creates a station for an operator', async () => {
    const response = await createStation({ name: 'Andheri Test Hub', pricePerKwh: 13.5 });

    expect(response.status).toBe(201);
    expect(response.body.data.station.name).toBe('Andheri Test Hub');
    expect(response.body.data.station.pricePerKwh).toBe(13.5);
  });

  it('numbers the port board from zero', async () => {
    const response = await createStation();
    const ports = response.body.data.station.ports;
    expect(ports.map((port: { index: number }) => port.index)).toEqual([0, 1]);
    expect(ports.every((port: { status: string }) => port.status === 'free')).toBe(true);
  });

  it('reports derived port counts', async () => {
    const response = await createStation();
    expect(response.body.data.station.totalPorts).toBe(2);
    expect(response.body.data.station.freePorts).toBe(2);
  });

  it('refuses a driver', async () => {
    const response = await createStation({}, driverToken);
    expect(response.status).toBe(403);
  });

  it('refuses an anonymous request', async () => {
    const response = await request(app).post('/api/stations').send(makeStationBody());
    expect(response.status).toBe(401);
  });

  it('rejects an invalid payload', async () => {
    const cases: Array<Record<string, unknown>> = [
      { ports: [] },
      { pricePerKwh: -5 },
      { location: { lat: 200, lng: 0 } },
      { address: { line1: 'x', locality: 'y', city: 'z', state: 'w', pincode: '12' } },
    ];
    for (const overrides of cases) {
      const response = await createStation(overrides);
      expect(response.status).toBe(422);
    }
  });

  it('rejects two stations with the same name in the same city', async () => {
    await createStation({ name: 'Twin Station' });
    const duplicate = await createStation({ name: 'Twin Station' });
    expect(duplicate.status).toBe(409);
    // The conflicting value must not be echoed back.
    expect(duplicate.body.error.message).not.toContain('Twin Station');
  });
});

describe('GET /api/stations', () => {
  beforeEach(async () => {
    await createStation({ name: 'Mumbai One', pricePerKwh: 10 });
    await createStation({
      name: 'Pune One',
      pricePerKwh: 20,
      address: {
        line1: '1 FC Road',
        locality: 'Shivajinagar',
        city: 'Pune',
        state: 'Maharashtra',
      },
      location: { lat: 18.5204, lng: 73.8567 },
    });
  });

  it('lists active stations to an anonymous visitor', async () => {
    const response = await request(app).get('/api/stations');
    expect(response.status).toBe(200);
    expect(response.body.data.stations).toHaveLength(2);
    expect(response.body.meta.pagination.total).toBe(2);
  });

  it('filters by city, case-insensitively', async () => {
    const response = await request(app).get('/api/stations?city=pune');
    expect(response.body.data.stations.map((s: { name: string }) => s.name)).toEqual(['Pune One']);
  });

  it('computes distance and sorts by it when given a position', async () => {
    const response = await request(app).get('/api/stations?lat=19.076&lng=72.8777');
    const stations = response.body.data.stations;
    expect(stations[0].name).toBe('Mumbai One');
    expect(stations[0].distanceKm).toBeLessThan(stations[1].distanceKm);
  });

  it('filters by radius', async () => {
    const response = await request(app).get('/api/stations?lat=19.076&lng=72.8777&radiusKm=50');
    expect(response.body.data.stations.map((s: { name: string }) => s.name)).toEqual(['Mumbai One']);
  });

  it('rejects a half-supplied position', async () => {
    const response = await request(app).get('/api/stations?lat=19.076');
    expect(response.status).toBe(422);
  });

  it('paginates', async () => {
    const response = await request(app).get('/api/stations?limit=1&page=2');
    expect(response.body.data.stations).toHaveLength(1);
    expect(response.body.meta.pagination).toMatchObject({ page: 2, limit: 1, total: 2, pages: 2 });
  });
});

describe('GET /api/stations/:id', () => {
  it('returns one station', async () => {
    const created = await createStation({ name: 'Fetch Me' });
    const response = await request(app).get(`/api/stations/${created.body.data.station.id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.station.name).toBe('Fetch Me');
  });

  it('404s for an unknown id', async () => {
    const response = await request(app).get(`/api/stations/${'a'.repeat(24)}`);
    expect(response.status).toBe(404);
  });

  it('400s for a malformed id rather than crashing', async () => {
    const response = await request(app).get('/api/stations/not-an-id');
    expect(response.status).toBe(422);
  });
});

describe('PATCH /api/stations/:id', () => {
  it('lets the managing operator update it', async () => {
    const created = await createStation({ pricePerKwh: 10 });
    const response = await request(app)
      .patch(`/api/stations/${created.body.data.station.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ pricePerKwh: 15 });

    expect(response.status).toBe(200);
    expect(response.body.data.station.pricePerKwh).toBe(15);
  });

  it('refuses an operator who does not manage it', async () => {
    const created = await createStation();
    const response = await request(app)
      .patch(`/api/stations/${created.body.data.station.id}`)
      .set('Authorization', `Bearer ${otherOperatorToken}`)
      .send({ pricePerKwh: 15 });

    expect(response.status).toBe(403);
  });

  it('lets an admin update any station', async () => {
    const created = await createStation();
    const response = await request(app)
      .patch(`/api/stations/${created.body.data.station.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pricePerKwh: 15 });

    expect(response.status).toBe(200);
  });

  it('rejects an empty update', async () => {
    const created = await createStation();
    const response = await request(app)
      .patch(`/api/stations/${created.body.data.station.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({});
    expect(response.status).toBe(422);
  });
});

describe('DELETE /api/stations/:id', () => {
  it('soft-deletes, keeping the row for history', async () => {
    const created = await createStation();
    const id = created.body.data.station.id;

    const response = await request(app)
      .delete(`/api/stations/${id}`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(response.status).toBe(200);
    expect(await Station.findById(id).exec()).not.toBeNull(); // still there
    expect((await Station.findById(id).exec())!.isActive).toBe(false);
    expect((await request(app).get(`/api/stations/${id}`)).status).toBe(404);
  });
});

describe('PATCH /api/stations/:id/ports/:portIndex — the Array in action', () => {
  it('flips one port and recomputes the free count', async () => {
    const created = await createStation();
    const id = created.body.data.station.id;

    const response = await request(app)
      .patch(`/api/stations/${id}/ports/0`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'occupied' });

    expect(response.status).toBe(200);
    expect(response.body.data.port.index).toBe(0);
    expect(response.body.data.port.status).toBe('occupied');
    expect(response.body.data.freePorts).toBe(1);
    expect(response.body.data.totalPorts).toBe(2);
  });

  it('stamps occupiedSince on occupy and clears it on release', async () => {
    const created = await createStation();
    const id = created.body.data.station.id;

    const occupied = await request(app)
      .patch(`/api/stations/${id}/ports/0`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'occupied' });
    expect(occupied.body.data.port.occupiedSince).not.toBeNull();

    const freed = await request(app)
      .patch(`/api/stations/${id}/ports/0`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'free' });
    expect(freed.body.data.port.occupiedSince).toBeNull();
  });

  it('404s for a port index the station does not have', async () => {
    const created = await createStation();
    const response = await request(app)
      .patch(`/api/stations/${created.body.data.station.id}/ports/9`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'occupied' });

    expect(response.status).toBe(404);
  });

  it('rejects an unknown status', async () => {
    const created = await createStation();
    const response = await request(app)
      .patch(`/api/stations/${created.body.data.station.id}/ports/0`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'on-fire' });

    expect(response.status).toBe(422);
  });
});

describe('POST /api/stations/:id/rating', () => {
  it('updates the running mean', async () => {
    const created = await createStation();
    const id = created.body.data.station.id;

    await request(app)
      .post(`/api/stations/${id}/rating`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ rating: 5 });

    const response = await request(app)
      .post(`/api/stations/${id}/rating`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ rating: 3 });

    expect(response.status).toBe(200);
    expect(response.body.data.rating).toEqual({ average: 4, count: 2 });
  });

  it('rejects an out-of-range rating', async () => {
    const created = await createStation();
    for (const rating of [0, 6, -1]) {
      const response = await request(app)
        .post(`/api/stations/${created.body.data.station.id}/rating`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ rating });
      expect(response.status).toBe(422);
    }
  });

  it('requires sign-in', async () => {
    const created = await createStation();
    const response = await request(app)
      .post(`/api/stations/${created.body.data.station.id}/rating`)
      .send({ rating: 5 });
    expect(response.status).toBe(401);
  });
});

describe('index coherence — every write keeps the BST and Trie in step', () => {
  it('indexes a station the moment it is created', async () => {
    await createStation({ name: 'Freshly Indexed', pricePerKwh: 13 });

    expect(stationIndex.size).toBe(1);
    const found = stationIndex.search({ minPrice: 13, maxPrice: 13 });
    expect(found.stations.map((s) => s.name)).toEqual(['Freshly Indexed']);
    expect(stationIndex.suggest('freshly').suggestions).toHaveLength(1);
  });

  it('moves a station between price buckets when its tariff changes', async () => {
    const created = await createStation({ name: 'Repriced', pricePerKwh: 10 });

    await request(app)
      .patch(`/api/stations/${created.body.data.station.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ pricePerKwh: 25 });

    // The old bucket must be empty — this is the ghost-entry regression.
    expect(stationIndex.search({ minPrice: 10, maxPrice: 10 }).total).toBe(0);
    expect(stationIndex.search({ minPrice: 25, maxPrice: 25 }).total).toBe(1);
    expect(stationIndex.size).toBe(1);
  });

  it('re-indexes the name when a station is renamed', async () => {
    const created = await createStation({ name: 'Old Name Hub' });

    await request(app)
      .patch(`/api/stations/${created.body.data.station.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'New Name Hub' });

    expect(stationIndex.suggest('old name').suggestions).toHaveLength(0);
    expect(stationIndex.suggest('new name').suggestions).toHaveLength(1);
  });

  it('moves a station in the rating index when it is rated', async () => {
    const created = await createStation({ name: 'Rated Station' });
    const id = created.body.data.station.id;

    expect(stationIndex.search({ minRating: 0, maxRating: 0 }).total).toBe(1);

    await request(app)
      .post(`/api/stations/${id}/rating`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ rating: 5 });

    expect(stationIndex.search({ minRating: 0, maxRating: 0 }).total).toBe(0);
    expect(stationIndex.search({ minRating: 5, maxRating: 5 }).total).toBe(1);
  });

  it('drops a deactivated station out of the index', async () => {
    const created = await createStation({ name: 'Doomed Station' });

    await request(app)
      .delete(`/api/stations/${created.body.data.station.id}`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(stationIndex.size).toBe(0);
    expect(stationIndex.suggest('doomed').suggestions).toEqual([]);
  });

  it('reflects a port change in the free-port count the index serves', async () => {
    const created = await createStation({ name: 'Port Change' });
    const id = created.body.data.station.id;

    expect(stationIndex.get(id)?.freePorts).toBe(2);

    await request(app)
      .patch(`/api/stations/${id}/ports/0`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'occupied' });

    expect(stationIndex.get(id)?.freePorts).toBe(1);
  });

  it('rebuilds from the database, picking up out-of-band writes', async () => {
    // Written straight to Mongo, bypassing the controller — exactly what the
    // scheduled rebuild exists to catch.
    await Station.create({
      name: 'Smuggled In',
      operator: 'Direct Insert',
      address: { line1: '1 Road', locality: 'Nowhere', city: 'Mumbai', state: 'Maharashtra' },
      location: { type: 'Point', coordinates: [72.8777, 19.076] },
      pricePerKwh: 7,
      ports: [{ index: 0, connectorType: 'CCS2', powerKw: 60, status: 'free' }],
    });

    expect(stationIndex.size).toBe(0);
    await stationIndex.rebuildFromDatabase();
    expect(stationIndex.size).toBe(1);
    expect(stationIndex.suggest('smuggled').suggestions).toHaveLength(1);
  });
});
