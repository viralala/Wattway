/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * queue.test.ts — /api/queue against a real in-memory MongoDB.
 *
 * Covers join / leave / position, slot allocation, urgent insertion, the
 * operator tools (report, allocate, merge), the scheduler and Josephus demos,
 * rehydration after a restart, realtime fan-out, and — the important group —
 * index coherence: every queue write must leave `stationIndex` agreeing with
 * MongoDB, because queueLength and free ports feed the search ranking.
 * ---------------------------------------------------------------------------
 */

import request from 'supertest';
import { app } from '../../src/app';
import { Station, type StationDocument } from '../../src/models/Station';
import { QueueEntry } from '../../src/models/QueueEntry';
import { User } from '../../src/models/User';
import { stationIndex } from '../../src/services/stationIndex';
import { queueService } from '../../src/services/queueService';
import { signAccessToken } from '../../src/services/tokenService';
import * as sockets from '../../src/sockets';
import { registerQueueHandlers } from '../../src/sockets/queueHandlers';
import { clearTestDatabase, startTestDatabase, stopTestDatabase, syncIndexes } from '../helpers/db';
import { makePorts, makeUserBody } from '../helpers/factories';

let operatorToken: string;
let otherOperatorToken: string;
let adminToken: string;
let operatorId: string;
let otherOperatorId: string;
const drivers: { id: string; token: string }[] = [];

beforeAll(async () => {
  await startTestDatabase();
  await syncIndexes();
});

afterAll(async () => {
  stationIndex.stop();
  await stopTestDatabase();
});

beforeEach(async () => {
  const operator = await User.create({ ...makeUserBody({ email: 'qop1@wattway.test' }), passwordHash: 'kothimbir123', role: 'operator' });
  const otherOperator = await User.create({ ...makeUserBody({ email: 'qop2@wattway.test' }), passwordHash: 'kothimbir123', role: 'operator' });
  const admin = await User.create({ ...makeUserBody({ email: 'qadmin@wattway.test' }), passwordHash: 'kothimbir123', role: 'admin' });
  operatorId = operator._id.toString();
  otherOperatorId = otherOperator._id.toString();
  operatorToken = signAccessToken(operator.toAuthUser());
  otherOperatorToken = signAccessToken(otherOperator.toAuthUser());
  adminToken = signAccessToken(admin.toAuthUser());

  drivers.length = 0;
  for (let i = 0; i < 6; i += 1) {
    const user = await User.create({
      ...makeUserBody({ email: `qdriver${i}@wattway.test`, name: `Driver ${i}` }),
      passwordHash: 'kothimbir123',
      role: 'driver',
    });
    drivers.push({ id: user._id.toString(), token: signAccessToken(user.toAuthUser()) });
  }

  stationIndex.reset();
  queueService.reset();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await clearTestDatabase();
  stationIndex.reset();
  queueService.reset();
});

let stationSeq = 0;
async function makeStation(
  options: { ports?: number; free?: number; managedBy?: string; lat?: number; lng?: number; name?: string } = {},
): Promise<StationDocument> {
  stationSeq += 1;
  const ports = options.ports ?? 1;
  const station = await Station.create({
    name: options.name ?? `Queue Test Station ${stationSeq}`,
    operator: 'Tata Power',
    address: { line1: '1 Test Road', locality: 'Kothrud', city: 'Pune', state: 'Maharashtra', pincode: '411038' },
    location: { type: 'Point', coordinates: [options.lng ?? 73.8, options.lat ?? 18.5] },
    pricePerKwh: 14,
    ports: makePorts(ports, options.free ?? ports),
    managedBy: options.managedBy ?? operatorId,
  });
  stationIndex.upsert(station.toIndexed());
  return station;
}

const join = (stationId: string, driver: number, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/queue/${stationId}/join`).set('Authorization', `Bearer ${drivers[driver].token}`).send(body);

const leave = (stationId: string, driver: number) =>
  request(app).delete(`/api/queue/${stationId}/leave`).set('Authorization', `Bearer ${drivers[driver].token}`);

async function expectCoherent(stationId: string, expected: { queueLength: number; freePorts: number }): Promise<void> {
  const fromDb = (await Station.findById(stationId).exec()) as StationDocument;
  const fromIndex = stationIndex.get(stationId);
  expect(fromDb.queueLength).toBe(expected.queueLength);
  expect(fromDb.freePorts).toBe(expected.freePorts);
  expect(fromIndex?.queueLength).toBe(expected.queueLength);
  expect(fromIndex?.freePorts).toBe(expected.freePorts);
  const waitingRows = await QueueEntry.countDocuments({ station: stationId, status: 'waiting' }).exec();
  expect(waitingRows).toBe(expected.queueLength);
}

// ─── Reading ────────────────────────────────────────────────────────────────

describe('GET /api/queue/:stationId', () => {
  it('is public and shows an empty line', async () => {
    const station = await makeStation({ ports: 2 });
    const response = await request(app).get(`/api/queue/${station.id}`);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.queue).toMatchObject({
      stationId: station.id,
      totalPorts: 2,
      freePorts: 2,
      usablePorts: 2,
      queueLength: 0,
      waiting: [],
      charging: [],
      middle: null,
      you: null,
    });
    expect(response.body.meta.team).toContain('Kothimbir');
  });

  it('validates the id and 404s an unknown or inactive station', async () => {
    expect((await request(app).get('/api/queue/not-an-id')).status).toBe(422);
    expect((await request(app).get('/api/queue/aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(404);
    const station = await makeStation();
    await Station.updateOne({ _id: station._id }, { isActive: false }).exec();
    expect((await request(app).get(`/api/queue/${station.id}`)).status).toBe(404);
  });
});

// ─── Join ───────────────────────────────────────────────────────────────────

describe('POST /api/queue/:stationId/join', () => {
  it('requires a signed-in user', async () => {
    const station = await makeStation();
    const response = await request(app).post(`/api/queue/${station.id}/join`).send({});
    expect(response.status).toBe(401);
  });

  it('rejects an invalid body', async () => {
    const station = await makeStation();
    expect((await join(station.id, 0, { batteryPct: 150 })).status).toBe(422);
    expect((await join(station.id, 0, { expectedChargeMinutes: 1 })).status).toBe(422);
    expect((await join(station.id, 0, { surprise: true })).status).toBe(422);
  });

  it('hands a free port straight to the first driver, then queues the next', async () => {
    const station = await makeStation({ ports: 1 });

    const first = await join(station.id, 0, { expectedChargeMinutes: 40 });
    expect(first.status).toBe(201);
    expect(first.body.data.startedCharging).toBe(true);
    expect(first.body.data.you).toMatchObject({ status: 'charging', portIndex: 0 });

    const second = await join(station.id, 1);
    expect(second.status).toBe(201);
    expect(second.body.data.startedCharging).toBe(false);
    expect(second.body.data.you).toMatchObject({ status: 'waiting', position: 1, carsAhead: 0 });
    expect(second.body.data.you.estimatedWaitMinutes).toBeGreaterThanOrEqual(39);
    expect(second.body.data.queue.waiting[0].you).toBe(true);

    const entries = await QueueEntry.find({ station: station._id }).sort({ joinedAt: 1 }).exec();
    expect(entries.map((e) => [e.status, e.position, e.portIndex])).toEqual([
      ['charging', 0, 0],
      ['waiting', 1, null],
    ]);
    const stored = (await Station.findById(station.id).exec()) as StationDocument;
    expect(stored.ports[0].status).toBe('occupied');
  });

  it('refuses a second live place at the same station', async () => {
    const station = await makeStation({ ports: 1 });
    await join(station.id, 0);
    const again = await join(station.id, 0);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('puts urgent drivers ahead of ordinary ones, in their own arrival order', async () => {
    const station = await makeStation({ ports: 1, free: 0 }); // port busy outside the queue
    await join(station.id, 0);
    await join(station.id, 1);
    await join(station.id, 2, { emergency: true });
    await join(station.id, 3, { batteryPct: 3 });
    await join(station.id, 4);

    const response = await request(app)
      .get(`/api/queue/${station.id}`)
      .set('Authorization', `Bearer ${drivers[3].token}`);
    expect(response.body.data.queue.waiting.map((w: { urgent: boolean }) => w.urgent)).toEqual([true, true, false, false, false]);
    expect(response.body.data.queue.you).toMatchObject({ status: 'waiting', position: 2, urgent: true });

    const positions = await QueueEntry.find({ station: station._id, status: 'waiting' }).sort({ position: 1 }).exec();
    expect(positions.map((e) => e.user.toString())).toEqual([2, 3, 0, 1, 4].map((i) => drivers[i].id));
  });

  it('closes the queue when every port is faulted', async () => {
    const station = await makeStation({ ports: 2 });
    station.setPortStatus(0, 'faulted');
    station.setPortStatus(1, 'faulted');
    await station.save();
    const response = await join(station.id, 0);
    expect(response.status).toBe(409);
  });

  it('serialises concurrent joins: unique positions, consistent length', async () => {
    const station = await makeStation({ ports: 1 });
    const responses = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => join(station.id, i)));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const waiting = await QueueEntry.find({ station: station._id, status: 'waiting' }).exec();
    expect(waiting.map((e) => e.position).sort()).toEqual([1, 2, 3, 4, 5]);
    await expectCoherent(station.id, { queueLength: 5, freePorts: 0 });
  });
});

// ─── Position & leave ───────────────────────────────────────────────────────

describe('GET /position and DELETE /leave', () => {
  it('reports your own position and 404s when you are not in line', async () => {
    const station = await makeStation({ ports: 1 });
    await join(station.id, 0);
    await join(station.id, 1);
    const mine = await request(app).get(`/api/queue/${station.id}/position`).set('Authorization', `Bearer ${drivers[1].token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.you).toMatchObject({ status: 'waiting', position: 1 });

    const stranger = await request(app).get(`/api/queue/${station.id}/position`).set('Authorization', `Bearer ${drivers[5].token}`);
    expect(stranger.status).toBe(404);
    expect((await request(app).get(`/api/queue/${station.id}/position`)).status).toBe(401);
  });

  it('removes a driver from the middle and renumbers everyone behind them', async () => {
    const station = await makeStation({ ports: 1, free: 0 });
    for (const i of [0, 1, 2, 3]) await join(station.id, i);

    const response = await leave(station.id, 1);
    expect(response.status).toBe(200);
    expect(response.body.data.left).toBe('waiting');

    const rows = await QueueEntry.find({ station: station._id }).exec();
    const byUser = new Map(rows.map((r) => [r.user.toString(), r]));
    expect(byUser.get(drivers[1].id)?.status).toBe('cancelled');
    expect(byUser.get(drivers[1].id)?.finishedAt).toBeInstanceOf(Date);
    expect([0, 2, 3].map((i) => byUser.get(drivers[i].id)?.position)).toEqual([1, 2, 3]);
    expect(response.body.data.queue.middle).toEqual({ position: 2, estimatedWaitMinutes: expect.any(Number) });
  });

  it('finishing a charge frees the port and the head of the line takes it', async () => {
    const station = await makeStation({ ports: 1 });
    await join(station.id, 0);
    await join(station.id, 1);
    await join(station.id, 2);

    const response = await leave(station.id, 0);
    expect(response.body.data.left).toBe('charging');
    expect(response.body.data.queue.charging).toHaveLength(1);
    expect(response.body.data.queue.queueLength).toBe(1);

    const rows = await QueueEntry.find({ station: station._id }).exec();
    const byUser = new Map(rows.map((r) => [r.user.toString(), r]));
    expect(byUser.get(drivers[0].id)?.status).toBe('completed');
    expect(byUser.get(drivers[1].id)?.status).toBe('charging');
    expect(byUser.get(drivers[1].id)?.portIndex).toBe(0);
    expect(byUser.get(drivers[2].id)?.position).toBe(1);
  });

  it('404s a leave from someone not in line, and lets a driver re-join after leaving', async () => {
    const station = await makeStation({ ports: 1, free: 0 });
    expect((await leave(station.id, 0)).status).toBe(404);
    await join(station.id, 0);
    await leave(station.id, 0);
    expect((await join(station.id, 0)).status).toBe(201); // partial unique index exempts history rows
  });
});

// ─── Index coherence ────────────────────────────────────────────────────────

describe('index coherence — every queue write keeps stationIndex in step', () => {
  it('updates queueLength and freePorts in the index on join, leave and completion', async () => {
    const station = await makeStation({ ports: 2 });
    await expectCoherent(station.id, { queueLength: 0, freePorts: 2 });

    await join(station.id, 0);
    await expectCoherent(station.id, { queueLength: 0, freePorts: 1 });
    await join(station.id, 1);
    await join(station.id, 2);
    await join(station.id, 3);
    await expectCoherent(station.id, { queueLength: 2, freePorts: 0 });

    await leave(station.id, 3);
    await expectCoherent(station.id, { queueLength: 1, freePorts: 0 });
    await leave(station.id, 0);
    await expectCoherent(station.id, { queueLength: 0, freePorts: 0 });
    await leave(station.id, 1);
    await leave(station.id, 2);
    await expectCoherent(station.id, { queueLength: 0, freePorts: 2 });
  });

  it('a long queue lowers the station in search ranking straight away', async () => {
    const quiet = await makeStation({ ports: 1, free: 0, name: 'Kothimbir Quiet Hub' });
    const busy = await makeStation({ ports: 1, free: 0, name: 'Kothimbir Busy Hub' });
    for (const i of [0, 1, 2, 3, 4]) await join(busy.id, i);
    const ranked = stationIndex.suggest('kothimbir').suggestions.map((s) => s.id);
    expect(ranked.indexOf(quiet.id)).toBeLessThan(ranked.indexOf(busy.id));
  });
});

// ─── Restart ────────────────────────────────────────────────────────────────

describe('rehydration', () => {
  it('rebuilds the line from MongoDB in the stored order after a restart', async () => {
    const station = await makeStation({ ports: 1 });
    for (const i of [0, 1, 2, 3]) await join(station.id, i);
    await leave(station.id, 2);

    queueService.reset(); // simulate a process restart

    const after = await request(app).get(`/api/queue/${station.id}`).set('Authorization', `Bearer ${drivers[3].token}`);
    expect(after.body.data.queue.queueLength).toBe(2);
    expect(after.body.data.queue.charging).toHaveLength(1);
    expect(after.body.data.queue.you).toMatchObject({ status: 'waiting', position: 2 });

    // And it keeps working: the charging driver finishes, position 1 moves up.
    const done = await leave(station.id, 0);
    expect(done.body.data.left).toBe('charging');
    const mine = await request(app).get(`/api/queue/${station.id}/position`).set('Authorization', `Bearer ${drivers[3].token}`);
    expect(mine.body.data.you.position).toBe(1);
  });
});

// ─── Operator tools ─────────────────────────────────────────────────────────

describe('operator tools', () => {
  it('GET /report: managing operator and admin only', async () => {
    const station = await makeStation({ ports: 1, free: 0 });
    await join(station.id, 0, { batteryPct: 80 });
    await join(station.id, 1, { emergency: true });
    await join(station.id, 2, { batteryPct: 40 });

    const asOperator = await request(app).get(`/api/queue/${station.id}/report?top=2`).set('Authorization', `Bearer ${operatorToken}`);
    expect(asOperator.status).toBe(200);
    const report = asOperator.body.data.report;
    expect(report.waiting).toBe(3);
    expect(report.sortedByWait).toHaveLength(3);
    expect(report.urgentQueue).toHaveLength(2);
    expect(report.depq.mostUrgent.userId).toBe(drivers[1].id);
    expect(report.depq.leastUrgent.userId).toBe(drivers[0].id);
    expect(report.integrity).toEqual({ linkedListConsistent: true, noCycle: true, indexMatchesList: true });
    expect(report.middle.position).toBe(2);

    expect((await request(app).get(`/api/queue/${station.id}/report`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get(`/api/queue/${station.id}/report`).set('Authorization', `Bearer ${otherOperatorToken}`)).status).toBe(403);
    expect((await request(app).get(`/api/queue/${station.id}/report`).set('Authorization', `Bearer ${drivers[0].token}`)).status).toBe(403);
    expect((await request(app).get(`/api/queue/${station.id}/report?top=0`).set('Authorization', `Bearer ${operatorToken}`)).status).toBe(422);
  });

  it('POST /allocate gives a port freed by hand to the head of the line', async () => {
    const station = await makeStation({ ports: 1, free: 0 });
    await join(station.id, 0);
    await join(station.id, 1);

    // The operator frees the port through the station module's port board…
    const flip = await request(app)
      .patch(`/api/stations/${station.id}/ports/0`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'free' });
    expect(flip.status).toBe(200);

    // …and asks the queue to allocate it.
    const response = await request(app).post(`/api/queue/${station.id}/allocate`).set('Authorization', `Bearer ${operatorToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.started).toBe(1);
    expect(response.body.data.queue.queueLength).toBe(1);
    await expectCoherent(station.id, { queueLength: 1, freePorts: 0 });

    expect((await request(app).post(`/api/queue/${station.id}/allocate`).set('Authorization', `Bearer ${drivers[0].token}`)).status).toBe(403);
  });

  it('POST /merge moves a faulted station’s line into the target with seniority kept', async () => {
    const source = await makeStation({ ports: 1, free: 0, lat: 18.5, lng: 73.8 });
    const target = await makeStation({ ports: 1, free: 0, lat: 18.51, lng: 73.81 });

    await join(target.id, 0); // oldest at target
    await join(source.id, 1);
    await join(target.id, 2);
    await join(source.id, 3, { emergency: true });
    await join(source.id, 0); // also waiting at target — a duplicate, gets cancelled at source

    const response = await request(app)
      .post(`/api/queue/${source.id}/merge`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ targetStationId: target.id, faultPorts: true });
    expect(response.status).toBe(200);
    expect(response.body.data.moved).toBe(2);
    expect(response.body.data.skippedDuplicates).toBe(1);
    expect(response.body.data.targetDistanceKm).toBeGreaterThan(0);
    expect(response.body.data.leftistHeap.incomingSize).toBe(2);

    const order = await QueueEntry.find({ station: target._id, status: 'waiting' }).sort({ position: 1 }).exec();
    expect(order.map((e) => e.user.toString())).toEqual([3, 0, 1, 2].map((i) => drivers[i].id));
    expect(order.map((e) => e.position)).toEqual([1, 2, 3, 4]);

    const duplicate = await QueueEntry.findOne({ station: source._id, user: drivers[0].id }).exec();
    expect(duplicate?.status).toBe('cancelled');

    await expectCoherent(source.id, { queueLength: 0, freePorts: 0 });
    await expectCoherent(target.id, { queueLength: 4, freePorts: 0 });
  });

  it('POST /merge picks the nearest active station when no target is given', async () => {
    const source = await makeStation({ ports: 1, free: 0, lat: 18.5, lng: 73.8 });
    const near = await makeStation({ ports: 2, lat: 18.502, lng: 73.802 });
    await makeStation({ ports: 2, lat: 19.0, lng: 72.8 }); // far away
    await join(source.id, 0);

    const response = await request(app).post(`/api/queue/${source.id}/merge`).set('Authorization', `Bearer ${operatorToken}`).send({});
    expect(response.status).toBe(200);
    expect(response.body.data.target.stationId).toBe(near.id);
    expect(response.body.data.target.charging).toHaveLength(1); // a free port there was handed out
    await expectCoherent(near.id, { queueLength: 0, freePorts: 1 });
  });

  it('POST /merge refuses a target the operator does not manage, and a self-merge', async () => {
    const source = await makeStation({ ports: 1 });
    const foreign = await makeStation({ ports: 1, managedBy: otherOperatorId });
    const forbidden = await request(app)
      .post(`/api/queue/${source.id}/merge`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ targetStationId: foreign.id });
    expect(forbidden.status).toBe(403);

    const self = await request(app)
      .post(`/api/queue/${source.id}/merge`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ targetStationId: source.id });
    expect(self.status).toBe(400);

    const asAdmin = await request(app)
      .post(`/api/queue/${source.id}/merge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetStationId: foreign.id });
    expect(asAdmin.status).toBe(200);
  });
});

// ─── Demos ──────────────────────────────────────────────────────────────────

describe('GET /simulate and /demo/josephus', () => {
  it('falls back to the demo set for an empty line and compares all policies', async () => {
    const station = await makeStation({ ports: 2 });
    const response = await request(app).get(`/api/queue/${station.id}/simulate`);
    expect(response.status).toBe(200);
    expect(response.body.data.source).toBe('demo');
    expect(Object.keys(response.body.data.results).sort()).toEqual(['fifo', 'priority', 'round-robin']);
    expect(response.body.data.urgentAverageWait.priority).toBeLessThan(response.body.data.urgentAverageWait.fifo);
  });

  it('simulates the live line with one policy', async () => {
    const station = await makeStation({ ports: 1 });
    await join(station.id, 0);
    await join(station.id, 1, { emergency: true });
    await join(station.id, 2);
    const response = await request(app).get(`/api/queue/${station.id}/simulate?policy=fifo`);
    expect(response.status).toBe(200);
    expect(response.body.data.source).toBe('live');
    expect(response.body.data.ports).toBe(1);
    expect(response.body.data.result.jobs).toHaveLength(3);
    expect(response.body.data.result.timeline.length).toBeGreaterThanOrEqual(3);
  });

  it('validates the policy', async () => {
    const station = await makeStation();
    expect((await request(app).get(`/api/queue/${station.id}/simulate?policy=lottery`)).status).toBe(422);
  });

  it('plays Josephus on the circular list', async () => {
    const response = await request(app).get('/api/queue/demo/josephus?n=7&k=3');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ eliminationOrder: [3, 6, 2, 7, 5, 1, 4], survivor: 4, recurrenceSurvivor: 4 });
    expect((await request(app).get('/api/queue/demo/josephus?n=0')).status).toBe(422);
  });
});

// ─── Realtime ───────────────────────────────────────────────────────────────

describe('realtime fan-out', () => {
  it('pushes queue:updated, ports:updated and per-driver queue:position on every change', async () => {
    jest.spyOn(sockets, 'getSocketServer').mockReturnValue({} as ReturnType<typeof sockets.getSocketServer>);
    const toStation = jest.spyOn(sockets, 'emitToStation').mockImplementation(() => undefined);
    const toUser = jest.spyOn(sockets, 'emitToUser').mockImplementation(() => undefined);

    const station = await makeStation({ ports: 1 });
    await join(station.id, 0);
    await join(station.id, 1);

    const stationEvents = toStation.mock.calls.map(([id, event]) => `${id}:${event}`);
    expect(stationEvents).toEqual([
      `${station.id}:queue:updated`,
      `${station.id}:ports:updated`,
      `${station.id}:queue:updated`,
      `${station.id}:ports:updated`,
    ]);
    const lastSnapshot = toStation.mock.calls[2][2] as { queueLength: number; waiting: Record<string, unknown>[] };
    expect(lastSnapshot.queueLength).toBe(1);
    expect(JSON.stringify(lastSnapshot)).not.toContain(drivers[1].id); // public payload has no user ids

    toUser.mockClear();
    await leave(station.id, 0);
    const personal = new Map(toUser.mock.calls.map(([userId, , view]) => [userId, view]));
    expect(personal.get(drivers[0].id)).toMatchObject({ status: 'left', reason: 'completed' });
    expect(personal.get(drivers[1].id)).toMatchObject({ status: 'charging', portIndex: 0 });
    expect(toUser.mock.calls.every(([, event]) => event === 'queue:position')).toBe(true);
  });

  it('answers queue:watch and queue:position over the socket', async () => {
    const station = await makeStation({ ports: 1, free: 0 });
    await join(station.id, 0);

    const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
    const joined: string[] = [];
    const fakeSocket = {
      user: { id: drivers[0].id, email: 'x', role: 'driver', name: 'Driver 0', tokenVersion: 0 },
      on: (event: string, handler: (...args: unknown[]) => Promise<void>) => handlers.set(event, handler),
      join: async (room: string) => {
        joined.push(room);
      },
      leave: async () => undefined,
    };
    registerQueueHandlers(fakeSocket as unknown as Parameters<typeof registerQueueHandlers>[0]);

    const watchAck = jest.fn();
    await handlers.get('queue:watch')?.(station.id, watchAck);
    expect(joined).toEqual([`station:${station.id}`]);
    expect(watchAck.mock.calls[0][0]).toMatchObject({ ok: true, data: { queueLength: 1, you: { position: 1 } } });

    const positionAck = jest.fn();
    await handlers.get('queue:position')?.(station.id, positionAck);
    expect(positionAck.mock.calls[0][0]).toMatchObject({ ok: true, data: { status: 'waiting', position: 1 } });

    const badAck = jest.fn();
    await handlers.get('queue:watch')?.('nope', badAck);
    expect(badAck.mock.calls[0][0]).toMatchObject({ ok: false });
  });
});
