/**
 * WattWay · Team Kothimbir 🌿
 * tokenStore.ts — where the JWT pair lives. localStorage when it works, memory
 * when it doesn't (private windows, blocked storage, the test runner), so the
 * rest of the app never has to care. Components subscribe to hear about
 * sign-ins and sign-outs, including the silent one when a refresh fails.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const KEY = 'wattway.auth';

let memory: Tokens | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function read(): Tokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    return typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string'
      ? { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
      : null;
  } catch {
    return null;
  }
}

function write(tokens: Tokens | null) {
  try {
    if (tokens) localStorage.setItem(KEY, JSON.stringify(tokens));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the in-memory copy still works for this tab */
  }
}

export const tokenStore = {
  get(): Tokens | null {
    if (!loaded) {
      memory = read();
      loaded = true;
    }
    return memory;
  },
  set(tokens: Tokens) {
    memory = tokens;
    loaded = true;
    write(tokens);
    listeners.forEach((fn) => fn());
  },
  clear() {
    memory = null;
    loaded = true;
    write(null);
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
