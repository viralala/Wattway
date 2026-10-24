/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Indexing & Backend
 * ============================================================================
 *
 *  User.ts — the `users` table. Drivers, operators and admins.
 *
 *  The password hash is only ever loaded by `findByEmailWithPassword` /
 *  `passwordHashOf`; every other read leaves it in the database, and
 *  `userJSON` would drop it anyway.
 * ============================================================================
 */

import bcrypt from 'bcryptjs';
import { db } from '../config/db';
import { env } from '../config/env';
import type { AuthUser, ConnectorType, UserRole } from '../types';

export interface VehicleProfile {
  make?: string;
  model?: string;
  /** Usable battery capacity in kWh — the routing module's range budget. */
  batteryCapacityKwh?: number;
  /** Manufacturer-rated range at 100%, in km. */
  rangeKm?: number;
  connectorType?: ConnectorType;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  vehicle?: VehicleProfile;
  /** Stations this operator manages. Empty for drivers. */
  operatorOf: string[];
  tokenVersion: number;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  vehicle: VehicleProfile | null;
  token_version: number;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  operator_of: string[] | null;
  password_hash?: string;
}

const COLUMNS = `u.id, u.name, u.email, u.role, u.vehicle, u.token_version, u.last_login_at, u.created_at, u.updated_at,
  coalesce((select array_agg(so.station_id) from station_operators so where so.user_id = u.id), '{}') as operator_of`;

function fromRow(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: String(row.email),
    role: row.role,
    ...(row.vehicle ? { vehicle: row.vehicle } : {}),
    operatorOf: row.operator_of ?? [],
    tokenVersion: Number(row.token_version),
    ...(row.last_login_at ? { lastLoginAt: new Date(row.last_login_at) } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export const normaliseEmail = (email: string): string => email.toLowerCase().trim();

export function toAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email, role: user.role, name: user.name, tokenVersion: user.tokenVersion };
}

/** The API shape of a user. Never includes the password hash. */
export function userJSON(user: User): User {
  return { ...user };
}

export const comparePassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

export const Users = {
  async findById(id: string): Promise<User | null> {
    const { rows } = await db.query<UserRow>(`select ${COLUMNS} from users u where u.id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await db.query<UserRow>(`select ${COLUMNS} from users u where u.email = $1`, [normaliseEmail(email)]);
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async findByEmailWithPassword(email: string): Promise<(User & { passwordHash: string }) | null> {
    const { rows } = await db.query<UserRow>(`select ${COLUMNS}, u.password_hash from users u where u.email = $1`, [
      normaliseEmail(email),
    ]);
    return rows[0] ? { ...fromRow(rows[0]), passwordHash: rows[0].password_hash as string } : null;
  },

  async passwordHashOf(id: string): Promise<string | null> {
    const { rows } = await db.query<{ password_hash: string }>('select password_hash from users where id = $1', [id]);
    return rows[0]?.password_hash ?? null;
  },

  /** Create a user, hashing the plain password. */
  async create(input: { name: string; email: string; password: string; role?: UserRole; vehicle?: VehicleProfile }): Promise<User> {
    const hash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    const { rows } = await db.query<{ id: string }>(
      `insert into users (name, email, password_hash, role, vehicle) values ($1, $2, $3, $4, $5) returning id`,
      [input.name.trim(), normaliseEmail(input.email), hash, input.role ?? 'driver', input.vehicle ? JSON.stringify(input.vehicle) : null],
    );
    return (await Users.findById(rows[0].id)) as User;
  },

  async update(
    id: string,
    changes: { name?: string; vehicle?: VehicleProfile | null; lastLoginAt?: Date },
  ): Promise<User | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (changes.name !== undefined) sets.push(`name = $${params.push(changes.name.trim())}`);
    if (changes.vehicle !== undefined) sets.push(`vehicle = $${params.push(changes.vehicle ? JSON.stringify(changes.vehicle) : null)}`);
    if (changes.lastLoginAt !== undefined) sets.push(`last_login_at = $${params.push(changes.lastLoginAt)}`);
    if (sets.length) await db.query(`update users set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
    return Users.findById(id);
  },

  async setPassword(id: string, password: string): Promise<User | null> {
    const hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    // A new password invalidates every refresh token issued before it.
    await db.query(
      'update users set password_hash = $2, token_version = token_version + 1, updated_at = now() where id = $1',
      [id, hash],
    );
    return Users.findById(id);
  },

  async bumpTokenVersion(id: string): Promise<void> {
    await db.query('update users set token_version = token_version + 1, updated_at = now() where id = $1', [id]);
  },

  async addOperatorOf(userId: string, stationId: string): Promise<void> {
    await db.query(
      'insert into station_operators (user_id, station_id) values ($1, $2) on conflict do nothing',
      [userId, stationId],
    );
  },
};

export default Users;
