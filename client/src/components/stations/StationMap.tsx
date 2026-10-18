/**
 * WattWay · Team Kothimbir 🌿
 * StationMap.tsx — the Pune backdrop with one pin per station.
 */
import { useMemo, type KeyboardEvent } from 'react';
import { HOME, SAMPLE_STATIONS } from '../../services/stations';
import { makeProjection, type StationView } from '../../utils/stations';
import { HEADROOM, PIN, PuneBase } from './PuneBase';

const STATUS_TEXT = { available: 'free ports', full: 'all ports busy', offline: 'offline' } as const;

/** Enter / Space activate an SVG element given role="button". */
export const activateOnKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

export function StationMap({
  stations,
  selectedId,
  onSelect,
}: {
  stations: StationView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Fit to every station (not just the filtered ones) so the map doesn't jump around as filters change.
  const proj = useMemo(() => makeProjection([...SAMPLE_STATIONS.map((s) => s.location), HOME, HEADROOM], 0.08), []);
  const home = proj.project(HOME);

  // Draw the selected pin last so it sits on top.
  const ordered = [...stations].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));

  return (
    <svg
      className="st-map"
      viewBox={`0 0 ${proj.width.toFixed(2)} ${proj.height}`}
      role="group"
      aria-label={`Map of Pune showing ${stations.length} charging stations`}
    >
      <PuneBase proj={proj} />

      <g className="st-home" transform={`translate(${home.x} ${home.y})`} aria-label={HOME.label}>
        <circle r="2.6" className="st-home-halo" />
        <circle r="1.1" />
        <text y="5">You</text>
      </g>

      {ordered.map((s) => {
        const { x, y } = proj.project(s.location);
        const selected = s.id === selectedId;
        return (
          <g
            key={s.id}
            className={`st-pin ${s.availability}${selected ? ' selected' : ''}`}
            transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${s.name}, ${STATUS_TEXT[s.availability]}, ₹${s.pricePerKwh} per kWh`}
            onClick={() => onSelect(s.id)}
            onKeyDown={activateOnKey(() => onSelect(s.id))}
          >
            <title>{s.name}</title>
            <g className="st-pin-shape">
              <path d={PIN} />
              <circle cy="-3.8" r="0.85" className="st-pin-dot" />
            </g>
            {selected && (
              <text
                className="st-pin-label"
                y={y < 16 ? 4.5 : -12}
                // Keep labels near the edges inside the map.
                textAnchor={x < proj.width * 0.2 ? 'start' : x > proj.width * 0.8 ? 'end' : 'middle'}
                x={x < proj.width * 0.2 ? -2 : x > proj.width * 0.8 ? 2 : 0}
              >
                {s.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
