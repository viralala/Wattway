/**
 * WattWay · Team Kothimbir 🌿
 * AuthContext.tsx — who is signed in, for every page. Restores the session
 * from stored tokens on load and signs out if a refresh fails.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as auth from '../services/auth';
import { ApiRequestError } from '../services/api';
import { tokenStore } from '../services/tokenStore';

interface AuthState {
  user: auth.AuthUser | null;
  /** 'loading' only while a stored session is being checked. */
  status: 'loading' | 'ready';
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: auth.RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<auth.AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>(tokenStore.get() ? 'loading' : 'ready');

  useEffect(() => {
    let live = true;
    auth
      .fetchMe()
      .then((u) => live && setUser(u))
      .catch((error) => {
        if (live && error instanceof ApiRequestError && error.status === 401) tokenStore.clear();
      })
      .finally(() => live && setStatus('ready'));
    // A failed refresh clears the tokens behind our back: follow it.
    const off = tokenStore.subscribe(() => {
      if (!tokenStore.get()) setUser(null);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => setUser(await auth.login(email, password)), []);
  const signUp = useCallback(async (input: auth.RegisterInput) => setUser(await auth.register(input)), []);
  const signOut = useCallback(async () => {
    await auth.logout();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, status, signIn, signUp, signOut }), [user, status, signIn, signUp, signOut]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(Context);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
