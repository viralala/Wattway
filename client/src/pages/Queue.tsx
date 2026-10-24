/**
 * WattWay · Team Kothimbir 🌿
 * Queue.tsx — join a station's virtual queue and watch your place in line.
 * The line is FIFO: newcomers join at the tail, the head gets the next free
 * port, and anyone can leave from the middle. Until the queue module is live
 * the page runs a clearly labelled simulation (one tick = one simulated minute).
 * Accepts ?station=<id>, which the station map and route planner link to.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, LinkButton, PageHead } from '../components/ui';
import { getQueueSnapshot } from '../services/queue';
import { SAMPLE_STATIONS } from '../services/stations';
import {
  canJoin,
  checkIn,
  clockLabel,
  estimateWait,
  HOLD_MIN,
  initSim,
  join,
  leave,
  tick,
  yourPosition,
  type SimState,
} from '../utils/queueSim';
import { formatWait } from '../utils/stations';
import '../styles/stations.css';
import '../styles/queue.css';

const SPEEDS = [1, 5, 20];
const DEFAULT_STATION = 'st-02';

function YouCard({ sim, onJoin, onLeave, onCheckIn }: { sim: SimState; onJoin: () => void; onLeave: () => void; onCheckIn: () => void }) {
  const pos = yourPosition(sim);
  const port = sim.ports.find((p) => p.index === sim.youPort);

  if (sim.you === 'waiting') {
    const wait = estimateWait(sim.ports, pos);
    const done = sim.youStartPos <= 1 ? 1 : (sim.youStartPos - pos) / (sim.youStartPos - 1);
    return (
      <section className="card q-you waiting" aria-live="polite">
        <p className="eyebrow-sm">you’re in line</p>
        <div className="q-big">
          <span className="q-big-num">#{pos}</span>
          <span className="q-big-sub">
            {pos === 1 ? 'You’re next' : `${pos - 1} ${pos === 2 ? 'car' : 'cars'} ahead of you`}
          </span>
        </div>
        <p>
          Estimated wait <strong>{formatWait(wait)}</strong>. We’ll hold a port for you for {HOLD_MIN} minutes when
          it’s your turn.
        </p>
        <div className="q-progress" role="progressbar" aria-label="Progress to the front" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}>
          <span style={{ width: `${Math.max(4, done * 100)}%` }} />
        </div>
        <div className="row">
          <Button variant="ghost" small onClick={onLeave}>
            Leave the queue
          </Button>
        </div>
      </section>
    );
  }

  if (sim.you === 'called' && port) {
    return (
      <section className="card q-you called" aria-live="assertive">
        <p className="eyebrow-sm">it’s your turn</p>
        <div className="q-big">
          <span className="q-big-num">P{port.index + 1}</span>
          <span className="q-big-sub">
            {port.connectorType} · {port.powerKw} kW, held for you
          </span>
        </div>
        <p>
          Check in within <strong>{port.minsLeft} min</strong> or the port goes to the next driver.
        </p>
        <div className="row">
          <Button onClick={onCheckIn}>I’ve plugged in</Button>
          <Button variant="ghost" small onClick={onLeave}>
            Give up my turn
          </Button>
        </div>
      </section>
    );
  }

  if (sim.you === 'charging' && port) {
    return (
      <section className="card q-you charging" aria-live="polite">
        <p className="eyebrow-sm">charging</p>
        <div className="q-big">
          <span className="q-big-num">{port.minsLeft}</span>
          <span className="q-big-sub">minutes left on P{port.index + 1}</span>
        </div>
        <p>Sit back. The next driver in line gets this port as soon as you unplug.</p>
      </section>
    );
  }

  const ahead = sim.line.length;
  const wait = estimateWait(sim.ports, ahead + 1);
  const message = {
    idle: null,
    done: 'All charged. Safe travels!',
    missed: 'You missed your check-in window, so the port went to the next driver.',
    left: 'You left the queue.',
  }[sim.you as 'idle' | 'done' | 'missed' | 'left'];

  return (
    <section className="card q-you idle" aria-live="polite">
      {message && <p className="q-msg">{message}</p>}
      <p className="eyebrow-sm">skip the physical line</p>
      <div className="q-big">
        <span className="q-big-num">#{ahead + 1}</span>
        <span className="q-big-sub">your place if you join now</span>
      </div>
      <p>
        {Number.isFinite(wait) ? (
          <>
            Estimated wait <strong>{formatWait(wait)}</strong> with {ahead} {ahead === 1 ? 'car' : 'cars'} ahead.
          </>
        ) : (
          'Every port here is faulted, so the queue is closed.'
        )}
      </p>
      <div className="row">
        <Button onClick={onJoin} disabled={!canJoin(sim)}>
          {sim.you === 'idle' ? 'Join the queue' : 'Join again'}
        </Button>
      </div>
    </section>
  );
}

export default function Queue() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('station');
  const stationId = SAMPLE_STATIONS.some((s) => s.id === requested) ? (requested as string) : DEFAULT_STATION;
  const station = SAMPLE_STATIONS.find((s) => s.id === stationId)!;

  const [sim, setSim] = useState<SimState | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let live = true;
    setSim(null);
    getQueueSnapshot(stationId).then((snap) => live && snap && setSim(initSim(snap.station)));
    return () => {
      live = false;
    };
  }, [stationId]);

  // The timer only restarts when play state, speed or loading changes, not on every tick.
  const loaded = sim !== null;
  useEffect(() => {
    if (!playing || !loaded) return undefined;
    const id = window.setInterval(() => setSim((s) => (s ? tick(s) : s)), 1000 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, loaded]);

  // At 20× the 10-minute hold would pass in half a second, so drop to 1× when it's your turn.
  const you = sim?.you;
  useEffect(() => {
    if (you === 'called') setSpeed(1);
  }, [you]);

  const update = (fn: (s: SimState) => SimState) => setSim((s) => (s ? fn(s) : s));
  const working = useMemo(() => station.ports.filter((p) => p.status !== 'faulted').length, [station]);

  return (
    <div className="container">
      <div className="band green">
        <PageHead eyebrow="join the line" title="Virtual queue">
          Join a station’s queue from wherever you are and watch your place move. The line is first come, first served:
          you join at the back, the front gets the next free port, and anyone can drop out without holding others up.
        </PageHead>

        <section className="card q-sim" aria-label="Simulation controls">
          <div className="q-sim-text">
            <span className="badge badge-bolt">Simulation</span>
            <p>
              No live queue is connected yet, so this replays a made-up morning: each tick is one simulated minute, and
              other drivers join, charge and give up at random.
            </p>
          </div>
          <div className="q-sim-controls">
            <span className="q-clock" aria-label="Simulated time">
              {sim ? clockLabel(sim.t) : '--:--'}
            </span>
            <Button small variant="secondary" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}>
              {playing ? 'Pause' : 'Play'}
            </Button>
            <Button small variant="ghost" onClick={() => update(tick)} disabled={playing}>
              +1 min
            </Button>
            <div className="q-speed" role="group" aria-label="Simulation speed">
              {SPEEDS.map((s) => (
                <button key={s} className="btn btn-ghost btn-sm" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </div>
            <Button small variant="ghost" onClick={() => setSim(initSim(station))}>
              Restart
            </Button>
          </div>
        </section>

        <div className="field q-station">
          <label htmlFor="q-station">Station</label>
          <select
            id="q-station"
            className="select"
            value={stationId}
            onChange={(e) => setParams({ station: e.target.value }, { replace: true })}
          >
            {SAMPLE_STATIONS.map((s) => {
              const offline = s.ports.every((p) => p.status === 'faulted');
              return (
                <option key={s.id} value={s.id} disabled={offline}>
                  {s.name}
                  {offline ? ' (offline)' : ''}
                </option>
              );
            })}
          </select>
          <small className="muted">
            {station.address.locality} · ₹{station.pricePerKwh}/kWh · {working} working{' '}
            {working === 1 ? 'port' : 'ports'} ·{' '}
            <Link to={`/stations?station=${station.id}`}>see it on the map</Link>
          </small>
        </div>
      </div>

      <div className="band cream">
        {sim === null ? (
          <p className="muted">Loading the queue…</p>
        ) : (
          <div className="q-layout">
            <div className="q-col">
              <YouCard sim={sim} onJoin={() => update(join)} onLeave={() => update(leave)} onCheckIn={() => update(checkIn)} />

              <section className="card" aria-labelledby="q-log-title">
                <h3 id="q-log-title">What just happened</h3>
                <ol className="q-log" aria-live="polite" aria-relevant="additions">
                  {sim.log.slice(0, 10).map((e) => (
                    <li key={e.id} className={e.mine ? 'mine' : undefined}>
                      <span className="q-log-time">{clockLabel(e.t)}</span>
                      <span>
                        {e.text}
                        {e.op && <code className="q-op">{e.op}</code>}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <div className="q-col">
              <section className="card" aria-labelledby="q-line-title">
                <div className="q-head">
                  <h3 id="q-line-title">The line</h3>
                  <span className="muted">
                    {sim.line.length} waiting
                  </span>
                </div>
                {sim.line.length === 0 ? (
                  <p className="muted q-empty">Nobody’s waiting. Join now and you go straight to a free port.</p>
                ) : (
                  <ol className="q-line">
                    {sim.line.map((d, i) => (
                      <li key={d.id} className={`q-node${d.you ? ' you' : ''}`}>
                        <span className="q-node-pos">#{i + 1}</span>
                        <span className="q-node-plate">{d.plate}</span>
                        <span className="q-node-tag">
                          {i === 0 ? 'head · next to charge' : i === sim.line.length - 1 ? 'tail' : ' '}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="muted q-note">
                  The server keeps this line as a doubly linked list: joining appends at the tail and the next driver
                  comes off the head, both O(1), and someone leaving from the middle is unlinked in O(1) once found.
                </p>
              </section>

              <section className="card" aria-labelledby="q-ports-title">
                <h3 id="q-ports-title">Ports</h3>
                <ol className="st-port-grid q-ports">
                  {sim.ports.map((p) => (
                    <li key={p.index} className={`st-port ${p.held ? 'held' : p.status}${p.driver?.you ? ' you' : ''}`}>
                      <span className="st-port-num">P{p.index + 1}</span>
                      <span className="st-port-type">
                        {p.connectorType} · {p.powerKw} kW
                      </span>
                      {p.status === 'occupied' && (
                        <span className="q-port-who">{p.driver?.you ? 'You' : p.driver?.plate}</span>
                      )}
                      <span className="st-port-status">
                        {p.status === 'faulted'
                          ? 'Faulted'
                          : p.status === 'free'
                            ? 'Free'
                            : p.held
                              ? `Held · ${p.minsLeft} min to check in`
                              : `${p.minsLeft} min left`}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <div className="row">
                <LinkButton to={`/route?to=${station.id}`} variant="secondary" small>
                  Plan a route here
                </LinkButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
