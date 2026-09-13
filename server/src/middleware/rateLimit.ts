/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * rateLimit.ts — two limiters, because two routes have very different shapes.
 *
 *  · `apiLimiter`  — generous, applied to everything.
 *  · `authLimiter` — strict, applied to login/register/refresh. Credential
 *    stuffing is the one attack a course project will actually meet in the
 *    wild if it is ever deployed, and it is cheap to blunt.
 *
 * Autocomplete is deliberately NOT rate limited beyond the general cap: it
 * fires on every keystroke by design, and that is the whole point of the trie.
 * ---------------------------------------------------------------------------
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env';
import { fail } from '../utils/respond';

const shared = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  // Tests fire hundreds of requests in milliseconds; limiting them is noise.
  skip: () => env.isTest,
};

export const apiLimiter: RateLimitRequestHandler = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  handler: (_req, res) =>
    fail(res, 429, 'RATE_LIMITED', 'Too many requests — please slow down and try again shortly.'),
});

export const authLimiter: RateLimitRequestHandler = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  // Failed attempts are what we care about; a successful login shouldn't count.
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    fail(
      res,
      429,
      'RATE_LIMITED',
      'Too many authentication attempts. Try again in about fifteen minutes.',
    ),
});
