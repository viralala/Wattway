/**
 * WattWay · Team Kothimbir 🌿
 * geocode.ts — place search for the maps, via OpenStreetMap's Nominatim.
 *
 * Nominatim's usage policy allows about one request a second and forbids
 * search-as-you-type, so the maps only call this when the user submits.
 * Results are biased to Pune but not limited to it.
 */
import type { LatLng } from './stations';

export interface GeoResult extends LatLng {
  id: string;
  label: string;
  detail: string;
}

/** Roughly greater Pune: west, north, east, south. */
const PUNE_VIEWBOX = '73.65,18.68,74.05,18.40';

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({ q, format: 'jsonv2', limit: '6', countrycodes: 'in', viewbox: PUNE_VIEWBOX });
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Place search failed (${response.status})`);
  const rows = (await response.json()) as { place_id: number; lat: string; lon: string; name?: string; display_name: string }[];
  return rows.map((r) => {
    const [first, ...rest] = r.display_name.split(', ');
    return {
      id: `geo-${r.place_id}`,
      label: r.name || first,
      detail: rest.slice(0, 3).join(', '),
      lat: Number(r.lat),
      lng: Number(r.lon),
    };
  });
}
