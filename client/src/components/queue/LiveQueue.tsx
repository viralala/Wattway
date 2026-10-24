/**
 * WattWay · Team Kothimbir 🌿
 * LiveQueue.tsx — a station's real queue from the API. Refreshes every ~10 s
 * while the tab is visible (no sockets on the Vercel deployment), and lets a
 * signed-in driver join or leave.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isUnreachable } from '../../services/api';
import { fetchLiveQueue, joinQueue, leaveQueue, type LiveQueue as Queue } from '../../services/queue';
import type { Station } from '../../services/stations';
import { formatWait } from '../../utils/stations';
import { Button } from '../ui';

export const POLL_MS = 10_000;

function YouCard({ q }: { q: Queue }) {
  const you = q.you;
  if (you?.status === 'charging') {
    const row = q.charging.find((c) => c.you);
    return (
      <>
        <p className="eyebrow-sm">charging</p>
        <div className="q-big">
          <span className="q-big-num">P{(you.portIndex ?? row?.portIndex ?? 0) + 1}</span>
          <span className="q-big-sub">{row ? `about ${row.expectedRemainingMinutes} min left` : 'you’re plugged in'}</span>
        </div>
        <p>The next driver in line gets this port as soon as you leave.</p>
      </>
    );
  }
  if (you?.status === 'waiting') {
    const pos = you.position ?? 1;
    return (
      <>
        <p className="eyebrow-sm">you’re in line</p>
        <div className="q-big">
          <span className="q-big-num">#{pos}</span>
          <span className="q-big-sub">
            {pos === 1 ? 'You’re next' : `${pos - 1} ${pos === 2 ? 'car' : 'cars'} ahead of you`}
            {you.urgent ? ' · priority' : ''}
          </span>
        </div>
        <p>
          Estimated wait{' '}
          <strong>{you.estimatedWaitMinutes == null ? 'unknown' : formatWait(you.estimatedWaitMinutes)}</strong>.
        </p>
      </>
    );
  }
  return null;
}

export function LiveQueue({ station, onUnreachable }: { station: Station; onUnreachable: () => void }) {
  const { user } = useAuth();
  const location = useLocation();
  const [q, setQ] = useState<Queue | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [battery, setBattery] = useState('');
  const [emergency, setEmergency] = useState(false);
  const stationId = station.id;
  const userId = user?.id;

  const refresh = useCallback(async () => {
    try {
      setQ(await fetchLiveQueue(stationId));
      setError('');
    } catch (e) {
      if (isUnreachable(e)) onUnreachable();
      else setError(e instanceof Error ? e.message : 'Couldn’t load the queue.');
    }
  }, [stationId, onUnreachable]);

  // Poll while the tab is visible; catch up the moment it becomes visible again.
  useEffect(() => {
    setQ(null);
    void refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
    // userId: signing in or out changes what "you" means in the snapshot.
  }, [refresh, userId]);

  const act = async (fn: () => Promise<Queue>) => {
    setBusy(true);
    setError('');
    try {
      setQ(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = () => {
    const pct = battery.trim() === '' ? undefined : Number(battery);
    void act(() =>
      joinQueue(stationId, {
        ...(pct !== undefined && Number.isFinite(pct) ? { batteryPct: Math.min(100, Math.max(0, pct)) } : {}),
        ...(emergency ? { emergency: true } : {}),
      }),
    );
  };

  if (q === null) return <p className="muted">{error || 'Loading the queue…'}</p>;

  const inLine = q.you !== null;
  const closed = q.usablePorts === 0;

  return (
    <div className="q-layout">
      <div className="q-col">
        <section className={`card q-you ${q.you?.status ?? 'idle'}`} aria-live="polite">
          {inLine ? (
            <YouCard q={q} />
          ) : (
            <>
              <p className="eyebrow-sm">skip the physical line</p>
              <div className="q-big">
                <span className="q-big-num">#{q.queueLength + 1}</span>
                <span className="q-big-sub">your place if you join now</span>
              </div>
              <p>
                {closed
                  ? 'Every port here is faulted, so the queue is closed.'
                  : q.freePorts > 0 && q.queueLength === 0
                    ? 'A port is free: join and it’s yours straight away.'
                    : `${q.queueLength} ${q.queueLength === 1 ? 'car' : 'cars'} waiting for ${q.usablePorts} working ${q.usablePorts === 1 ? 'port' : 'ports'}.`}
              </p>
              {user && !closed && (
                <div className="q-join-opts">
                  <div className="field">
                    <label htmlFor="q-battery">Battery now (optional)</label>
                    <input
                      id="q-battery"
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      inputMode="numeric"
                      placeholder="%"
                      value={battery}
                      onChange={(e) => setBattery(e.target.value)}
                    />
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
                    Emergency vehicle
                  </label>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}

          <div className="row">
            {inLine ? (
              <Button variant="ghost" small disabled={busy} onClick={() => void act(() => leaveQueue(stationId))}>
                {q.you?.status === 'charging' ? 'Finish charging' : 'Leave the queue'}
              </Button>
            ) : user ? (
              <Button disabled={busy || closed} onClick={onJoin}>
                Join the queue
              </Button>
            ) : (
              <Link className="btn btn-primary" to="/account" state={{ from: location.pathname + location.search }}>
                Sign in to join
              </Link>
            )}
          </div>
        </section>

        <section className="card">
          <h3>Ports</h3>
          <p className="muted">
            {q.freePorts} of {q.totalPorts} free · {q.usablePorts} working
          </p>
          {q.charging.length > 0 && (
            <ul className="q-charging">
              {q.charging.map((c) => (
                <li key={c.portIndex}>
                  P{c.portIndex + 1}: {c.you ? 'you' : 'in use'} · about {c.expectedRemainingMinutes} min left
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="q-col">
        <section className="card" aria-labelledby="q-line-title">
          <div className="q-head">
            <h3 id="q-line-title">The line</h3>
            <span className="muted">{q.waiting.length} waiting</span>
          </div>
          {q.waiting.length === 0 ? (
            <p className="muted q-empty">Nobody’s waiting. Join now and you go straight to a free port.</p>
          ) : (
            <ol className="q-line">
              {q.waiting.map((w, i) => (
                <li key={w.position} className={`q-node${w.you ? ' you' : ''}`}>
                  <span className="q-node-pos">#{w.position}</span>
                  <span className="q-node-plate">{w.you ? 'You' : w.urgent ? 'Priority driver' : 'Driver'}</span>
                  <span className="q-node-tag">
                    {i === 0 ? 'head · next to charge' : i === q.waiting.length - 1 ? 'tail' : ' '}
                    {w.estimatedWaitMinutes != null ? ` · ${formatWait(w.estimatedWaitMinutes)}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {q.middle && (
            <p className="muted q-note">
              Half the line is served in about {q.middle.estimatedWaitMinutes == null ? '—' : formatWait(q.middle.estimatedWaitMinutes)}.
            </p>
          )}
          <p className="muted q-note">
            Live from the server, refreshed every {POLL_MS / 1000} seconds. Updated {new Date(q.updatedAt).toLocaleTimeString()}.
          </p>
        </section>
      </div>
    </div>
  );
}
