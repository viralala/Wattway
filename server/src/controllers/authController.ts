/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * authController.ts — sign-up, sign-in, refresh, profile.
 *
 * PRD Section 10.1: "User sign-up/login (JWT-based)."
 *
 * The refresh endpoint is the only place that reloads the user from the
 * database and compares `tokenVersion`. See middleware/auth.ts for why that is
 * where revocation lives.
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import { Users, comparePassword, toAuthUser, userJSON, type VehicleProfile } from '../models/User';
import { issueTokenPair, verifyRefreshToken } from '../services/tokenService';
import { ApiError } from '../utils/ApiError';
import { created, ok } from '../utils/respond';
import { currentUser } from '../middleware/auth';
import { logger } from '../utils/logger';
import type { UserRole } from '../types';

interface RegisterBody {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  vehicle?: {
    make?: string;
    model?: string;
    batteryCapacityKwh?: number;
    rangeKm?: number;
    connectorType?: string;
  };
}

/** POST /api/auth/register */
export async function register(req: Request, res: Response): Promise<void> {
  const { name, email, password, role, vehicle } = req.body as RegisterBody;

  // Checked up front for a clean message; the unique index is the real guard
  // against two concurrent sign-ups racing past this read.
  const existing = await Users.findByEmail(email);
  if (existing) {
    throw ApiError.conflict('An account with that email already exists');
  }

  // Nobody grants themselves admin over the wire. Admins are seeded.
  const requestedRole: UserRole = role === 'operator' ? 'operator' : 'driver';

  // Users.create hashes the password; it is never stored as given.
  const user = await Users.create({
    name,
    email,
    password,
    role: requestedRole,
    ...(vehicle ? { vehicle: vehicle as VehicleProfile } : {}),
  });

  const tokens = issueTokenPair(toAuthUser(user));
  logger.info(`New ${requestedRole} registered: ${user.email}`);

  created(res, { user: userJSON(user), ...tokens });
}

/** POST /api/auth/login */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };

  const found = await Users.findByEmailWithPassword(email);

  // One message for both "no such account" and "wrong password", so the
  // endpoint cannot be used to discover which emails are registered.
  if (!found || !(await comparePassword(password, found.passwordHash))) {
    throw ApiError.unauthorized('Email or password is incorrect', 'INVALID_CREDENTIALS');
  }

  const user = (await Users.update(found.id, { lastLoginAt: new Date() })) ?? found;

  const tokens = issueTokenPair(toAuthUser(user));
  ok(res, { user: userJSON(user), ...tokens });
}

/** POST /api/auth/refresh */
export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken: string };

  const claims = verifyRefreshToken(refreshToken);

  const user = await Users.findById(claims.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists', 'TOKEN_INVALID');

  // The revocation check. A token minted before the last logout-everywhere or
  // password change carries an older version and dies here.
  if (user.tokenVersion !== claims.tv) {
    throw ApiError.unauthorized('Session has been revoked, please sign in again', 'TOKEN_INVALID');
  }

  ok(res, issueTokenPair(toAuthUser(user)));
}

/**
 * POST /api/auth/logout
 *
 * Stateless JWTs cannot be un-issued, so "logout" means bumping the version
 * that every outstanding refresh token was signed against. Existing access
 * tokens stay valid until they expire — see the trade-off note in
 * middleware/auth.ts.
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const actor = currentUser(req);
  await Users.bumpTokenVersion(actor.id);
  ok(res, { loggedOut: true, message: 'All refresh tokens for this account have been revoked.' });
}

/** GET /api/auth/me */
export async function me(req: Request, res: Response): Promise<void> {
  const actor = currentUser(req);
  const user = await Users.findById(actor.id);
  if (!user) throw ApiError.notFound('Account not found');
  ok(res, { user: userJSON(user) });
}

/** PATCH /api/auth/me */
export async function updateMe(req: Request, res: Response): Promise<void> {
  const actor = currentUser(req);
  const { name, vehicle } = req.body as { name?: string; vehicle?: Record<string, unknown> };

  const user = await Users.update(actor.id, {
    ...(name !== undefined ? { name } : {}),
    ...(vehicle !== undefined ? { vehicle: vehicle as VehicleProfile } : {}),
  });
  if (!user) throw ApiError.notFound('Account not found');
  ok(res, { user: userJSON(user) });
}

/** POST /api/auth/change-password */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const actor = currentUser(req);
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  const hash = await Users.passwordHashOf(actor.id);
  if (!hash) throw ApiError.notFound('Account not found');

  if (!(await comparePassword(currentPassword, hash))) {
    throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  }

  // Changing a password logs every other session out (setPassword bumps the token version).
  const user = await Users.setPassword(actor.id, newPassword);
  if (!user) throw ApiError.notFound('Account not found');

  // The caller keeps working: fresh tokens at the new version.
  ok(res, {
    message: 'Password updated. Other sessions have been signed out.',
    ...issueTokenPair(toAuthUser(user)),
  });
}
