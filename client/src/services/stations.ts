/**
 * WattWay · Team Kothimbir 🌿
 * stations.ts — station data for the map.
 *
 * HARDCODED for now: the stations API belongs to the backend module. The shapes
 * below mirror the server's `IndexedStation` + `Port` types (server/src/types),
 * so wiring it up means replacing the two function bodies with:
 *
 *   listStations → request<Station[]>(`/api/stations?${params}`)
 *   getStation   → request<Station>(`/api/stations/${id}`)
 *
 * Operators and stations are fictional; coordinates are real Pune localities.
 */

export const CONNECTOR_TYPES = ['CCS2', 'CHAdeMO', 'Type2', 'GB/T', 'Bharat-AC-001', 'Bharat-DC-001'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
export type PortStatus = 'free' | 'occupied' | 'faulted';

export interface Port {
  index: number;
  connectorType: ConnectorType;
  powerKw: number;
  status: PortStatus;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Station {
  id: string;
  name: string;
  operator: string;
  address: { line1: string; locality: string; city: string; state: string; pincode?: string };
  location: LatLng;
  pricePerKwh: number;
  rating: number;
  ratingCount: number;
  connectorTypes: ConnectorType[];
  totalPorts: number;
  freePorts: number;
  queueLength: number;
  amenities: string[];
  isActive: boolean;
  /** The fixed-size port-status board (the Array data structure). */
  ports: Port[];
}

export interface StationQuery {
  city?: string;
  connectorType?: ConnectorType;
}

/** Where the map says "you are here": VIT Pune, Bibwewadi. */
export const HOME: LatLng & { label: string } = { lat: 18.4636, lng: 73.8681, label: 'You · VIT Bibwewadi' };

// ─── Station data ────────────────────────────────────────────────────────────

/** `statuses` is one letter per port: F free, O occupied, X faulted. */
function bank(connectorType: ConnectorType, powerKw: number, statuses: string) {
  const map: Record<string, PortStatus> = { F: 'free', O: 'occupied', X: 'faulted' };
  return [...statuses].map((s) => ({ connectorType, powerKw, status: map[s] }));
}

interface Seed extends Omit<Station, 'ports' | 'connectorTypes' | 'totalPorts' | 'freePorts' | 'address' | 'isActive'> {
  line1: string;
  locality: string;
  pincode: string;
  banks: Omit<Port, 'index'>[][];
}

const SEEDS: Seed[] = [
  { id: 'st-01', name: 'GreenPlug Bibwewadi', operator: 'GreenPlug', line1: 'Upper Indira Nagar Rd', locality: 'Bibwewadi', pincode: '411037', location: { lat: 18.4672, lng: 73.8652 }, pricePerKwh: 18, rating: 4.3, ratingCount: 212, queueLength: 0, amenities: ['Café', 'Restroom'], banks: [bank('CCS2', 60, 'FO'), bank('Type2', 22, 'FF')] },
  { id: 'st-02', name: 'AmpYard Koregaon Park', operator: 'AmpYard', line1: 'North Main Rd', locality: 'Koregaon Park', pincode: '411001', location: { lat: 18.5362, lng: 73.894 }, pricePerKwh: 21, rating: 4.5, ratingCount: 388, queueLength: 2, amenities: ['Café', 'Wi-Fi', 'Restroom'], banks: [bank('CCS2', 120, 'OO'), bank('CHAdeMO', 50, 'O')] },
  { id: 'st-03', name: 'Sahyadri Charge Hinjewadi', operator: 'Sahyadri Charge', line1: 'Rajiv Gandhi Infotech Park, Phase 1', locality: 'Hinjewadi', pincode: '411057', location: { lat: 18.5913, lng: 73.7389 }, pricePerKwh: 19.5, rating: 4.1, ratingCount: 501, queueLength: 4, amenities: ['Food court', 'Restroom'], banks: [bank('CCS2', 60, 'OOOX')] },
  { id: 'st-04', name: 'VoltVan Baner', operator: 'VoltVan', line1: 'Baner Rd, near Balewadi Phata', locality: 'Baner', pincode: '411045', location: { lat: 18.559, lng: 73.7868 }, pricePerKwh: 22, rating: 4.6, ratingCount: 274, queueLength: 0, amenities: ['Lounge', 'Wi-Fi', 'Restroom'], banks: [bank('CCS2', 150, 'FO'), bank('Type2', 22, 'FF')] },
  { id: 'st-05', name: 'CityGrid Shivajinagar', operator: 'CityGrid', line1: 'Jangali Maharaj Rd', locality: 'Shivajinagar', pincode: '411005', location: { lat: 18.5308, lng: 73.8475 }, pricePerKwh: 14.5, rating: 3.6, ratingCount: 143, queueLength: 1, amenities: [], banks: [bank('Bharat-DC-001', 15, 'OO'), bank('Bharat-AC-001', 3.3, 'OX')] },
  { id: 'st-06', name: 'GreenPlug FC Road', operator: 'GreenPlug', line1: 'Fergusson College Rd', locality: 'Deccan Gymkhana', pincode: '411004', location: { lat: 18.5236, lng: 73.841 }, pricePerKwh: 12, rating: 4.4, ratingCount: 96, queueLength: 0, amenities: ['Café'], banks: [bank('Type2', 7.4, 'FO')] },
  { id: 'st-07', name: 'AmpYard Magarpatta', operator: 'AmpYard', line1: 'Magarpatta City, Destination Centre', locality: 'Hadapsar', pincode: '411028', location: { lat: 18.5158, lng: 73.9272 }, pricePerKwh: 18, rating: 4.2, ratingCount: 330, queueLength: 3, amenities: ['Mall', 'Restroom'], banks: [bank('CCS2', 60, 'OO'), bank('Type2', 22, 'O')] },
  { id: 'st-08', name: 'VoltVan Viman Nagar', operator: 'VoltVan', line1: 'Datta Mandir Chowk', locality: 'Viman Nagar', pincode: '411014', location: { lat: 18.5679, lng: 73.9143 }, pricePerKwh: 20, rating: 4.0, ratingCount: 187, queueLength: 0, amenities: ['Wi-Fi'], banks: [bank('CCS2', 60, 'FF'), bank('CHAdeMO', 50, 'O')] },
  { id: 'st-09', name: 'Sahyadri Charge Kothrud', operator: 'Sahyadri Charge', line1: 'Karve Rd, near Kothrud Depot', locality: 'Kothrud', pincode: '411038', location: { lat: 18.5074, lng: 73.8077 }, pricePerKwh: 17, rating: 4.3, ratingCount: 258, queueLength: 0, amenities: ['Restroom'], banks: [bank('CCS2', 60, 'FF'), bank('Type2', 22, 'O')] },
  { id: 'st-10', name: 'CityGrid Wakad', operator: 'CityGrid', line1: 'Dange Chowk Rd', locality: 'Wakad', pincode: '411057', location: { lat: 18.5986, lng: 73.7614 }, pricePerKwh: 19, rating: 3.9, ratingCount: 121, queueLength: 5, amenities: [], banks: [bank('CCS2', 120, 'OO')] },
  { id: 'st-11', name: 'CityGrid Swargate', operator: 'CityGrid', line1: 'Shankarsheth Rd, Swargate Depot', locality: 'Swargate', pincode: '411042', location: { lat: 18.5018, lng: 73.8636 }, pricePerKwh: 13, rating: 3.4, ratingCount: 210, queueLength: 2, amenities: ['Bus depot'], banks: [bank('Bharat-DC-001', 15, 'OOO')] },
  { id: 'st-12', name: 'VoltVan Katraj', operator: 'VoltVan', line1: 'Pune–Satara Rd, Katraj Chowk', locality: 'Katraj', pincode: '411046', location: { lat: 18.4529, lng: 73.8573 }, pricePerKwh: 21.5, rating: 4.4, ratingCount: 164, queueLength: 0, amenities: ['Café', 'Restroom'], banks: [bank('CCS2', 60, 'FO'), bank('CHAdeMO', 50, 'F')] },
  { id: 'st-13', name: 'AmpYard Kharadi', operator: 'AmpYard', line1: 'EON IT Park Rd', locality: 'Kharadi', pincode: '411014', location: { lat: 18.5515, lng: 73.9476 }, pricePerKwh: 18, rating: 4.0, ratingCount: 299, queueLength: 1, amenities: ['Food court'], banks: [bank('CCS2', 60, 'OOOX')] },
  { id: 'st-14', name: 'GreenPlug Aundh', operator: 'GreenPlug', line1: 'ITI Rd', locality: 'Aundh', pincode: '411007', location: { lat: 18.558, lng: 73.8075 }, pricePerKwh: 20.5, rating: 4.2, ratingCount: 140, queueLength: 0, amenities: ['Wi-Fi', 'Restroom'], banks: [bank('Type2', 22, 'FF'), bank('Bharat-AC-001', 3.3, 'FO')] },
  { id: 'st-15', name: 'Sahyadri Charge Kondhwa', operator: 'Sahyadri Charge', line1: 'NIBM Rd', locality: 'Kondhwa', pincode: '411048', location: { lat: 18.4734, lng: 73.892 }, pricePerKwh: 16, rating: 3.8, ratingCount: 77, queueLength: 0, amenities: [], banks: [bank('Bharat-DC-001', 15, 'XX')] },
];

/** Expand a seed the way the server's virtuals would (totalPorts, freePorts, connectorTypes). */
function build({ banks, line1, locality, pincode, ...rest }: Seed): Station {
  const ports = banks.flat().map((p, index) => ({ ...p, index }));
  return {
    ...rest,
    address: { line1, locality, city: 'Pune', state: 'Maharashtra', pincode },
    ports,
    totalPorts: ports.length,
    freePorts: ports.filter((p) => p.status === 'free').length,
    connectorTypes: [...new Set(ports.map((p) => p.connectorType))],
    isActive: true,
  };
}

export const STATIONS: Station[] = SEEDS.map(build);

// ─── Service functions (swap these bodies for real requests) ───────────────

export async function listStations(query: StationQuery = {}): Promise<Station[]> {
  return STATIONS.filter(
    (s) =>
      (!query.city || s.address.city.toLowerCase() === query.city.toLowerCase()) &&
      (!query.connectorType || s.connectorTypes.includes(query.connectorType)),
  );
}

export async function getStation(id: string): Promise<Station | null> {
  return STATIONS.find((s) => s.id === id) ?? null;
}
