/**
 * WattWay · Team Kothimbir 🌿
 * Stations.tsx — the station map: filter by connector, price and free ports,
 * see each station's queue, and open its port board. The selected station
 * lives in the URL (?station=st-04) so other pages can link straight to it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StationMap } from '../components/stations/StationMap';
import { LinkButton, PageHead, Slider } from '../components/ui';
import { HOME, listStations, type ConnectorType, type Port, type Station } from '../services/stations';
import { filterStations, formatWait, type SortKey, type StationFilters, type StationView } from '../utils/stations';
import '../styles/stations.css';

const DEFAULT_FILTERS: StationFilters = { text: '', connector: 'any', maxPrice: 25, freeOnly: false, sort: 'nearest' };

const SORT_LABELS: Record<SortKey, string> = {
  nearest: 'Nearest first',
  cheapest: 'Cheapest first',
  rating: 'Best rated',
  queue: 'Shortest wait',
};

const BADGE = {
  available: { cls: 'badge-ok', text: 'Free now' },
  full: { cls: 'badge-warn', text: 'All busy' },
  offline: { cls: 'badge-bad', text: 'Offline' },
} as const;

function StatusBadge({ s }: { s: StationView }) {
  const b = BADGE[s.availability];
  return <span className={`badge ${b.cls}`}>{b.text}</span>;
}

function PortBoard({ ports }: { ports: Port[] }) {
  return (
    <figure className="st-ports">
      <ol className="st-port-grid">
        {ports.map((p) => (
          <li key={p.index} className={`st-port ${p.status}`}>
            <span className="st-port-num">P{p.index + 1}</span>
            <span className="st-port-type">{p.connectorType}</span>
            <span className="st-port-kw">{p.powerKw} kW</span>
            <span className="st-port-status">{p.status}</span>
          </li>
        ))}
      </ol>
      <figcaption className="muted">
        The port board is a fixed-size array: checking or flipping <code>ports[i]</code> is O(1).
      </figcaption>
    </figure>
  );
}

function StationDetail({ s, onClose }: { s: StationView; onClose: () => void }) {
  return (
    <article className="card st-detail" aria-labelledby="st-detail-title">
      <div className="st-detail-top">
        <div>
          <h3 id="st-detail-title">{s.name}</h3>
          <p className="muted st-addr">
            {s.address.line1}, {s.address.locality} · {s.operator}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close station details">
          Close
        </button>
      </div>

      <dl className="st-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <StatusBadge s={s} />
          </dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>₹{s.pricePerKwh}/kWh</dd>
        </div>
        <div>
          <dt>Rating</dt>
          <dd>
            ★ {s.rating.toFixed(1)} <span className="muted">({s.ratingCount})</span>
          </dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{s.distanceKm.toFixed(1)} km</dd>
        </div>
        <div>
          <dt>In queue</dt>
          <dd>{s.queueLength === 0 ? 'Nobody' : `${s.queueLength} ${s.queueLength === 1 ? 'car' : 'cars'}`}</dd>
        </div>
        <div>
          <dt>Est. wait</dt>
          <dd>{formatWait(s.waitMin)}</dd>
        </div>
      </dl>

      <PortBoard ports={s.ports} />

      {s.amenities.length > 0 && (
        <ul className="st-amenities" aria-label="Amenities">
          {s.amenities.map((a) => (
            <li key={a} className="badge">
              {a}
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        {s.availability !== 'offline' && <LinkButton to={`/queue?station=${s.id}`}>Join the queue</LinkButton>}
        <LinkButton to={`/route?to=${s.id}`} variant="secondary">
          Plan a route here
        </LinkButton>
      </div>
    </article>
  );
}

export default function Stations() {
  const [all, setAll] = useState<Station[] | null>(null);
  const [filters, setFilters] = useState<StationFilters>(DEFAULT_FILTERS);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('station');

  useEffect(() => {
    let live = true;
    listStations().then((s) => live && setAll(s));
    return () => {
      live = false;
    };
  }, []);

  const connectors = useMemo(
    () => [...new Set((all ?? []).flatMap((s) => s.connectorTypes))].sort() as ConnectorType[],
    [all],
  );
  const results = useMemo(() => filterStations(all ?? [], filters, HOME), [all, filters]);
  // Look the selection up in the full set so a filter change doesn't close the open station.
  const selected = useMemo(
    () => filterStations(all ?? [], { ...DEFAULT_FILTERS, maxPrice: Infinity }, HOME).find((s) => s.id === selectedId) ?? null,
    [all, selectedId],
  );

  const set = <K extends keyof StationFilters>(key: K, value: StationFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const select = (id: string | null) => setParams(id ? { station: id } : {}, { replace: true });

  // Keep the open station's pin on the map even if the filters would hide it.
  const mapStations = selected && !results.some((s) => s.id === selected.id) ? [...results, selected] : results;
  const freeNow = results.filter((s) => s.freePorts > 0).length;

  return (
    <div className="container page-stations">
      <div className="band green">
        <PageHead eyebrow="find a plug" title="Station map">
          Every station around Pune with its free ports, price, connectors and the queue waiting for it. Pick a pin or a
          card to open the station’s port board.
        </PageHead>

        <p className="notice st-sample" role="note">
          Sample data: 15 fictional stations at real Pune localities. Live numbers arrive once the stations API is
          connected.
        </p>

        <section className="card st-filters" aria-label="Filter stations">
          <div className="field">
            <label htmlFor="st-text">Search</label>
            <input
              id="st-text"
              className="input"
              type="search"
              placeholder="Name or locality"
              value={filters.text}
              onChange={(e) => set('text', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="st-connector">Connector</label>
            <select
              id="st-connector"
              className="select"
              value={filters.connector}
              onChange={(e) => set('connector', e.target.value as StationFilters['connector'])}
            >
              <option value="any">Any connector</option>
              {connectors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="st-sort">Sort</label>
            <select
              id="st-sort"
              className="select"
              value={filters.sort}
              onChange={(e) => set('sort', e.target.value as SortKey)}
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <Slider
            id="st-price"
            label="Max price"
            value={filters.maxPrice}
            min={10}
            max={25}
            step={0.5}
            format={(v) => `₹${v}/kWh`}
            onChange={(v) => set('maxPrice', v)}
          />
          <div className="st-filter-end">
            <label className="check">
              <input type="checkbox" checked={filters.freeOnly} onChange={(e) => set('freeOnly', e.target.checked)} />
              Free port right now
            </label>
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Reset
            </button>
          </div>
        </section>
      </div>

      <div className="band cream">
        <p className="st-count" role="status" aria-live="polite">
          {all === null
            ? 'Loading stations…'
            : `${results.length} of ${all.length} stations · ${freeNow} with a free port now`}
        </p>

        <div className="st-layout">
          <div className="st-map-col">
            <div className="card st-map-card">
              <ul className="st-legend" aria-label="Map legend">
                <li>
                  <span className="st-dot available" /> Free port now
                </li>
                <li>
                  <span className="st-dot full" /> All busy, queue open
                </li>
                <li>
                  <span className="st-dot offline" /> Offline
                </li>
                <li>
                  <span className="st-dot home" /> You
                </li>
              </ul>
              <StationMap stations={mapStations} selectedId={selectedId} onSelect={(id) => select(id)} />
            </div>
            {selected && <StationDetail s={selected} onClose={() => select(null)} />}
          </div>

          <ol className="st-list" aria-label="Stations">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  className={`st-item${s.id === selectedId ? ' selected' : ''}`}
                  aria-pressed={s.id === selectedId}
                  onClick={() => select(s.id)}
                >
                  <span className="st-item-top">
                    <strong>{s.name}</strong>
                    <StatusBadge s={s} />
                  </span>
                  <span className="st-item-meta">
                    {s.distanceKm.toFixed(1)} km · ₹{s.pricePerKwh}/kWh · ★ {s.rating.toFixed(1)}
                  </span>
                  <span className="st-item-meta">
                    {s.freePorts}/{s.totalPorts} ports free ·{' '}
                    {s.queueLength > 0 ? `${s.queueLength} in queue · ${formatWait(s.waitMin)}` : formatWait(s.waitMin)}
                  </span>
                  <span className="st-item-conn">{s.connectorTypes.join(' · ')}</span>
                </button>
              </li>
            ))}
            {all !== null && results.length === 0 && (
              <li className="card muted">No station matches those filters. Try raising the price limit or resetting.</li>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
