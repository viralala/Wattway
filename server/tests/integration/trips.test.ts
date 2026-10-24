/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * trips.test.ts — /api/trips: trip history as a most-recent-first singly
 * linked list stored through `Trip.previousTrip`.
 * ---------------------------------------------------------------------------
 */

import request from 'supertest';
import { app } from '../../src/app';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import { signAccessToken } from '../../src/services/tokenService';
import { clearTestDatabase, startTestDatabase, stopTestDatabase, syncIndexes } from '../helpers/db';
import { makeUserBody } from '../helpers/factories';

let token: string;
let otherToken: string;
let userId: string;

beforeAll(async () => {
  await startTestDatabase();
  await syncIndexes();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  const user = await User.create({ ...makeUserBody({ email: 'trips@wattway.test' }), passwordHash: 'kothimbir123', role: 'driver' });
  const other = await User.create({ ...makeUserBody({ email: 'trips2@wattway.test' }), passwordHash: 'kothimbir123', role: 'driver' });
  userId = user._id.toString();
  token = signAccessToken(user.toAuthUser());
  otherToken = signAccessToken(other.toAuthUser());
});

afterEach(async () => {
  await clearTestDatabase();
});

const tripBody = (label: string, overrides: Record<string, unknown> = {}) => ({
  origin: { lat: 18.52, lng: 73.85 },
  originLabel: `${label} start`,
  destination: { lat: 19.07, lng: 72.87 },
  destinationLabel: `${label} end`,
  batteryStartPct: 80,
  distanceKm: 150,
  ...overrides,
});

async function createTrip(label: string, auth = token) {
  return request(app).post('/api/trips').set('Authorization', `Bearer ${auth}`).send(tripBody(label));
}

describe('/api/trips', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/trips')).status).toBe(401);
    expect((await request(app).post('/api/trips').send(tripBody('x'))).status).toBe(401);
  });

  it('validates the body', async () => {
    const bad = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send(tripBody('x', { batteryStartPct: 120 }));
    expect(bad.status).toBe(422);
    const extra = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send(tripBody('x', { hacker: true }));
    expect(extra.status).toBe(422);
  });

  it('returns an empty history', async () => {
    const response = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ trips: [], total: 0, nextCursor: null, chainIntact: true, middleTripId: null });
  });

  it('inserts at the head: each new trip points at the previous one', async () => {
    const first = await createTrip('one');
    const second = await createTrip('two');
    const third = await createTrip('three');
    expect(first.status).toBe(201);
    expect(first.body.data.trip.previousTrip).toBeNull();
    expect(second.body.data.trip.previousTrip).toBe(first.body.data.trip.id);
    expect(third.body.data.trip.previousTrip).toBe(second.body.data.trip.id);

    const response = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
    expect(response.body.data.trips.map((t: { originLabel: string }) => t.originLabel)).toEqual([
      'three start',
      'two start',
      'one start',
    ]);
    expect(response.body.data.chainIntact).toBe(true);
    expect(response.body.data.middleTripId).toBe(second.body.data.trip.id);
    expect(response.body.data.trips[0].origin).toEqual({ type: 'Point', coordinates: [73.85, 18.52] });
  });

  it('pages through the list with a cursor', async () => {
    for (const label of ['a', 'b', 'c', 'd', 'e']) await createTrip(label);
    const page1 = await request(app).get('/api/trips?limit=2').set('Authorization', `Bearer ${token}`);
    expect(page1.body.data.trips.map((t: { originLabel: string }) => t.originLabel)).toEqual(['e start', 'd start']);
    const page2 = await request(app)
      .get(`/api/trips?limit=2&before=${page1.body.data.nextCursor}`)
      .set('Authorization', `Bearer ${token}`);
    expect(page2.body.data.trips.map((t: { originLabel: string }) => t.originLabel)).toEqual(['c start', 'b start']);
    const page3 = await request(app)
      .get(`/api/trips?limit=2&before=${page2.body.data.nextCursor}`)
      .set('Authorization', `Bearer ${token}`);
    expect(page3.body.data.trips.map((t: { originLabel: string }) => t.originLabel)).toEqual(['a start']);
    expect(page3.body.data.nextCursor).toBeNull();
    expect(page3.body.data.total).toBe(5);

    const bad = await request(app).get('/api/trips?before=aaaaaaaaaaaaaaaaaaaaaaaa').set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(404);
  });

  it('deletes a node by re-pointing its newer neighbour (Lab 3 delete)', async () => {
    const one = (await createTrip('one')).body.data.trip.id as string;
    const two = (await createTrip('two')).body.data.trip.id as string;
    const three = (await createTrip('three')).body.data.trip.id as string;

    const response = await request(app).delete(`/api/trips/${two}`).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);

    const head = await Trip.findById(three).exec();
    expect(head?.previousTrip?.toString()).toBe(one);
    const history = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
    expect(history.body.data.total).toBe(2);
    expect(history.body.data.chainIntact).toBe(true);

    // Deleting the head leaves the next one as the head; a new trip links to it.
    await request(app).delete(`/api/trips/${three}`).set('Authorization', `Bearer ${token}`);
    const four = await createTrip('four');
    expect(four.body.data.trip.previousTrip).toBe(one);
  });

  it('keeps every trip private to its owner', async () => {
    const mine = (await createTrip('mine')).body.data.trip.id as string;
    expect((await request(app).get(`/api/trips/${mine}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).get(`/api/trips/${mine}`).set('Authorization', `Bearer ${otherToken}`)).status).toBe(404);
    expect((await request(app).delete(`/api/trips/${mine}`).set('Authorization', `Bearer ${otherToken}`)).status).toBe(404);
    const theirs = await request(app).get('/api/trips').set('Authorization', `Bearer ${otherToken}`);
    expect(theirs.body.data.total).toBe(0);
    expect((await request(app).get('/api/trips/not-an-id').set('Authorization', `Bearer ${token}`)).status).toBe(422);
  });

  it('still returns every trip, in recency order, when the chain is broken', async () => {
    await createTrip('linked-1');
    await createTrip('linked-2');
    // A row written by some other code path that never set the pointer.
    await Trip.create({
      user: userId,
      origin: { type: 'Point', coordinates: [73.8, 18.5] },
      originLabel: 'orphan start',
      destination: { type: 'Point', coordinates: [73.9, 18.6] },
      batteryStartPct: 50,
      previousTrip: null,
      createdAt: new Date(Date.now() + 60_000),
    });

    const response = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`);
    expect(response.body.data.total).toBe(3);
    expect(response.body.data.chainIntact).toBe(false);
    expect(response.body.data.trips.map((t: { originLabel: string }) => t.originLabel)).toEqual([
      'orphan start',
      'linked-2 start',
      'linked-1 start',
    ]);
  });
});
