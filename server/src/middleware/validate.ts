/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * validate.ts — Zod schemas at the edge of the API.
 *
 * Nothing untrusted reaches a controller unparsed. The parsed, correctly typed
 * result replaces `req.body` / `req.query` / `req.params`, so controllers work
 * with real numbers and enums instead of the strings Express hands them.
 *
 * That last part is why this matters for *this* module in particular: the BST
 * range query compares numerically, and `"12" > "8"` is false in JavaScript.
 * Coercing at the boundary is what stops a whole class of silent wrong answers.
 * ---------------------------------------------------------------------------
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError';

export type ValidationTarget = 'body' | 'query' | 'params';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validate any combination of body / query / params.
 *
 * All three are checked before failing, so a client with two mistakes is told
 * about both rather than fixing them one round trip at a time.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: Array<{ target: ValidationTarget; path: string; message: string }> = [];
    const parsed: Partial<Record<ValidationTarget, unknown>> = {};

    for (const target of ['body', 'query', 'params'] as const) {
      const schema = schemas[target];
      if (!schema) continue;

      const result = schema.safeParse(req[target]);
      if (result.success) {
        parsed[target] = result.data;
      } else {
        issues.push(...flatten(result.error, target));
      }
    }

    if (issues.length > 0) {
      next(ApiError.validation('Request failed validation', issues));
      return;
    }

    // Express 5 makes `req.query` a getter, so assign defensively.
    for (const [target, value] of Object.entries(parsed)) {
      Object.defineProperty(req, target, { value, writable: true, configurable: true });
    }

    next();
  };
}

function flatten(
  error: ZodError,
  target: ValidationTarget,
): Array<{ target: ValidationTarget; path: string; message: string }> {
  return error.issues.map((issue) => ({
    target,
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export default validate;
