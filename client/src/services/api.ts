/**
 * WattWay · Team Kothimbir 🌿
 * api.ts — the one place the client branches on the backend's response
 * envelope: `{ success: true, data }` or `{ success: false, error }`.
 *
 * Also the one place that attaches the bearer token and, on a 401, refreshes
 * the pair once and replays the request.
 */
import { tokenStore } from './tokenStore';

const BASE: string = import.meta.env.VITE_API_URL ?? '';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * True when the API itself can't be used (no network, a 5xx, or a reply that
 * isn't the WattWay envelope at all, e.g. a host that answers /api with HTML).
 * Callers use this to decide whether to fall back to sample data.
 */
export function isUnreachable(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && (error.code === 'NETWORK' || error.code === 'UNKNOWN' || error.status >= 500)
  );
}

const NO_REFRESH = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'];

let refreshing: Promise<boolean> | null = null;

/** Swap the refresh token for a new pair. One call at a time, shared by every waiter. */
function refreshTokens(): Promise<boolean> {
  const current = tokenStore.get();
  if (!current) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const response = await fetch(`${BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        const body = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: { accessToken?: string; refreshToken?: string };
        } | null;
        if (response.ok && body?.success && body.data?.accessToken) {
          tokenStore.set({
            accessToken: body.data.accessToken,
            refreshToken: body.data.refreshToken ?? current.refreshToken,
          });
          return true;
        }
        // The server said no: the session is over. A network blip keeps the tokens.
        if (response.status === 401 || response.status === 403) tokenStore.clear();
        return false;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const token = tokenStore.get()?.accessToken;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) };
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(
      'Can’t reach the WattWay server. Start it with “npm run dev:lab” (no database needed) in the server folder.',
      'NETWORK',
    );
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await send(path, init);

  if (response.status === 401 && tokenStore.get() && !NO_REFRESH.includes(path)) {
    if (await refreshTokens()) response = await send(path, init);
  }

  const body = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: { code: string; message: string } }
    | null;

  if (!body || body.success !== true) {
    const err = body && body.success === false ? body.error : null;
    throw new ApiRequestError(err?.message ?? `Request failed (${response.status})`, err?.code ?? 'UNKNOWN', response.status);
  }
  return body.data;
}

/** JSON body helper: `request('/api/x', json('POST', { a: 1 }))`. */
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
