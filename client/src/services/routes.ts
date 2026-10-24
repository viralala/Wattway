/**
 * WattWay · Team Kothimbir 🌿
 * routes.ts — route planning for the route planner page.
 *
 * HARDCODED for now: planning belongs to the routing module (`POST
 * /api/routes/plan`, Graph + Min-Heap). `planRoute` computes the same shape
 * locally from the station list; swap its body for
 *
 *   request<RoutePlan>('/api/routes/plan', { method: 'POST', body: JSON.stringify(input) })
 *
 * The plan returns raw per-station metrics and the page ranks them with the
 * driver's weights, so dragging a weight slider re-ranks instantly without a
 * round trip.
 */
import { planTrip, type RoutePlan, type TripInput, type Vehicle } from '../utils/route';
import { HOME, STATIONS, type LatLng } from './stations';

export interface Place extends LatLng {
  id: string;
  label: string;
}

export const PLACES: Place[] = [
  { id: 'home', label: 'VIT Pune, Bibwewadi', lat: HOME.lat, lng: HOME.lng },
  { id: 'hinjewadi', label: 'Hinjewadi Phase 3', lat: 18.588, lng: 73.695 },
  { id: 'airport', label: 'Pune Airport, Lohegaon', lat: 18.5821, lng: 73.9197 },
  { id: 'wagholi', label: 'Wagholi', lat: 18.58, lng: 73.98 },
  { id: 'khadakwasla', label: 'Khadakwasla Dam', lat: 18.4436, lng: 73.768 },
  { id: 'shaniwar', label: 'Shaniwar Wada', lat: 18.5196, lng: 73.8553 },
  { id: 'railway', label: 'Pune Railway Station', lat: 18.5289, lng: 73.8744 },
];

/** Generic vehicle classes; specs are typical, not any one model's. */
export const VEHICLES: Vehicle[] = [
  { id: 'scooter', label: 'City scooter · 3 kWh', capacityKwh: 3, rangeKm: 100, maxKw: 3.3, connectors: ['Type2', 'Bharat-AC-001'] },
  { id: 'compact', label: 'Compact car · 30 kWh', capacityKwh: 30, rangeKm: 250, maxKw: 50, connectors: ['CCS2', 'Type2', 'Bharat-DC-001'] },
  { id: 'long', label: 'Long-range car · 60 kWh', capacityKwh: 60, rangeKm: 420, maxKw: 120, connectors: ['CCS2', 'CHAdeMO', 'Type2'] },
];

export async function planRoute(input: TripInput): Promise<RoutePlan> {
  return planTrip(STATIONS, input);
}
