/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * zod.ts — query-string primitives.
 *
 * Everything in a query string is a string. These helpers coerce correctly —
 * in particular `zBool`, because `z.coerce.boolean()` follows JavaScript
 * truthiness and therefore turns the string "false" into `true`, which is
 * exactly the bug you do not want in a filter flag.
 * ---------------------------------------------------------------------------
 */

import { z } from 'zod';

/** `?flag=false` → false. Accepts true/false/1/0/yes/no, case-insensitively. */
export const zBool = z
  .union([z.boolean(), z.string()])
  .transform((value, ctx) => {
    if (typeof value === 'boolean') return value;
    const normalised = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
    if (['false', '0', 'no', 'off'].includes(normalised)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Expected a boolean, received '${value}'`,
    });
    return z.NEVER;
  });

/**
 * A finite number from a query string.
 *
 * `.finite()` rather than `.refine(Number.isFinite)` on purpose: refine returns
 * a ZodEffects, which is no longer chainable with `.min()`/`.max()`, so every
 * caller downstream would have to restate its bounds some other way.
 */
export const zNumber = z.coerce.number().finite('Must be a finite number');

export const zLat = zNumber.min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90');
export const zLng = zNumber
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

export const zPage = z.coerce.number().int().min(1).default(1);
export const zLimit = (max = 100, fallback = 20) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

/** A 24-character hex MongoDB ObjectId. */
export const zObjectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character resource id');

/**
 * Passwords. Long enough to resist a dictionary attack, with one class rule so
 * "aaaaaaaa" does not pass. Deliberately no maximum-complexity theatre — length
 * is what actually matters, and bcrypt caps meaningfully at 72 bytes.
 */
export const zPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine(
    (value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value),
    'Password must contain at least one letter and one number',
  );

export const zEmail = z.string().trim().toLowerCase().email('Must be a valid email address');
