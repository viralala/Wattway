/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * error.ts — the last stop for anything that goes wrong.
 *
 * Two rules this file enforces:
 *
 *  1. Clients see a stable shape (`{ success: false, error: { code, message } }`)
 *     whatever actually failed — a Zod error, a Mongo duplicate key, or a
 *     genuine crash.
 *
 *  2. Unexpected errors never leak their internals. An `ApiError` was thrown on
 *     purpose and its message is safe to show; anything else gets a generic
 *     message, with the real one logged server-side. Mongo's duplicate-key
 *     error, for instance, echoes the offending value straight back, which is
 *     how an "email already registered" response quietly becomes an account
 *     enumeration oracle.
 * ---------------------------------------------------------------------------
 */

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError, isApiError } from '../utils/ApiError';
import { fail } from '../utils/respond';
import { logger } from '../utils/logger';
import { env } from '../config/env';

/** Mounted after every route: anything unmatched is a 404. */
export function notFoundHandler(req: Request, res: Response): void {
  fail(res, 404, 'NOT_FOUND', `No route matches ${req.method} ${req.originalUrl}`);
}

/** Express recognises an error handler by its four-argument signature. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const normalised = normalise(error);

  // A 5xx we raised on purpose (a 503 while the index builds, say) is not a
  // crash: log the line, not the stack. Only an unexpected throw gets the
  // full object, because only then is the stack worth reading.
  if (normalised.status >= 500 && !isApiError(error)) {
    logger.error(`${req.method} ${req.originalUrl} → ${normalised.status}`, error);
  } else if (normalised.status >= 500) {
    logger.warn(`${req.method} ${req.originalUrl} → ${normalised.status} ${normalised.code}`);
  } else {
    logger.debug(`${req.method} ${req.originalUrl} → ${normalised.status} ${normalised.code}`);
  }

  // Stack traces are a development convenience, never a production response.
  const details =
    normalised.status >= 500 && !env.isProduction && error instanceof Error
      ? { stack: error.stack?.split('\n').slice(0, 5) }
      : normalised.details;

  fail(res, normalised.status, normalised.code, normalised.message, details);
}

interface Normalised {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

function normalise(error: unknown): Normalised {
  if (isApiError(error)) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  // A Zod error that escaped the validate middleware (e.g. thrown in a service).
  if (error instanceof ZodError) {
    return {
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Request failed validation',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    };
  }

  // Postgres rejected the write. Name the problem, never echo the value.
  if (isPostgresError(error)) {
    // unique_violation
    if (error.code === '23505') {
      return { status: 409, code: 'CONFLICT', message: `A record with that ${uniqueField(error)} already exists` };
    }
    // check_violation, not_null_violation, invalid_text_representation (e.g. a malformed uuid)
    if (error.code === '23514' || error.code === '23502' || error.code === '22P02') {
      return { status: 422, code: 'VALIDATION_FAILED', message: 'Request failed validation' };
    }
    // foreign_key_violation
    if (error.code === '23503') {
      return { status: 404, code: 'NOT_FOUND', message: 'A referenced record does not exist' };
    }
  }

  // Body parser rejected malformed JSON.
  if (error instanceof SyntaxError && 'body' in error) {
    return { status: 400, code: 'BAD_REQUEST', message: 'Request body is not valid JSON' };
  }

  return {
    status: 500,
    code: 'INTERNAL',
    message: ApiError.internal().message,
  };
}

interface PostgresError {
  code: string;
  constraint?: string;
  detail?: string;
}

function isPostgresError(error: unknown): error is PostgresError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

/** "Key (email)=(...)" → "email"; falls back to the constraint name. */
function uniqueField(error: PostgresError): string {
  const match = /Key \(([^)]+)\)/.exec(error.detail ?? '');
  if (match) return match[1].replace(/[()]/g, '').replace(/address->>'city'/, 'city');
  if (error.constraint?.includes('email')) return 'email';
  if (error.constraint?.includes('name_city')) return 'name';
  return 'value';
}
