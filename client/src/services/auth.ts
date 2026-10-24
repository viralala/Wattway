/**
 * WattWay · Team Kothimbir 🌿
 * auth.ts — sign in, register, who am I. Tokens go to tokenStore; api.ts
 * attaches them to every request and refreshes on a 401.
 */
import { json, request } from './api';
import { tokenStore } from './tokenStore';

export type Role = 'driver' | 'operator' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role?: 'driver' | 'operator';
}

interface AuthReply {
  user: unknown;
  accessToken: string;
  refreshToken: string;
}

/** Reduce the server's user document to the fields the UI uses. */
export function normaliseUser(raw: unknown): AuthUser {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const role = r.role === 'operator' || r.role === 'admin' ? r.role : 'driver';
  return {
    id: String(r.id ?? r._id ?? ''),
    name: typeof r.name === 'string' ? r.name : '',
    email: typeof r.email === 'string' ? r.email : '',
    role,
  };
}

/** Operators and admins can change port status. */
export const canManageStations = (user: AuthUser | null) => user?.role === 'operator' || user?.role === 'admin';

function accept(reply: AuthReply): AuthUser {
  tokenStore.set({ accessToken: reply.accessToken, refreshToken: reply.refreshToken });
  return normaliseUser(reply.user);
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  return accept(await request<AuthReply>('/api/auth/register', json('POST', input)));
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return accept(await request<AuthReply>('/api/auth/login', json('POST', { email, password })));
}

/** The signed-in user, or null when there are no tokens or they no longer work. */
export async function fetchMe(): Promise<AuthUser | null> {
  if (!tokenStore.get()) return null;
  const data = await request<{ user: unknown }>('/api/auth/me');
  return normaliseUser(data.user);
}

export async function logout(): Promise<void> {
  try {
    if (tokenStore.get()) await request('/api/auth/logout', json('POST'));
  } catch {
    /* signing out locally is what matters */
  }
  tokenStore.clear();
}
