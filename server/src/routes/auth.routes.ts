/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * auth.routes.ts — /api/auth
 *
 * Each route reads as its own contract: path, rate limit, validation, auth
 * guard, handler. If you want to know what `POST /api/auth/login` accepts, the
 * schema is right here rather than three files away.
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import { z } from 'zod';
import * as auth from '../controllers/authController';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { authLimiter } from '../middleware/rateLimit';
import { CONNECTOR_TYPES } from '../types';
import { zEmail, zPassword } from '../utils/zod';

const router = Router();

const vehicleSchema = z
  .object({
    make: z.string().trim().max(60).optional(),
    model: z.string().trim().max(60).optional(),
    batteryCapacityKwh: z.number().min(1).max(400).optional(),
    rangeKm: z.number().min(1).max(2000).optional(),
    connectorType: z.enum(CONNECTOR_TYPES).optional(),
  })
  .strict();

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    email: zEmail,
    password: zPassword,
    // 'admin' is absent on purpose — the controller would refuse it anyway,
    // but rejecting it here gives a clearer error than silently downgrading.
    role: z.enum(['driver', 'operator']).optional(),
    vehicle: vehicleSchema.optional(),
  })
  .strict();

const loginSchema = z
  .object({
    email: zEmail,
    // No complexity rule on login: an existing password must be accepted as-is.
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

const refreshSchema = z.object({ refreshToken: z.string().min(10) }).strict();

const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    vehicle: vehicleSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: zPassword,
  })
  .strict()
  .refine(
    (body) => body.currentPassword !== body.newPassword,
    'New password must differ from the current one',
  );

router.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(auth.register),
);

router.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(auth.login));

router.post('/refresh', authLimiter, validate({ body: refreshSchema }), asyncHandler(auth.refresh));

router.post('/logout', requireAuth, asyncHandler(auth.logout));

router.get('/me', requireAuth, asyncHandler(auth.me));

router.patch('/me', requireAuth, validate({ body: updateMeSchema }), asyncHandler(auth.updateMe));

router.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(auth.changePassword),
);

export default router;
