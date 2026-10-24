/**
 * WattWay · Team Kothimbir 🌿
 * Dashboard.tsx — the operator's view: who is charging, who is waiting, how
 * long each port has been busy, today's occupancy, where to redirect drivers
 * when a station is full, and the Floyd–Warshall distance table behind that.
 */
import { useEffect, useMemo, useState } from 'react';
import { DayChart } from '../components/dashboard/DayChart';
import { DistanceMatrix } from '../components/dashboard/DistanceMatrix';
import { OfflineNotice } from '../components/OfflineNotice';
import { Button, PageHead } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useStations } from '../hooks/useStations';
import { canManageStations } from '../services/auth';
import {
  getDayStats,
  getDistanceTable,
  getOperatorSnapshot,
  listOperators,
  removeFromQueue,
  resetDemo,
  setPortStatus,
  type HourStat,
  type OpPort,
  type OpStation,
  type PortAction,
} from '../services/dashboard';
import { pathBetween, type AllPairs, type Edge } from '../utils/floyd';
import { Link } from 'react-router-dom';
import type { Station } from '../services/stations';
import '../styles/stations.css';
import '../styles/dashboard.css';

/** Sessions longer than this get flagged. */
const LONG_SESSION_MIN = 45;

const ACTION: Record<OpPort['status'], { action: PortAction; label: string }> = {
  free: { action: 'fault', label: 'Mark faulted' },
  faulted: { action: 'restore', label: 'Back in service' },
  occupied: { action: 'end', label: 'End session' },
};

function StationPanel({
  op,
  onPort,
  onRemove,
}: {
  op: OpStation;
  onPort: (index: number, action: PortAction) => void;
  onRemove: (plate: string) => void;
}) {
  const { station, ports, waiting } = op;
  const working = ports.filter((p) => p.status !== 'faulted').length;
  const busy = ports.filter((p) => p.status === 'occupied').length;
  const pct = working === 0 ? 0 : Math.round((busy / working) * 100);

  return (
    <article className="card db-station" aria-labelledby={`db-${station.id}`}>
      <div className="db-station-top">
        <h3 id={`db-${station.id}`}>{station.name}</h3>
        {working === 0 ? (
          <span className="badge badge-bad">Offline</span>
        ) : busy === working ? (
          <span className="badge badge-warn">Full</span>
        ) : (
          <span className="badge badge-ok">{working - busy} free</span>
        )}
      </div>
      <div className="db-occ" aria-label={`${pct}% of working ports in use`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="muted db-occ-text">
        {busy}/{working} working ports in use · {waiting.length} waiting
      </p>

      <ul className="db-ports">
        {ports.map((p) => {
          const long = p.occupiedMin !== null && p.occupiedMin > LONG_SESSION_MIN;
          return (
            <li key={p.index} className={`db-port ${p.status}`}>
              <span className="db-port-main">
                <span className="db-port-id">
                  P{p.index + 1}
                  <small>
                    {p.connectorType} · {p.powerKw} kW
                  </small>
                </span>
                <span className="db-port-who">
                  {p.status === 'occupied' ? (
                    <>
                      <span className="mono">{p.plate}</span>
                      <small className={long ? 'db-long' : undefined}>
                        {p.occupiedMin} min{long ? ' · long session' : ''}
                      </small>
                    </>
                  ) : (
                    <span className="db-port-state">{p.status === 'free' ? 'Free' : 'Faulted'}</span>
                  )}
                </span>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => onPort(p.index, ACTION[p.status].action)}>
                {ACTION[p.status].label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="db-waiting">
        <h4>Waiting ({waiting.length})</h4>
        {waiting.length === 0 ? (
          <p className="muted">Nobody in line.</p>
        ) : (
          <ol>
            {waiting.map((w, i) => (
              <li key={w.plate}>
                <span>
                  {i + 1}. <span className="mono">{w.plate}</span> <small className="muted">· {w.waitingMin} min</small>
                </span>
                {!op.live && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onRemove(w.plate)}
                    aria-label={`Remove ${w.plate} from the line`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}

interface Suggestion {
  from: Station;
  to: Station;
  km: number;
  hops: number;
}

/**
 * For each of this operator's full stations with a line, the nearest station
 * (by Floyd–Warshall road distance) that has a free port right now.
 */
function suggestions(ops: OpStation[], table: AllPairs & { stations: Station[] }): Suggestion[] {
  const live = new Map<string, Station>(table.stations.map((s) => [s.id, s]));
  for (const op of ops) live.set(op.station.id, op.station);
  const out: Suggestion[] = [];
  for (const op of ops) {
    if (op.station.freePorts > 0 || op.waiting.length === 0) continue;
    const i = table.ids.indexOf(op.station.id);
    let best: Suggestion | null = null;
    if (i < 0) continue;
    for (let j = 0; j < table.ids.length; j += 1) {
      const s = live.get(table.ids[j]) as Station;
      if (j === i || s.freePorts === 0 || !Number.isFinite(table.dist[i][j])) continue;
      const km = table.dist[i][j];
      if (!best || km < best.km) best = { from: op.station, to: s, km, hops: pathBetween(table, i, j).length - 2 };
    }
    if (best) out.push(best);
  }
  return out;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { stations, offline } = useStations();
  const [operators, setOperators] = useState<string[]>([]);
  const [operator, setOperator] = useState('');
  const [ops, setOps] = useState<OpStation[] | null>(null);
  const [stats, setStats] = useState<HourStat[]>([]);
  const [table, setTable] = useState<(AllPairs & { stations: Station[]; links: Edge[] }) | null>(null);
  const [message, setMessage] = useState('');
  const remote = !offline && canManageStations(user);

  useEffect(() => {
    if (stations === null) return;
    listOperators().then(({ operators: list }) => {
      setOperators(list);
      // Pick the signed-in operator's own company when we can tell, else the first.
      setOperator((cur) => (cur && list.includes(cur) ? cur : (list.includes('AmpYard') ? 'AmpYard' : list[0] ?? '')));
    });
    getDistanceTable().then(setTable);
  }, [stations]);

  useEffect(() => {
    if (!operator) return undefined;
    let live = true;
    setMessage('');
    getOperatorSnapshot(operator)
      .then(async (o) => {
        const s = await getDayStats(operator, o);
        if (!live) return;
        setOps(o);
        setStats(s);
      })
      .catch((e: Error) => live && setMessage(e.message));
    return () => {
      live = false;
    };
  }, [operator]);

  const replace = (next: OpStation) => setOps((cur) => cur?.map((o) => (o.station.id === next.station.id ? next : o)) ?? cur);

  const onPort = async (op: OpStation, index: number, action: PortAction) => {
    const before = op.waiting[0]?.plate;
    let next: OpStation;
    try {
      next = await setPortStatus(op.station.id, index, action, remote);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That change didn’t go through.');
      return;
    }
    replace(next);
    const port = next.ports[index];
    const verb = { fault: 'marked faulted', restore: 'back in service', end: 'session ended' }[action];
    const handedOn = port.status === 'occupied' && port.plate === before ? ` ${before} came off the front of the line and took it.` : '';
    const local = op.live && !remote ? ' (this session only: sign in as an operator to save it)' : '';
    setMessage(`P${index + 1} at ${op.station.name}: ${verb}.${handedOn}${local}`);
  };

  const onRemove = async (op: OpStation, plate: string) => {
    replace(await removeFromQueue(op.station.id, plate));
    setMessage(`${plate} removed from the line at ${op.station.name}.`);
  };

  const onReset = async () => {
    resetDemo();
    setOps(await getOperatorSnapshot(operator));
    setMessage('Demo data reset.');
  };

  const kpi = useMemo(() => {
    if (!ops) return null;
    const ports = ops.flatMap((o) => o.ports.map((p) => ({ ...p, station: o.station.name })));
    const working = ports.filter((p) => p.status !== 'faulted');
    const busy = ports.filter((p) => p.status === 'occupied');
    const longest = busy.reduce<(typeof busy)[number] | null>((a, b) => (!a || (b.occupiedMin ?? 0) > (a.occupiedMin ?? 0) ? b : a), null);
    return {
      busy: busy.length,
      working: working.length,
      pct: working.length ? Math.round((busy.length / working.length) * 100) : 0,
      waiting: ops.reduce((n, o) => n + o.waiting.length, 0),
      faulted: ports.length - working.length,
      longest,
    };
  }, [ops]);

  const tips = useMemo(() => (ops && table ? suggestions(ops, table) : []), [ops, table]);
  const mine = useMemo(() => new Set((stations ?? []).filter((s) => s.operator === operator).map((s) => s.id)), [stations, operator]);

  return (
    <div className="container page-operators">
      <div className="band green">
        <PageHead eyebrow="for station operators" title="Operator dashboard">
          See who is charging, who is waiting and how long each port has been busy. Take a faulty port out of service,
          end an overstaying session, clear no-shows from the line, and find the nearest station to send drivers to.
        </PageHead>

        {offline ? (
          <OfflineNotice />
        ) : (
          <p className="notice st-sample" role="note">
            {remote ? (
              <>Signed in as {user?.name} ({user?.role}): port changes are saved to the live API for stations you manage.</>
            ) : (
              <>
                Read-only live view. <Link to="/account" state={{ from: '/dashboard' }}>Sign in as an operator</Link> to
                change ports; until then edits last only for this session. Removing drivers from a line isn’t available
                yet.
              </>
            )}
          </p>
        )}

        <div className="db-toolbar">
          <div className="field">
            <label htmlFor="db-operator">Operator</label>
            <select id="db-operator" className="select" value={operator} onChange={(e) => setOperator(e.target.value)}>
              {operators.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <Button variant="ghost" small onClick={onReset}>
            Reset demo data
          </Button>
        </div>

        <p className="db-message" role="status" aria-live="polite">
          {message}
        </p>
      </div>

      <div className="band cream">
        {kpi && (
          <section className="db-kpis" aria-label="Right now">
            <div className="card db-kpi">
              <span className="db-kpi-label">Ports in use</span>
              <span className="db-kpi-value">{kpi.pct}%</span>
              <span className="muted">
                {kpi.busy} of {kpi.working} working ports
              </span>
            </div>
            <div className="card db-kpi">
              <span className="db-kpi-label">Cars waiting</span>
              <span className="db-kpi-value">{kpi.waiting}</span>
              <span className="muted">across {ops?.length} stations</span>
            </div>
            <div className="card db-kpi">
              <span className="db-kpi-label">Longest session</span>
              <span className={`db-kpi-value${(kpi.longest?.occupiedMin ?? 0) > LONG_SESSION_MIN ? ' warn' : ''}`}>
                {kpi.longest ? `${kpi.longest.occupiedMin} min` : '—'}
              </span>
              <span className="muted">{kpi.longest ? `${kpi.longest.plate} at ${kpi.longest.station}` : 'No one charging'}</span>
            </div>
            <div className="card db-kpi">
              <span className="db-kpi-label">Faulted ports</span>
              <span className={`db-kpi-value${kpi.faulted > 0 ? ' bad' : ''}`}>{kpi.faulted}</span>
              <span className="muted">{kpi.faulted ? 'need a technician' : 'all ports working'}</span>
            </div>
          </section>
        )}

        <div className="db-row">
          <section className="card" aria-labelledby="db-today">
            <h3 id="db-today">Today, hour by hour</h3>
            <p className="muted db-sub">A typical-day curve scaled to {operator}’s current load (no history endpoint yet).</p>
            <DayChart stats={stats} />
          </section>

          <section className="card" aria-labelledby="db-redirect">
            <h3 id="db-redirect">Where to send waiting drivers</h3>
            <p className="muted db-sub">Nearest station with a free port, by shortest road distance from the table below.</p>
            {tips.length === 0 ? (
              <p className="db-ok">None of your stations is full with a line right now.</p>
            ) : (
              <ul className="db-tips">
                {tips.map((t) => (
                  <li key={t.from.id}>
                    <strong>{t.from.name}</strong> is full. Nearest free port: <strong>{t.to.name}</strong>,{' '}
                    {t.km.toFixed(1)} km away{t.hops > 0 ? ` (via ${t.hops} ${t.hops === 1 ? 'station' : 'stations'})` : ''}
                    {t.to.operator !== operator && <span className="muted"> · run by {t.to.operator}</span>}.
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="band green">
        <section className="db-section" aria-labelledby="db-stations">
          <h2 id="db-stations">Your stations</h2>
          {ops === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="db-stations">
              {ops.map((op) => (
                <StationPanel
                  key={op.station.id}
                  op={op}
                  onPort={(i, a) => onPort(op, i, a)}
                  onRemove={(plate) => onRemove(op, plate)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="band cream">
        <section className="db-section card" aria-labelledby="db-fw-title">
          <h2 id="db-fw-title">Road distance between every pair of stations</h2>
          <p className="db-fw-intro">
            Floyd–Warshall over {table ? table.links.length : '…'} estimated road links between {table ? table.stations.length : '…'} stations. It tries every
            station k as a stopover for every pair (i, j), so it runs V³ ={' '}
            {table ? table.relaxations.toLocaleString('en-IN') : '…'} steps once and then answers any pair instantly.
            Your stations are highlighted; darker cells are farther apart.
          </p>
          {table && <DistanceMatrix table={table} highlight={mine} />}
        </section>
      </div>
    </div>
  );
}
