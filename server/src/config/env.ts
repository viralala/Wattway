/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * env.ts — load, validate and freeze configuration.
 *
 * Every environment variable the server reads is declared here and nowhere
 * else. A missing or malformed value fails at boot with a readable message
 * instead of surfacing as a mystery 500 three weeks later (the classic being a
 * blank JWT secret, which silently signs tokens anyone can forge).
 * ---------------------------------------------------------------------------
 */

import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const isTest = process.env.NODE_ENV === 'test';

/** Secrets may be weak in test, never anywhere else. */
const secret = isTest
  ? z.string().default('test-secret-not-used-outside-jest-000000000000')
  : z.string().min(32, 'must be at least 32 characters — generate one with `openssl rand -hex 32`');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:5173'),

  MONGO_URI: isTest
    ? z.string().default('mongodb://127.0.0.1:27017/wattway-test')
    : z.string().min(1, 'MONGO_URI is required'),

  REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(isTest ? 4 : 10),

  INDEX_REFRESH_MS: z.coerce.number().int().min(0).default(isTest ? 0 : 300_000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  · ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nWattWay 🌿 — invalid environment configuration:\n${details}\n`);
  throw new Error('Invalid environment configuration. Copy .env.example to .env and fill it in.');
}

const raw = parsed.data;

if (raw.NODE_ENV === 'production' && raw.JWT_ACCESS_SECRET === raw.JWT_REFRESH_SECRET) {
  throw new Error(
    'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ in production — otherwise a ' +
      'stolen access token can be replayed as a refresh token.',
  );
}

export const env = Object.freeze({
  ...raw,
  /** CORS_ORIGIN arrives comma-separated; the middleware wants a list. */
  corsOrigins: raw.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
});

export type Env = typeof env;
export default env;
