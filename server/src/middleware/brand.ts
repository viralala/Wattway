/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * brand.ts — request id + the team's signature on every response.
 *
 * `X-Request-Id` is echoed back so a log line can be matched to the request a
 * teammate is complaining about. The other two headers are the team's mark on
 * everything the API emits.
 * ---------------------------------------------------------------------------
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { BRAND } from '../config/brand';

export function brandAndTrace(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Powered-By', BRAND.poweredBy);
  res.setHeader('X-WattWay-Team', BRAND.teamAscii);

  next();
}

export default brandAndTrace;
