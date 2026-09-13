/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * User.ts — drivers, station operators and admins.
 *
 * PRD Section 10: "User sign-up/login (JWT-based)."
 * PRD Section 11: "Passwords hashed (bcrypt); JWT-protected routes for
 *                  anything user- or operator-specific."
 *
 * Two details worth calling out:
 *
 *  · `passwordHash` has `select: false`, so a stray `User.find()` anywhere in
 *    the codebase cannot accidentally serialise it into a response. Login has
 *    to ask for it explicitly.
 *
 *  · `tokenVersion` is bumped on logout-everywhere and on password change. Any
 *    refresh token minted before the bump stops verifying, which gives us
 *    revocation without a server-side session store.
 * ---------------------------------------------------------------------------
 */

import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { CONNECTOR_TYPES, USER_ROLES, type AuthUser, type ConnectorType, type UserRole } from '../types';

export interface VehicleProfile {
  make?: string;
  model?: string;
  /** Usable battery capacity in kWh — the routing module's range budget. */
  batteryCapacityKwh?: number;
  /** Manufacturer-rated range at 100%, in km. */
  rangeKm?: number;
  connectorType?: ConnectorType;
}

export interface UserDocument extends Document<Types.ObjectId> {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  vehicle?: VehicleProfile;
  /** Stations this operator manages. Empty for drivers. */
  operatorOf: Types.ObjectId[];
  tokenVersion: number;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  comparePassword(plain: string): Promise<boolean>;
  toAuthUser(): AuthUser;
}

export interface UserModel extends Model<UserDocument> {
  findByEmailWithPassword(email: string): Promise<UserDocument | null>;
}

const vehicleSchema = new Schema<VehicleProfile>(
  {
    make: { type: String, trim: true, maxlength: 60 },
    model: { type: String, trim: true, maxlength: 60 },
    batteryCapacityKwh: { type: Number, min: 1, max: 400 },
    rangeKm: { type: Number, min: 1, max: 2000 },
    connectorType: { type: String, enum: CONNECTOR_TYPES },
  },
  { _id: false },
);

const userSchema = new Schema<UserDocument, UserModel>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email is not valid'],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // never leaves the database unless explicitly asked for
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'driver',
      index: true,
    },
    vehicle: { type: vehicleSchema, default: undefined },
    operatorOf: [{ type: Schema.Types.ObjectId, ref: 'Station', index: true }],
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

/**
 * Hash on the way in. Guarded by `isModified` so an unrelated `save()` (say,
 * updating `lastLoginAt`) does not re-hash an already-hashed value — a bug that
 * locks the user out of their own account.
 */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, env.BCRYPT_ROUNDS);
  return next();
});

userSchema.methods.comparePassword = function comparePassword(plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toAuthUser = function toAuthUser(): AuthUser {
  return {
    id: this._id.toString(),
    email: this.email,
    role: this.role,
    name: this.name,
    tokenVersion: this.tokenVersion,
  };
};

userSchema.statics.findByEmailWithPassword = function findByEmailWithPassword(email: string) {
  return this.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
};

export const User = model<UserDocument, UserModel>('User', userSchema);
export default User;
