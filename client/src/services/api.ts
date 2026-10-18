/**
 * WattWay · Team Kothimbir 🌿
 * api.ts — the one place the client branches on the backend's response
 * envelope: `{ success: true, data }` or `{ success: false, error }`.
 */

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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(
      'Can’t reach the WattWay server. Start it with “npm run dev:lab” (no database needed) in the server folder.',
      'NETWORK',
    );
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
