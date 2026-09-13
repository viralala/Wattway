/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * asyncHandler.ts
 *
 * Express 4 does not catch rejections from async handlers — an `await` that
 * throws hangs the request instead of reaching the error middleware. Wrapping
 * every async handler in this forwards the rejection to `next()`.
 *
 * Wrap every async route handler you add. It is the single easiest way to turn
 * a silent hung request into a clean 500.
 * ---------------------------------------------------------------------------
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export default asyncHandler;
