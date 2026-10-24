/**
 * WattWay · Team Kothimbir 🌿
 * useLeafletMap.ts — one Leaflet map with OpenStreetMap tiles, created when the
 * container mounts and removed when it unmounts. Callers draw into `layer`,
 * which they clear and refill whenever their data changes.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../../styles/map.css';
import type { LatLng } from '../../services/stations';

export interface LeafletHandle {
  map: L.Map;
  layer: L.LayerGroup;
}

export function useLeafletMap(center: LatLng, zoom = 12) {
  const ref = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<LeafletHandle | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { center: [center.lat, center.lng], zoom, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    // Wheel zoom only once the map has been clicked, so the page still scrolls past it.
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());
    const layer = L.layerGroup().addTo(map);
    setHandle({ map, layer });
    return () => {
      map.remove();
      setHandle(null);
    };
    // The map is created once; later centre changes are the caller's to apply.
  }, []);

  return { ref, handle };
}

/** A coloured HTML marker; all styling lives in map.css. */
export function divMarker(at: LatLng, className: string, html = '', size = 22): L.Marker {
  return L.marker([at.lat, at.lng], {
    icon: L.divIcon({ className: `ww-marker ${className}`, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
    keyboard: true,
  });
}
