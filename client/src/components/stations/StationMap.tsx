/**
 * WattWay · Team Kothimbir 🌿
 * StationMap.tsx — a Leaflet map of Pune with one pin per station, plus a
 * place search that flies the map to the result.
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import L from 'leaflet';
import { HOME, STATIONS } from '../../services/stations';
import type { GeoResult } from '../../services/geocode';
import type { StationView } from '../../utils/stations';
import { MapSearch } from '../map/MapSearch';
import { divMarker, useLeafletMap } from '../map/useLeafletMap';

const STATUS_TEXT = { available: 'free ports', full: 'all ports busy', offline: 'offline' } as const;

/** Enter / Space activate an element given role="button". */
export const activateOnKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

/** Every station plus home, so the first view frames them all. */
const ALL_POINTS = L.latLngBounds([...STATIONS.map((s) => s.location), HOME].map((p) => [p.lat, p.lng]));

export function StationMap({
  stations,
  selectedId,
  onSelect,
}: {
  stations: StationView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { ref, handle } = useLeafletMap(HOME);
  const [found, setFound] = useState<GeoResult | null>(null);

  // Fit to every station (not just the filtered ones) so the map doesn't jump as filters change.
  useEffect(() => {
    handle?.map.fitBounds(ALL_POINTS, { padding: [30, 30] });
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    const { layer } = handle;
    layer.clearLayers();

    divMarker(HOME, 'home', '', 18).bindTooltip(HOME.label, { className: 'ww-tip' }).addTo(layer);

    for (const s of stations) {
      const selected = s.id === selectedId;
      const marker = divMarker(s.location, `${s.availability}${selected ? ' selected' : ''}`, '⚡')
        .bindTooltip(`${s.name} · ₹${s.pricePerKwh}/kWh · ${STATUS_TEXT[s.availability]}`, {
          className: 'ww-tip',
          permanent: selected,
          direction: 'top',
          offset: [0, -12],
        })
        .on('click', () => onSelect(s.id))
        .addTo(layer);
      marker.setZIndexOffset(selected ? 1000 : 0);
    }

    if (found) {
      divMarker(found, 'found', '★', 24)
        .bindTooltip(found.label, { className: 'ww-tip', permanent: true, direction: 'top', offset: [0, -14] })
        .addTo(layer);
    }
  }, [handle, stations, selectedId, onSelect, found]);

  // Bring the selected station into view.
  useEffect(() => {
    const s = stations.find((x) => x.id === selectedId);
    if (handle && s) handle.map.panTo([s.location.lat, s.location.lng]);
  }, [handle, selectedId]);

  const goTo = (place: GeoResult) => {
    setFound(place);
    handle?.map.flyTo([place.lat, place.lng], 15);
  };

  return (
    <>
      <MapSearch actions={[{ label: 'Show on map', onPick: goTo }]} />
      <div
        ref={ref}
        className="st-map ww-map"
        role="region"
        aria-label={`Map of Pune showing ${stations.length} charging stations`}
      />
    </>
  );
}
