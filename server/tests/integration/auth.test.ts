/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * auth.test.ts — the JWT flow, end to end, against a real mongod.
 *
 * PRD Section 11: "Passwords hashed (bcrypt); JWT-protected routes for
 *                  anything user- or operator-specific."
 * ---------------------------------------------------------------------------
 */

import request from 'supertest';
import { app } from '../../src/app';
import { User } from '../../src/models/User';
import { signAccessToken, signRefreshToken } from '../../src/services/tokenService';
import { clearTestDatabase, startTestDatabase, stopTestDatabase, syncIndexes } from '../helpers/db';
import { makeUserBody } from '../helpers/factories';

beforeAll(async () => {
  await startTestDatabase();
  await syncIndexes();
});

afterAll(async () => {
  await stopTestDatabase();
});

afterEach(async () => {
  await clearTestDatabase();
});

async function registerDriver(overrides: Record<string, unknown> = {}) {
  const body = makeUserBody(overrides);
  const response = await request(app).post('/api/auth/register').send(body);
  return { body, response };
}

describe('POST /api/auth/register', () => {
  it('creates an account and returns a token pair', async () => {
    const { body, response } = await registerDriver();

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(body.email);
    expect(response.body.data.user.role).toBe('driver');
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(response.body.data.tokenType).toBe('Bearer');
  });

  it('never returns the password hash', async () => {
    const { response } = await registerDriver();
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('$2');
  });

  it('stores the password hashed, not in the clear', async () => {
    const { body } = await registerDriver();
    const user = await User.findByEmailWithPassword(body.email as string);
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe(body.password);
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
  });

  it('rejects a duplicate email', async () => {
    const { body } = await registerDriver();
    const second = await request(app).post('/api/auth/register').send(body);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak or malformed payload', async () => {
    const cases = [
      { ...makeUserBody(), password: 'short' },
      { ...makeUserBody(), password: 'alllettersnonumbers' },
      { ...makeUserBody(), email: 'not-an-email' },
      { ...makeUserBody(), name: 'x' },
    ];
    for (const payload of cases) {
      const response = await request(app).post('/api/auth/register').send(payload);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses to let a caller grant themselves admin', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send(makeUserBody({ role: 'admin' }));
    // The schema rejects the value outright rather than silently downgrading.
    expect(response.status).toBe(422);
  });

  it('allows registering as an operator', async () => {
    const { response } = await registerDriver({ role: 'operator' });
    expect(response.status).toBe(201);
    expect(response.body.data.user.role).toBe('operator');
  });

  it('rejects unknown fields rather than ignoring them', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...makeUserBody(), isAdmin: true });
    expect(response.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  it('returns tokens for correct credentials', async () => {
    const { body } = await registerDriver();
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: body.email, password: body.password });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
  });

  it('is case-insensitive about the email', async () => {
    const { body } = await registerDriver();
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: (body.email as string).toUpperCase(), password: body.password });
    expect(response.status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const { body } = await registerDriver();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: body.email, password: 'wrongpassword1' });

    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@wattway.test', password: 'wrongpassword1' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    // Identical responses, so the endpoint cannot enumerate accounts.
    expect(wrongPassword.body.error).toEqual(unknownUser.body.error);
  });

  it('records the login time', async () => {
    const { body } = await registerDriver();
    await request(app).post('/api/auth/login').send({ email: body.email, password: body.password });
    const user = await User.findOne({ email: body.email }).exec();
    expect(user!.lastLoginAt).toBeInstanceOf(Date);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in user', async () => {
    const { body, response } = await registerDriver();
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${response.body.data.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(body.email);
  });

  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed or tampered token', async () => {
    for (const header of ['Bearer nonsense', 'Basic abc', 'Bearer', 'nonsense']) {
      const response = await request(app).get('/api/auth/me').set('Authorization', header);
      expect(response.status).toBe(401);
    }
  });

  it('rejects a refresh token presented as an access token', async () => {
    const refreshToken = signRefreshToken({ id: 'a'.repeat(24), tokenVersion: 0 });
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a token signed with the wrong secret', async () => {
    // A token whose signature does not verify, built by mangling a real one.
    const { response } = await registerDriver();
    const [header, payload] = (response.body.data.accessToken as string).split('.');
    const forged = `${header}.${payload}.deadbeefdeadbeefdeadbeef`;

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(me.status).toBe(401);
  });
});

describe('PATCH /api/auth/me', () => {
  it('updates the profile and vehicle', async () => {
    const { response } = await registerDriver();
    const token = response.body.data.accessToken;

    const updated = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Renamed Driver',
        vehicle: { make: 'Tata', model: 'Nexon EV', batteryCapacityKwh: 40, connectorType: 'CCS2' },
      });

    expect(updated.status).toBe(200);
    expect(updated.body.data.user.name).toBe('Renamed Driver');
    expect(updated.body.data.user.vehicle.model).toBe('Nexon EV');
  });

  it('rejects an empty update', async () => {
    const { response } = await registerDriver();
    const updated = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${response.body.data.accessToken}`)
      .send({});
    expect(updated.status).toBe(422);
  });
});

describe('POST /api/auth/refresh', () => {
  it('exchanges a refresh token for a new pair', async () => {
    const { response } = await registerDriver();

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: response.body.data.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
  });

  it('refuses an access token in place of a refresh token', async () => {
    const { response } = await registerDriver();
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: response.body.data.accessToken });

    expect(refreshed.status).toBe(401);
    expect(refreshed.body.error.code).toBe('TOKEN_INVALID');
  });

  it('refuses a token whose version is stale after logout', async () => {
    const { response } = await registerDriver();
    const { accessToken, refreshToken } = response.body.data;

    const loggedOut = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(loggedOut.status).toBe(200);

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.error.message).toMatch(/revoked/i);
  });

  it('refuses a refresh token for a deleted account', async () => {
    const { body, response } = await registerDriver();
    await User.deleteOne({ email: body.email }).exec();

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: response.body.data.refreshToken });

    expect(refreshed.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password, revokes other sessions and returns fresh tokens', async () => {
    const { body, response } = await registerDriver();
    const { accessToken, refreshToken } = response.body.data;

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: body.password, newPassword: 'brandnew456' });

    expect(changed.status).toBe(200);
    expect(changed.body.data.accessToken).toEqual(expect.any(String));

    // The old refresh token is dead.
    const stale = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(stale.status).toBe(401);

    // The old password no longer works, the new one does.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: body.email, password: body.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: body.email, password: 'brandnew456' });
    expect(newLogin.status).toBe(200);
  });

  it('refuses when the current password is wrong', async () => {
    const { response } = await registerDriver();
    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${response.body.data.accessToken}`)
      .send({ currentPassword: 'notitatall1', newPassword: 'brandnew456' });

    expect(changed.status).toBe(401);
  });

  it('refuses reusing the same password', async () => {
    const { body, response } = await registerDriver();
    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${response.body.data.accessToken}`)
      .send({ currentPassword: body.password, newPassword: body.password });

    expect(changed.status).toBe(422);
  });
});

describe('role enforcement', () => {
  it('refuses an admin-only route to a driver', async () => {
    const { response } = await registerDriver();
    const rebuild = await request(app)
      .post('/api/index/rebuild')
      .set('Authorization', `Bearer ${response.body.data.accessToken}`);

    expect(rebuild.status).toBe(403);
    expect(rebuild.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin through', async () => {
    const admin = await User.create({
      name: 'Admin',
      email: 'admin@wattway.test',
      passwordHash: 'kothimbir123',
      role: 'admin',
    });

    const rebuild = await request(app)
      .post('/api/index/rebuild')
      .set('Authorization', `Bearer ${signAccessToken(admin.toAuthUser())}`);

    expect(rebuild.status).toBe(200);
    expect(rebuild.body.data.rebuilt).toBe(true);
  });
});

describe('response envelope', () => {
  it('stamps the team on every response and echoes a request id', async () => {
    const response = await request(app).get('/api/meta');
    expect(response.body.meta.team).toContain('Kothimbir');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.headers['x-wattway-team']).toContain('Kothimbir');
  });

  it('returns a structured 404 for an unknown route', async () => {
    const response = await request(app).get('/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 501 with an owner for a module that has not landed', async () => {
    const response = await request(app).post('/api/routes/plan').send({});
    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(response.body.error.details.module).toBe('Routing & Pathfinding');
  });
});
