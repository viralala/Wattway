/**
 * WattWay · Team Kothimbir 🌿
 * Account.tsx — sign in or create an account. Pages that need a login (the
 * queue, the operator dashboard) link here with the page to come back to in
 * router state.
 */
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, PageHead } from '../components/ui';
import '../styles/account.css';

export default function Account() {
  const { user, status, signIn, signUp, signOut } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';

  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'driver' | 'operator'>('driver');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signin') await signIn(email, password);
      else await signUp({ name, email, password, role });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="container">
        <p className="muted">Checking your session…</p>
      </div>
    );
  }

  if (user) {
    return (
      <div className="container">
        <div className="band green">
          <PageHead eyebrow="your account" title={`Hi, ${user.name || user.email}`}>
            You’re signed in as {user.email} ({user.role}).
          </PageHead>
          <div className="row">
            <Button variant="secondary" onClick={() => navigate(from === '/account' ? '/' : from)}>
              Continue
            </Button>
            <Button variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="band green">
        <PageHead eyebrow="your account" title={mode === 'signin' ? 'Sign in' : 'Create an account'}>
          An account lets you join charging queues and, for station operators, manage ports.
        </PageHead>

        <form className="card ac-form" onSubmit={submit} aria-label={mode === 'signin' ? 'Sign in' : 'Register'}>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="ac-name">Name</label>
              <input id="ac-name" className="input" required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="ac-email">Email</label>
            <input id="ac-email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ac-password">Password</label>
            <input
              id="ac-password"
              className="input"
              type="password"
              required
              minLength={mode === 'register' ? 8 : 1}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'register' && <small className="muted">At least 8 characters, with a letter and a digit.</small>}
          </div>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="ac-role">I am a</label>
              <select id="ac-role" className="select" value={role} onChange={(e) => setRole(e.target.value as 'driver' | 'operator')}>
                <option value="driver">Driver</option>
                <option value="operator">Station operator</option>
              </select>
            </div>
          )}

          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}

          <div className="row">
            <Button type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode(mode === 'signin' ? 'register' : 'signin');
                setError('');
              }}
            >
              {mode === 'signin' ? 'New here? Register' : 'Have an account? Sign in'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
