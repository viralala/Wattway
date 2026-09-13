/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * respond.ts — one response envelope for the whole API.
 *
 * Every successful response is `{ success: true, data, meta? }` and every
 * failure is `{ success: false, error: { code, message, details? } }`. The
 * client can therefore branch on one field, and the other three modules do not
 * each invent their own shape.
 *
 * The `meta.team` stamp is intentional: the demo shows the brand on every
 * payload, not just the landing page.
 * ---------------------------------------------------------------------------
 */

import type { Response } from 'express';
import { BRAND } from '../config/brand';

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ResponseMeta {
  [key: string]: unknown;
  pagination?: Pagination;
  /** Milliseconds spent inside the handler — handy for the complexity demo. */
  tookMs?: number;
}

export interface SuccessBody<T> {
  success: true;
  data: T;
  meta: ResponseMeta & { team: string };
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: { team: string };
}

export function ok<T>(res: Response, data: T, meta: ResponseMeta = {}, status = 200): Response {
  const body: SuccessBody<T> = {
    success: true,
    data,
    meta: { ...meta, team: BRAND.team },
  };
  return res.status(status).json(body);
}

export function created<T>(res: Response, data: T, meta: ResponseMeta = {}): Response {
  return ok(res, data, meta, 201);
}

export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: ErrorBody = {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
    meta: { team: BRAND.team },
  };
  return res.status(status).json(body);
}

/** Build the pagination block from the three numbers handlers actually have. */
export function paginate(page: number, limit: number, total: number): Pagination {
  return {
    page,
    limit,
    total,
    pages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}
