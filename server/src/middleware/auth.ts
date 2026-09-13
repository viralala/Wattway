/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * auth.ts — the JWT gate every protected route sits behind.
 *
 * PRD Section 11: "JWT-protected routes for anything user- or operator-specific."
 *
 * A DELIBERATE TRADE-OFF, WORTH KNOWING ABOUT
 * -------------------------------------------
 * `requireAuth` does NOT hit the database. It trusts a correctly signed,
 * unexpired access token and the claims inside it.
 *
 * That is what makes the auth stateless — and it means a role change or a
 * "log out everywhere" takes effect when the current access token expires
 * (15 minutes), not instantly. Revocation is enforced at the refresh boundary
 * instead, where we do load the user and compare `tokenVersion`.
 *
 * If a route ever needs a stricter guarantee than "correct as of 15 minutes
 * ago", use `requireFreshUser` below, which pays for a database read.
 * ---------------------------------------------------------------------------
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { bearerFrom, verifyAccessToken } from '../services/tokenService';
import { ApiError } from '../utils/ApiError';
import { User } from '../models/User';
import { Station } from '../models/Station';
import type { AuthUser, UserRole } from '../types';

/** Reject the request unless it carries a valid access token. */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = bearerFrom(req.headers.authorization);
  if (!token) {
    next(ApiError.unauthorized('Missing Authorization: Bearer <token> header'));
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.user = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      name: claims.name,
      tokenVersion: claims.tv,
    };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Attach `req.user` when a valid token is present, but never reject.
 *
 * Used on public station reads so a signed-in driver gets personalised
 * ordering while an anonymous visitor still sees the map.
 */
export const optionalAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = bearerFrom(req.headers.authorization);
  if (!token) {
    next();
    return;
  }
  try {
    const claims = verifyAccessToken(token);
    req.user = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      name: claims.name,
      tokenVersion: claims.tv,
    };
  } catch {
    // A bad token on an optional route is treated as no token at all.
  }
  next();
};

/**
 * Require one of `roles`. Always compose after `requireAuth` — on its own it
 * would 401 every request, which is safe but not useful.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(
        ApiError.forbidden(
          `This action requires the ${roles.join(' or ')} role; you are signed in as ${req.user.role}.`,
        ),
      );
      return;
    }
    next();
  };
}

/**
 * Re-read the user from the database and refuse if the token's version is
 * stale. Costs one query; use it only where instant revocation matters.
 */
export const requireFreshUser: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw ApiError.unauthorized();

    const user = await User.findById(req.user.id).exec();
    if (!user) throw ApiError.unauthorized('Account no longer exists', 'TOKEN_INVALID');
    if (user.tokenVersion !== req.user.tokenVersion) {
      throw ApiError.unauthorized('Session has been revoked, please sign in again', 'TOKEN_INVALID');
    }

    req.user = user.toAuthUser();
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Authorise a write against one specific station.
 *
 * Admins pass unconditionally. An operator passes only for a station they
 * manage — checked against `Station.managedBy`, which is the authoritative
 * link (a user's `operatorOf` array is a convenience mirror of it).
 *
 * @param param name of the route parameter holding the station id.
 */
export function requireStationAccess(param = 'id'): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw ApiError.unauthorized();
      if (req.user.role === 'admin') {
        next();
        return;
      }
      if (req.user.role !== 'operator') {
        throw ApiError.forbidden('Only station operators can modify a station');
      }

      const stationId = req.params[param];
      const station = await Station.findById(stationId).select('managedBy').exec();
      if (!station) throw ApiError.notFound('Station not found');

      if (!station.managedBy || station.managedBy.toString() !== req.user.id) {
        throw ApiError.forbidden('You do not manage this station');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Narrow `req.user` for handlers that run behind `requireAuth`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) {
    // Reaching here means a handler was mounted without requireAuth in front
    // of it — a wiring bug, not a client error.
    throw ApiError.internal('Route is missing the requireAuth middleware');
  }
  return req.user;
}
