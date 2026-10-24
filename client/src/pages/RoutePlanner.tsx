/**
 * WattWay · Team Kothimbir 🌿
 * RoutePlanner.tsx — battery-aware trip planning with at most one charging
 * stop, chosen by a weighted score of detour, wait and price. The three weights
 * are linked (always 100%) and re-rank the stops live as you drag them.
 * Accepts ?to=<station or place id>, which the station map links to.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RouteMap } from '../components/route/RouteMap';
import { LinkButton, PageHead, Slider } from '../components/ui';
import { PLACES, VEHICLES, planRoute, type Place } from '../services/routes';
import type { GeoResult } from '../services/geocode';
import { SAMPLE_STATIONS } from '../services/stations';
import {
  formatMin,
  rankCandidates,
  rebalance,
  RESERVE,
  ROAD_FACTOR,
  WEIGHT_KEYS,
  type Exclusion,
  type Ranked,
  type RoutePlan,
  type WeightKey,
  type Weights,
} from '../utils/route';
import { formatWait } from '../utils/stations';
import '../styles/stations.css';
import '../styles/route.css';

const STATION_PLACES: Place[] = SAMPLE_STATIONS.map((s) => ({ id: s.id, label: s.name, ...s.location }));
const ALL_PLACES = [...PLACES, ...STATION_PLACES];

const WEIGHT_LABEL: Record<WeightKey, { label: string; hint: string }> = {
  distance: { label: 'Short detour', hint: 'Extra km versus driving straight there' },
  wait: { label: 'Short wait', hint: 'Queue time for a port your car can use' },
  price: { label: 'Low price', hint: '₹ per kWh at the station' },
};

const PRESETS: { label: string; w: Weights }[] = [
  { label: 'Balanced', w: { distance: 34, wait: 33, price: 33 } },
  { label: 'Fastest', w: { distance: 40, wait: 55, price: 5 } },
  { label: 'Cheapest', w: { distance: 10, wait: 15, price: 75 } },
];

const EXCLUSION_TEXT: Record<Exclusion, string> = {
  connector: 'no plug for your vehicle',
  offline: 'your plug type is faulted',
  range: 'out of reach on this charge',
  detour: 'too far off the route',
  onward: 'can’t finish the trip from there',
};

function ScoreBar({ r }: { r: Ranked }) {
  return (
    <span className="rt-bar" aria-hidden="true">
      <span className="rt-bar-kept" style={{ width: `${r.score}%` }} />
      {WEIGHT_KEYS.map((k) => (
        <span key={k} className={`rt-bar-lost ${k}`} style={{ width: `${r.lost[k]}%` }} />
      ))}
    </span>
  );
}

export default function RoutePlanner() {
  const [params] = useSearchParams();
  const initialTo = params.get('to');

  const [fromId, setFromId] = useState('home');
  const [toId, setToId] = useState(initialTo && ALL_PLACES.some((p) => p.id === initialTo) ? initialTo : 'hinjewadi');
  const [vehicleId, setVehicleId] = useState('compact');
  const vehicle = VEHICLES.find((v) => v.id === vehicleId) ?? VEHICLES[1];
  const [batteryPct, setBatteryPct] = useState(18);
  const [rangeKm, setRangeKm] = useState(vehicle.rangeKm);
  const [maxDetourKm, setMaxDetourKm] = useState(6);
  const [weights, setWeights] = useState<Weights>({ distance: 40, wait: 35, price: 25 });
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Places found with the map search, so they can sit in the From / To lists.
  const [searched, setSearched] = useState<Place[]>([]);

  const placeById = (id: string) => [...ALL_PLACES, ...searched].find((p) => p.id === id) ?? PLACES[0];
  const from = placeById(fromId);
  const to = placeById(toId);

  const pickSearched = (place: GeoResult, as: 'from' | 'to') => {
    setSearched((list) => [{ id: place.id, label: place.label, lat: place.lat, lng: place.lng }, ...list.filter((p) => p.id !== place.id)].slice(0, 5));
    (as === 'from' ? setFromId : setToId)(place.id);
  };

  const searchedOptions = searched.length > 0 && (
    <optgroup label="Searched">
      {searched.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </optgroup>
  );
  const samePlace = fromId === toId;

  useEffect(() => {
    let live = true;
    setPicked(null);
    planRoute({ from, to, batteryPct, rangeKm, vehicle, maxDetourKm }).then((p) => live && setPlan(p));
    return () => {
      live = false;
    };
    // from/to/vehicle are derived from these ids, so the ids are the real dependencies.
  }, [fromId, toId, vehicleId, batteryPct, rangeKm, maxDetourKm]);

  const ranked = useMemo(() => (plan ? rankCandidates(plan.candidates, weights) : []), [plan, weights]);
  const top = ranked[0] ?? null;
  const chosen = ranked.find((r) => r.station.id === picked) ?? top;

  const chooseVehicle = (id: string) => {
    const v = VEHICLES.find((x) => x.id === id);
    setVehicleId(id);
    if (v) setRangeKm(v.rangeKm);
  };

  const ruledOut = plan
    ? (Object.entries(plan.excluded) as [Exclusion, number][]).filter(([, n]) => n > 0)
    : [];
  const usableKm = Math.max(0, ((batteryPct - RESERVE * 100) / 100) * rangeKm);

  return (
    <div className="container page-route">
      <div className="band green">
        <PageHead eyebrow="plan the drive" title="Route planner">
          Tell WattWay where you’re going and how much charge you have. It works out whether you need a stop and ranks
          every station you can actually reach by detour, wait and price, weighted the way you choose.
        </PageHead>

        <p className="notice st-sample" role="note">
          Preview: road distance is estimated as straight-line × {ROAD_FACTOR}, over the sample stations. Real routing
          (Dijkstra on the road graph) arrives with the routing module.
        </p>
      </div>

      <div className="band cream">
        <aside className="rt-controls">
          <section className="card rt-panel" aria-labelledby="rt-trip">
            <h3 id="rt-trip">Trip</h3>
            <div className="field">
              <label htmlFor="rt-from">From</label>
              <select id="rt-from" className="select" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <optgroup label="Places">
                  {PLACES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                {searchedOptions}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rt-to">To</label>
              <select id="rt-to" className="select" value={toId} onChange={(e) => setToId(e.target.value)}>
                <optgroup label="Places">
                  {PLACES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                {searchedOptions}
                <optgroup label="Stations">
                  {STATION_PLACES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </section>

          <section className="card rt-panel" aria-labelledby="rt-vehicle">
            <h3 id="rt-vehicle">Vehicle</h3>
            <div className="field">
              <label htmlFor="rt-car">Vehicle type</label>
              <select id="rt-car" className="select" value={vehicleId} onChange={(e) => chooseVehicle(e.target.value)}>
                {VEHICLES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              <small className="muted">Plugs: {vehicle.connectors.join(', ')}</small>
            </div>
            <Slider
              id="rt-battery"
              label="Battery now"
              value={batteryPct}
              min={5}
              max={100}
              unit="%"
              hint={`About ${Math.round(usableKm)} km before the ${RESERVE * 100}% reserve`}
              warning={batteryPct <= RESERVE * 100 ? `Already at the ${RESERVE * 100}% reserve` : undefined}
              onChange={setBatteryPct}
            />
            <Slider
              id="rt-range"
              label="Range on a full charge"
              value={rangeKm}
              min={60}
              max={500}
              step={10}
              unit=" km"
              onChange={setRangeKm}
            />
            <Slider
              id="rt-detour"
              label="Max detour for a stop"
              value={maxDetourKm}
              min={1}
              max={20}
              unit=" km"
              onChange={setMaxDetourKm}
            />
          </section>

          <section className="card rt-panel" aria-labelledby="rt-weights">
            <h3 id="rt-weights">What matters most</h3>
            <div className="row rt-presets" role="group" aria-label="Weight presets">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className="btn btn-ghost btn-sm"
                  aria-pressed={WEIGHT_KEYS.every((k) => weights[k] === p.w[k])}
                  onClick={() => setWeights(p.w)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {WEIGHT_KEYS.map((k) => (
              <Slider
                key={k}
                id={`rt-w-${k}`}
                label={WEIGHT_LABEL[k].label}
                value={weights[k]}
                min={0}
                max={100}
                unit="%"
                hint={WEIGHT_LABEL[k].hint}
                onChange={(v) => setWeights((w) => rebalance(w, k, v))}
              />
            ))}
            <p className="rt-total">
              <span className={`swatch rt-sw distance`} /> <span className={`swatch rt-sw wait`} />{' '}
              <span className={`swatch rt-sw price`} /> Always adds up to {weights.distance + weights.wait + weights.price}%
            </p>
            <div className="rt-live" aria-live="polite">
              <strong>Live ranking</strong>
              {ranked.length === 0 ? (
                <p className="muted">No viable stops yet.</p>
              ) : (
                <ol>
                  {ranked.slice(0, 3).map((r) => (
                    <li key={r.station.id}>
                      <span>{r.station.name}</span>
                      <span className="rt-live-score">{Math.round(r.score)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </aside>
      </div>

      <div className="band green">
        <div className="rt-result">
          <section className="card rt-summary" aria-live="polite">
            {samePlace ? (
              <p className="muted">Start and destination are the same place. Pick somewhere to go.</p>
            ) : plan === null ? (
              <p className="muted">Planning…</p>
            ) : (
              <>
                <div className="rt-summary-top">
                  <h3>
                    {from.label} → {to.label}
                  </h3>
                  {plan.needsStop ? (
                    <span className="badge badge-warn">One stop needed</span>
                  ) : (
                    <span className="badge badge-ok">No stop needed</span>
                  )}
                </div>
                <p className="rt-direct-line">
                  Direct: <strong>{plan.directKm.toFixed(1)} km</strong>, about{' '}
                  <strong>{formatMin(plan.directMin)}</strong> of driving.{' '}
                  {plan.needsStop
                    ? `You’d run out ${plan.arrivePctDirect < 0 ? 'on the way' : `at ${Math.round(plan.arrivePctDirect)}%, below the ${RESERVE * 100}% reserve`}, so WattWay adds a stop.`
                    : `You’d arrive with ${Math.round(plan.arrivePctDirect)}% left. The stops below are optional top-ups.`}
                </p>

                {chosen ? (
                  <div className="rt-chosen">
                    <p className="eyebrow-sm">{chosen === top ? 'Best stop' : 'Your pick'}</p>
                    <h4>{chosen.station.name}</h4>
                    <dl className="st-facts">
                      <div>
                        <dt>Detour</dt>
                        <dd>+{chosen.detourKm.toFixed(1)} km</dd>
                      </div>
                      <div>
                        <dt>Arrive at stop</dt>
                        <dd>{Math.round(chosen.arrivePct)}%</dd>
                      </div>
                      <div>
                        <dt>Wait</dt>
                        <dd>{formatWait(chosen.waitMin)}</dd>
                      </div>
                      <div>
                        <dt>Charge</dt>
                        <dd>
                          {chosen.chargeKwh.toFixed(1)} kWh · {formatMin(chosen.chargeMin)}
                        </dd>
                      </div>
                      <div>
                        <dt>Cost</dt>
                        <dd>₹{Math.round(chosen.chargeCost)}</dd>
                      </div>
                      <div>
                        <dt>Whole trip</dt>
                        <dd>{formatMin(chosen.tripMin)}</dd>
                      </div>
                      <div>
                        <dt>Arrive with</dt>
                        <dd>{Math.round(chosen.finalPct)}%</dd>
                      </div>
                    </dl>
                    <div className="row">
                      <LinkButton to={`/queue?station=${chosen.station.id}`} small>
                        Join its queue
                      </LinkButton>
                      <LinkButton to={`/stations?station=${chosen.station.id}`} variant="secondary" small>
                        See it on the map
                      </LinkButton>
                      {chosen !== top && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>
                          Back to the best stop
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  plan.needsStop && (
                    <p className="notice error">
                      No station fits this trip. Try a bigger detour limit or more charge, or check that your vehicle’s
                      plug is available nearby.
                    </p>
                  )
                )}
              </>
            )}
          </section>

          <section className="card st-map-card" aria-label="Route map">
            <ul className="st-legend" aria-label="Map legend">
              <li>
                <span className="st-dot rt-a" /> Start
              </li>
              <li>
                <span className="st-dot rt-b" /> Destination
              </li>
              <li>
                <span className="st-dot home" /> Chosen stop
              </li>
              <li>
                <span className="st-dot rt-other" /> Other stops, by rank
              </li>
            </ul>
            <RouteMap
              from={from}
              to={to}
              ranked={samePlace ? [] : ranked}
              chosenId={samePlace ? null : (chosen?.station.id ?? null)}
              onChoose={setPicked}
              onSearchPick={pickSearched}
            />
          </section>
        </div>
      </div>

      <div className="band cream">
        {!samePlace && plan && (
          <section className="card" aria-labelledby="rt-ranked">
            <h3 id="rt-ranked">Every viable stop, ranked</h3>
            <p className="muted rt-explain">
              Each factor is scaled so the best station scores 0 and the worst 1, then costs up to its weight in
              points. The bar shows what each station lost to{' '}
              <span className="swatch rt-sw distance" /> detour, <span className="swatch rt-sw wait" /> wait and{' '}
              <span className="swatch rt-sw price" /> price.
            </p>
            {ranked.length === 0 ? (
              <p className="muted">No station passes the range, detour and connector checks.</p>
            ) : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Ranked stops">
                <table className="table rt-table">
                  <thead>
                    <tr>
                      <th scope="col" className="num">
                        #
                      </th>
                      <th scope="col">Station</th>
                      <th scope="col">Score</th>
                      <th scope="col" className="num">
                        Detour
                      </th>
                      <th scope="col" className="num">
                        Wait
                      </th>
                      <th scope="col" className="num">
                        Cost
                      </th>
                      <th scope="col" className="num">
                        Trip
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r, i) => {
                      const isChosen = r.station.id === chosen?.station.id;
                      return (
                        <tr key={r.station.id} className={isChosen ? 'chosen' : undefined}>
                          <td className="num">{i + 1}</td>
                          <td>
                            <button
                              className="rt-pick"
                              aria-pressed={isChosen}
                              onClick={() => setPicked(r.station.id)}
                            >
                              {r.station.name}
                            </button>
                            <span className="rt-rate">₹{r.station.pricePerKwh}/kWh</span>
                          </td>
                          <td>
                            <span className="rt-score">
                              <ScoreBar r={r} />
                              <span
                                className="rt-score-num"
                                title={`Lost ${r.lost.distance.toFixed(1)} to detour, ${r.lost.wait.toFixed(1)} to wait, ${r.lost.price.toFixed(1)} to price`}
                              >
                                {Math.round(r.score)}
                              </span>
                            </span>
                          </td>
                          <td className="num">+{r.detourKm.toFixed(1)} km</td>
                          <td className="num">{formatWait(r.waitMin)}</td>
                          <td className="num">₹{Math.round(r.chargeCost)}</td>
                          <td className="num">{formatMin(r.tripMin)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {ruledOut.length > 0 && (
              <p className="muted rt-ruled">
                Ruled out: {ruledOut.map(([k, n]) => `${EXCLUSION_TEXT[k]} (${n})`).join(' · ')}.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
