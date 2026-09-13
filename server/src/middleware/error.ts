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
import mongoose from 'mongoose';
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

  // Mongoose schema validation.
  if (error instanceof mongoose.Error.ValidationError) {
    return {
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Request failed validation',
      details: Object.values(error.errors).map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    };
  }

  // A malformed ObjectId in a path parameter is a client mistake, not a crash.
  if (error instanceof mongoose.Error.CastError) {
    return {
      status: 400,
      code: 'BAD_REQUEST',
      message: `'${String(error.value)}' is not a valid ${error.path}`,
    };
  }

  // Duplicate key. Name the field, never echo the value.
  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? 'field';
    return {
      status: 409,
      code: 'CONFLICT',
      message: `A record with that ${field} already exists`,
    };
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

interface DuplicateKeyError {
  code: number;
  keyPattern?: Record<string, unknown>;
}

function isDuplicateKeyError(error: unknown): error is DuplicateKeyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 11000
  );
}
