/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * ApiError.ts — the one error type controllers are allowed to throw.
 *
 * Anything else that escapes a handler is treated as an unexpected failure by
 * the error middleware and reported as a 500 with its detail stripped, so we
 * never leak a stack trace or a Mongo error message to a client.
 * ---------------------------------------------------------------------------
 */

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INDEX_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  /** Distinguishes "we meant this" from "something blew up". */
  readonly expected = true;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static validation(message = 'Validation failed', details?: unknown): ApiError {
    return new ApiError(422, 'VALIDATION_FAILED', message, details);
  }

  static unauthorized(message = 'Authentication required', code: ApiErrorCode = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'You do not have access to this resource'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message = 'Resource already exists', details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static notImplemented(message = 'Not implemented yet'): ApiError {
    return new ApiError(501, 'NOT_IMPLEMENTED', message);
  }

  static internal(message = 'Something went wrong'): ApiError {
    return new ApiError(500, 'INTERNAL', message);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export default ApiError;
