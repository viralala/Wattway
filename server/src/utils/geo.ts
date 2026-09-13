/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * geo.ts — the small amount of geography the index layer needs.
 *
 * The *routing* module works in graph space (nodes and weighted edges). This
 * file is only for the straight-line "is this station near me" filter that the
 * BST range query is combined with, and for the distance term in the
 * autocomplete/ranking score.
 * ---------------------------------------------------------------------------
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON Point, which is what MongoDB's 2dsphere index expects. */
export interface GeoPoint {
  type: 'Point';
  /** IMPORTANT: GeoJSON order is [longitude, latitude], not [lat, lng]. */
  coordinates: [number, number];
}

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres (haversine).
 *
 * Straight-line, so it is a *lower bound* on real driving distance — which is
 * exactly the right property for pruning candidates before the routing module
 * computes true travel time over the graph.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatLng(point: Partial<LatLng> | null | undefined): point is LatLng {
  if (!point) return false;
  const { lat, lng } = point;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function toGeoPoint(point: LatLng): GeoPoint {
  return { type: 'Point', coordinates: [point.lng, point.lat] };
}

export function fromGeoPoint(point: GeoPoint): LatLng {
  return { lat: point.coordinates[1], lng: point.coordinates[0] };
}
