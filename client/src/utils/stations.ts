/**
 * WattWay · Team Kothimbir 🌿
 * stations.ts — pure helpers for the station map: distance, availability,
 * filtering/sorting and the lat/lng → SVG projection. No React, so they test cleanly.
 */
import type { ConnectorType, LatLng, Station } from '../services/stations';

export type Availability = 'available' | 'full' | 'offline';
export type SortKey = 'nearest' | 'cheapest' | 'rating' | 'queue';

export interface StationFilters {
  text: string;
  connector: ConnectorType | 'any';
  maxPrice: number;
  freeOnly: boolean;
  sort: SortKey;
}

export interface StationView extends Station {
  distanceKm: number;
  availability: Availability;
  waitMin: number;
}

/** Average length of one charging session, used for the wait estimate. */
export const SESSION_MIN = 35;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** available: a port is free now · full: every working port is busy · offline: every port is faulted. */
export function availability(s: Station): Availability {
  if (s.freePorts > 0) return 'available';
  return s.ports.some((p) => p.status === 'occupied') ? 'full' : 'offline';
}

/**
 * Rough minutes until a port frees up for someone joining now: you are
 * (queueLength + 1)th in line, served by the working ports in parallel.
 */
export function estimatedWait(s: Station): number {
  if (s.freePorts > 0) return 0;
  const working = s.ports.filter((p) => p.status !== 'faulted').length;
  if (working === 0) return Infinity;
  return Math.ceil((s.queueLength + 1) / working) * SESSION_MIN;
}

export function formatWait(min: number): string {
  if (min === 0) return 'No wait';
  if (!Number.isFinite(min)) return 'Unavailable';
  return min < 60 ? `~${min} min` : `~${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
}

const SORTERS: Record<SortKey, (a: StationView, b: StationView) => number> = {
  nearest: (a, b) => a.distanceKm - b.distanceKm,
  cheapest: (a, b) => a.pricePerKwh - b.pricePerKwh || a.distanceKm - b.distanceKm,
  rating: (a, b) => b.rating - a.rating || a.distanceKm - b.distanceKm,
  queue: (a, b) => a.waitMin - b.waitMin || a.distanceKm - b.distanceKm,
};

export function filterStations(stations: Station[], f: StationFilters, from: LatLng): StationView[] {
  const text = f.text.trim().toLowerCase();
  return stations
    .map((s) => ({ ...s, distanceKm: haversineKm(from, s.location), availability: availability(s), waitMin: estimatedWait(s) }))
    .filter(
      (s) =>
        (!text ||
          [s.name, s.operator, s.address.locality, s.address.line1].some((v) => v.toLowerCase().includes(text))) &&
        (f.connector === 'any' || s.connectorTypes.includes(f.connector)) &&
        s.pricePerKwh <= f.maxPrice &&
        (!f.freeOnly || s.freePorts > 0),
    )
    .sort(SORTERS[f.sort]);
}

export interface Projection {
  width: number;
  height: number;
  project: (p: LatLng) => { x: number; y: number };
}

/**
 * Equirectangular projection fitted to the points, corrected by cos(latitude)
 * so a kilometre east looks as long as a kilometre north. Height is fixed at
 * 100 SVG units; width follows the area's aspect ratio.
 */
export function makeProjection(points: LatLng[], pad = 0.1): Projection {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  let [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const padLat = (maxLat - minLat || 0.01) * pad;
  const padLng = (maxLng - minLng || 0.01) * pad;
  minLat -= padLat;
  maxLat += padLat;
  minLng -= padLng;
  maxLng += padLng;

  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const height = 100;
  const width = (((maxLng - minLng) * k) / (maxLat - minLat)) * height;
  return {
    width,
    height,
    project: ({ lat, lng }) => ({
      x: ((lng - minLng) / (maxLng - minLng)) * width,
      y: ((maxLat - lat) / (maxLat - minLat)) * height,
    }),
  };
}
