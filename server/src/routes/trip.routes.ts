/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  trip.routes.ts - /api/trips. Everything here is the signed-in driver's own
 *  history, so every route needs auth and a trip is only ever visible to its
 *  owner.
 * ============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import * as trips from '../controllers/tripController';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { TRIP_STATUSES } from '../models/Trip';
import { zLimit, zObjectId } from '../utils/zod';

const router = Router();

const idParams = z.object({ id: zObjectId });

const listQuery = z.object({
  limit: zLimit(100, 20),
  /** Id of the last trip already shown — continue the list after it. */
  before: zObjectId.optional(),
});

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();

const createSchema = z
  .object({
    origin: point,
    originLabel: z.string().trim().max(160).optional(),
    destination: point,
    destinationLabel: z.string().trim().max(160).optional(),
    batteryStartPct: z.number().min(0).max(100),
    chargingStop: z
      .object({
        stationId: zObjectId,
        arrivalBatteryPct: z.number().min(0).max(100).optional(),
        estimatedWaitMinutes: z.number().min(0).optional(),
        estimatedChargeMinutes: z.number().min(0).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    route: z.unknown().optional(),
    distanceKm: z.number().min(0).optional(),
    estimatedDurationMinutes: z.number().min(0).optional(),
    status: z.enum(TRIP_STATUSES).optional(),
  })
  .strict();

router.get('/', requireAuth, validate({ query: listQuery }), asyncHandler(trips.listTrips));
router.post('/', requireAuth, validate({ body: createSchema }), asyncHandler(trips.createTrip));
router.get('/:id', requireAuth, validate({ params: idParams }), asyncHandler(trips.getTrip));
router.delete('/:id', requireAuth, validate({ params: idParams }), asyncHandler(trips.deleteTrip));

export default router;
