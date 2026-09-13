/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * tokenService.ts — minting and verifying JWTs.
 *
 * PRD Section 7: "Auth — JWT (jsonwebtoken + bcrypt). Simple stateless auth."
 *
 * Two token types, signed with two different secrets:
 *
 *   access   short-lived (15m), carries the claims routes authorise against.
 *   refresh  long-lived (30d), carries almost nothing and can only be
 *            exchanged for a new access token.
 *
 * Separate secrets matter: if they were the same, a leaked access token could
 * be replayed against the refresh endpoint and silently renewed forever. The
 * `typ` claim is checked on top of that, so a token minted for one purpose is
 * rejected when presented for the other even if the secrets were ever unified.
 *
 * `tv` (token version) mirrors `User.tokenVersion`. Bumping the user's version
 * invalidates every refresh token ever issued to them — that is how
 * "log out everywhere" and "password changed" work without a session store.
 * ---------------------------------------------------------------------------
 */

import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import type { AuthUser, UserRole } from '../types';

export type TokenType = 'access' | 'refresh';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
  tv: number;
  typ: 'access';
}

export interface RefreshTokenClaims extends JwtPayload {
  sub: string;
  tv: number;
  typ: 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Seconds until the access token expires, for the client's refresh timer. */
  expiresIn: number;
}

const ISSUER = 'wattway-api';
const AUDIENCE = 'wattway-client';

export function signAccessToken(user: AuthUser): string {
  const claims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    tv: user.tokenVersion,
    typ: 'access' as const,
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, options(env.JWT_ACCESS_TTL));
}

export function signRefreshToken(user: Pick<AuthUser, 'id' | 'tokenVersion'>): string {
  const claims = { sub: user.id, tv: user.tokenVersion, typ: 'refresh' as const };
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, options(env.JWT_REFRESH_TTL));
}

export function issueTokenPair(user: AuthUser): TokenPair {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: secondsUntilExpiry(accessToken),
  };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const claims = verify(token, env.JWT_ACCESS_SECRET);
  if (claims.typ !== 'access') {
    throw ApiError.unauthorized('Expected an access token', 'TOKEN_INVALID');
  }
  return claims as AccessTokenClaims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const claims = verify(token, env.JWT_REFRESH_SECRET);
  if (claims.typ !== 'refresh') {
    throw ApiError.unauthorized('Expected a refresh token', 'TOKEN_INVALID');
  }
  return claims as RefreshTokenClaims;
}

/** Pull a bearer token out of an Authorization header. */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function options(expiresIn: string): SignOptions {
  return {
    expiresIn: expiresIn as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
  };
}

/**
 * Verify, translating jsonwebtoken's error classes into our own so the error
 * middleware never has to know that library exists — and so an expired token
 * gets its own code, letting the client refresh instead of bouncing the user
 * to the login screen.
 */
function verify(token: string, secret: string): JwtPayload {
  try {
    const decoded = jwt.verify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
    if (typeof decoded === 'string') {
      throw ApiError.unauthorized('Malformed token payload', 'TOKEN_INVALID');
    }
    return decoded;
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Token has expired', 'TOKEN_EXPIRED');
    }
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
      throw ApiError.unauthorized('Token is not valid', 'TOKEN_INVALID');
    }
    throw ApiError.unauthorized('Token could not be verified', 'TOKEN_INVALID');
  }
}

function secondsUntilExpiry(token: string): number {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string' || !decoded.exp) return 0;
  return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
}
