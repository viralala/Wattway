/**
 * WattWay · Team Kothimbir 🌿
 * RouteMap.tsx — the trip on a Leaflet map of Pune: start (A), destination (B),
 * the direct line, every viable stop numbered by rank, and the chosen stop's
 * route. A place search above the map can set the start or the destination.
 */
import { useEffect } from 'react';
import L from 'leaflet';
import type { Place } from '../../services/routes';
import type { GeoResult } from '../../services/geocode';
import type { Ranked } from '../../utils/route';
import { MapSearch } from '../map/MapSearch';
import { divMarker, useLeafletMap } from '../map/useLeafletMap';

const ll = (p: { lat: number; lng: number }): L.LatLngTuple => [p.lat, p.lng];

export function RouteMap({
  from,
  to,
  ranked,
  chosenId,
  onChoose,
  onSearchPick,
}: {
  from: Place;
  to: Place;
  ranked: Ranked[];
  chosenId: string | null;
  onChoose: (id: string) => void;
  onSearchPick?: (place: GeoResult, as: 'from' | 'to') => void;
}) {
  const { ref, handle } = useLeafletMap(from);
  const chosen = ranked.find((r) => r.station.id === chosenId);

  useEffect(() => {
    if (!handle) return;
    const { layer } = handle;
    layer.clearLayers();

    L.polyline([ll(from), ll(to)], { color: '#7a6a5a', weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(layer);
    if (chosen) {
      const path = [ll(from), ll(chosen.station.location), ll(to)];
      L.polyline(path, { color: '#fff', weight: 8, opacity: 0.9 }).addTo(layer);
      L.polyline(path, { color: '#9c3653', weight: 4 }).addTo(layer);
    }

    ranked.forEach((r, i) => {
      const isChosen = r.station.id === chosenId;
      divMarker(r.station.location, `stop${isChosen ? ' chosen' : ''}`, String(i + 1), isChosen ? 28 : 22)
        .bindTooltip(`#${i + 1} ${r.station.name} · score ${Math.round(r.score)}`, { className: 'ww-tip', direction: 'top', offset: [0, -12] })
        .on('click', () => onChoose(r.station.id))
        .setZIndexOffset(isChosen ? 1000 : 0)
        .addTo(layer);
    });

    divMarker(from, 'start', 'A', 26)
      .bindTooltip(from.label, { className: 'ww-tip', permanent: true, direction: 'bottom', offset: [0, 14] })
      .setZIndexOffset(2000)
      .addTo(layer);
    divMarker(to, 'finish', 'B', 26)
      .bindTooltip(to.label, { className: 'ww-tip', permanent: true, direction: 'bottom', offset: [0, 14] })
      .setZIndexOffset(2000)
      .addTo(layer);
  }, [handle, from, to, ranked, chosenId, chosen, onChoose]);

  // Re-frame only when the trip itself changes, not on every re-rank.
  useEffect(() => {
    handle?.map.fitBounds(L.latLngBounds([ll(from), ll(to)]), { padding: [50, 50], maxZoom: 14 });
  }, [handle, from.lat, from.lng, to.lat, to.lng]);

  return (
    <>
      {onSearchPick && (
        <MapSearch
          actions={[
            { label: 'Start here', onPick: (p) => onSearchPick(p, 'from') },
            { label: 'Go here', onPick: (p) => onSearchPick(p, 'to') },
          ]}
        />
      )}
      <div
        ref={ref}
        className="st-map rt-map ww-map"
        role="region"
        aria-label={`Route from ${from.label} to ${to.label}${chosen ? ` via ${chosen.station.name}` : ''}`}
      />
    </>
  );
}
