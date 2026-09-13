/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * station.routes.ts — /api/stations
 *
 * Reads are public (the map has to work for a signed-out visitor). Writes need
 * an operator or admin, and per-station writes additionally need
 * `requireStationAccess`, which checks that this operator actually manages
 * this station rather than merely holding the operator role.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import { z } from 'zod';
import * as stations from '../controllers/stationController';
import { asyncHandler } from '../middleware/asyncHandler';
import { optionalAuth, requireAuth, requireRole, requireStationAccess } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { CONNECTOR_TYPES, PORT_STATUSES } from '../types';
import { zLat, zLimit, zLng, zNumber, zObjectId, zPage } from '../utils/zod';

const router = Router();

const idParam = z.object({ id: zObjectId });

const listQuery = z
  .object({
    page: zPage,
    limit: zLimit(100, 20),
    city: z.string().trim().min(1).max(80).optional(),
    operator: z.string().trim().min(1).max(80).optional(),
    connectorType: z.enum(CONNECTOR_TYPES).optional(),
    lat: zLat.optional(),
    lng: zLng.optional(),
    radiusKm: zNumber.min(0.1).max(500).optional(),
  })
  .refine(
    (query) => (query.lat === undefined) === (query.lng === undefined),
    'lat and lng must be supplied together',
  );

const portSchema = z.object({
  connectorType: z.enum(CONNECTOR_TYPES),
  powerKw: z.number().min(1).max(400),
  status: z.enum(PORT_STATUSES).optional(),
});

const addressSchema = z.object({
  line1: z.string().trim().min(3).max(160),
  locality: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional(),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const createStationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    operator: z.string().trim().min(2).max(80),
    address: addressSchema,
    location: locationSchema,
    pricePerKwh: z.number().min(0).max(500),
    // The fixed-size port board; 32 is the schema's hard ceiling too.
    ports: z.array(portSchema).min(1, 'A station needs at least one port').max(32),
    amenities: z.array(z.string().trim().max(40)).max(20).optional(),
    graphNodeId: z.string().trim().max(64).optional(),
  })
  .strict();

const updateStationSchema = createStationSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

const portParams = z.object({
  id: zObjectId,
  portIndex: z.coerce.number().int().min(0).max(31),
});

const portStatusSchema = z.object({ status: z.enum(PORT_STATUSES) }).strict();

const ratingSchema = z
  .object({
    rating: z
      .number()
      .min(1, 'Rating must be between 1 and 5')
      .max(5, 'Rating must be between 1 and 5'),
  })
  .strict();

// ─── Public reads ───────────────────────────────────────────────────────────

router.get('/', optionalAuth, validate({ query: listQuery }), asyncHandler(stations.listStations));

router.get('/:id', optionalAuth, validate({ params: idParam }), asyncHandler(stations.getStation));

// ─── Writes ─────────────────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  requireRole('operator', 'admin'),
  validate({ body: createStationSchema }),
  asyncHandler(stations.createStation),
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: idParam, body: updateStationSchema }),
  requireStationAccess('id'),
  asyncHandler(stations.updateStation),
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: idParam }),
  requireStationAccess('id'),
  asyncHandler(stations.deactivateStation),
);

/**
 * The Array data structure endpoint: O(1) flip of one slot on the fixed-size
 * port board. The queue module calls this when a charging session starts/ends.
 */
router.patch(
  '/:id/ports/:portIndex',
  requireAuth,
  validate({ params: portParams, body: portStatusSchema }),
  requireStationAccess('id'),
  asyncHandler(stations.setPortStatus),
);

/** Any signed-in driver may rate a station — this moves it in the rating BST. */
router.post(
  '/:id/rating',
  requireAuth,
  validate({ params: idParam, body: ratingSchema }),
  asyncHandler(stations.rateStation),
);

export default router;
