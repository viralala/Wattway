/**
 * WattWay · Team Kothimbir 🌿
 * RouteMap.tsx — the trip on the Pune backdrop: start (A), destination (B), the
 * direct line, every viable stop numbered by rank, and the chosen stop's route.
 */
import { useMemo } from 'react';
import { PLACES, type Place } from '../../services/routes';
import { SAMPLE_STATIONS } from '../../services/stations';
import type { Ranked } from '../../utils/route';
import { makeProjection } from '../../utils/stations';
import { HEADROOM, PuneBase, smoothPath } from '../stations/PuneBase';
import { activateOnKey } from '../stations/StationMap';

export function RouteMap({
  from,
  to,
  ranked,
  chosenId,
  onChoose,
}: {
  from: Place;
  to: Place;
  ranked: Ranked[];
  chosenId: string | null;
  onChoose: (id: string) => void;
}) {
  const proj = useMemo(
    () => makeProjection([...SAMPLE_STATIONS.map((s) => s.location), ...PLACES, HEADROOM], 0.06),
    [],
  );
  const a = proj.project(from);
  const b = proj.project(to);
  const chosen = ranked.find((r) => r.station.id === chosenId);
  const route = chosen ? smoothPath([a, proj.project(chosen.station.location), b]) : null;

  // Chosen stop drawn last so it sits on top.
  const ordered = ranked
    .map((r, i) => ({ r, rank: i + 1 }))
    .sort((x, y) => Number(x.r.station.id === chosenId) - Number(y.r.station.id === chosenId));

  const endLabel = (p: { x: number; y: number }, text: string, below: boolean) => (
    <text
      className="rt-end-label"
      y={below ? 5.6 : -3.8}
      textAnchor={p.x < proj.width * 0.2 ? 'start' : p.x > proj.width * 0.8 ? 'end' : 'middle'}
    >
      {text}
    </text>
  );

  return (
    <svg
      className="st-map rt-map"
      viewBox={`0 0 ${proj.width.toFixed(2)} ${proj.height}`}
      role="group"
      aria-label={`Route from ${from.label} to ${to.label}${chosen ? ` via ${chosen.station.name}` : ''}`}
    >
      <PuneBase proj={proj} />

      <line className="rt-direct" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {route && (
        <>
          <path className="rt-route-casing" d={route} />
          <path className="rt-route" d={route} />
        </>
      )}

      {ordered.map(({ r, rank }) => {
        const { x, y } = proj.project(r.station.location);
        const isChosen = r.station.id === chosenId;
        return (
          <g
            key={r.station.id}
            className={`rt-stop${isChosen ? ' chosen' : ''}`}
            transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
            role="button"
            tabIndex={0}
            aria-pressed={isChosen}
            aria-label={`Rank ${rank}: ${r.station.name}, score ${Math.round(r.score)}`}
            onClick={() => onChoose(r.station.id)}
            onKeyDown={activateOnKey(() => onChoose(r.station.id))}
          >
            <title>{`#${rank} ${r.station.name}`}</title>
            <circle r={isChosen ? 2.6 : 1.9} />
            <text y={isChosen ? 1 : 0.75}>{rank}</text>
          </g>
        );
      })}

      <g className="rt-end start" transform={`translate(${a.x} ${a.y})`}>
        <circle r="2.3" />
        <text className="rt-end-letter" y="0.85">
          A
        </text>
        {endLabel(a, from.label, a.y < b.y ? false : true)}
      </g>
      <g className="rt-end finish" transform={`translate(${b.x} ${b.y})`}>
        <circle r="2.3" />
        <text className="rt-end-letter" y="0.85">
          B
        </text>
        {endLabel(b, to.label, b.y <= a.y ? false : true)}
      </g>
    </svg>
  );
}
