/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  tripController.ts - /api/trips: a driver's trip history, served as a
 *  most-recent-first singly linked list (see services/tripService.ts).
 * ============================================================================
 */

import type { Request, Response } from 'express';
import * as trips from '../services/tripService';
import { currentUser } from '../middleware/auth';
import { created, ok } from '../utils/respond';
import { tripJSON } from '../models/Trip';

/** GET /api/trips?limit=&before= */
export async function listTrips(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { limit = 20, before } = req.query as unknown as { limit?: number; before?: string };
  const page = await trips.history(user.id, { limit, ...(before ? { before } : {}) });
  ok(res, page);
}

/** POST /api/trips — insert at the head of the list. */
export async function createTrip(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const trip = await trips.recordTrip(user.id, req.body as trips.RecordTripInput);
  created(res, { trip: tripJSON(trip) });
}

/** GET /api/trips/:id */
export async function getTrip(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const trip = await trips.getTrip(user.id, req.params.id);
  ok(res, { trip: tripJSON(trip) });
}

/** DELETE /api/trips/:id — unlink one node, re-pointing its newer neighbour. */
export async function deleteTrip(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  await trips.deleteTrip(user.id, req.params.id);
  ok(res, { deleted: true });
}
