/**
 * WattWay · Team Kothimbir 🌿
 * stations.ts — station data for the map, from the live API.
 *
 * `GET /api/stations` is the source of truth. The server's shapes
 * (`IndexedStation`, and the full document from `GET /api/stations/:id`) are
 * mapped onto the client `Station` by `mapServerStation`, so pages never see
 * the wire format. If the API can't be reached (no network, a 5xx, or a host
 * that doesn't serve /api), the sample stations below are used instead and
 * `offline: true` is reported so pages can say so.
 *
 * Sample operators and stations are fictional; coordinates are real Pune
 * localities.
 */
import { ApiRequestError, isUnreachable, request } from './api';

export const CONNECTOR_TYPES = ['CCS2', 'CHAdeMO', 'Type2', 'GB/T', 'Bharat-AC-001', 'Bharat-DC-001'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
export type PortStatus = 'free' | 'occupied' | 'faulted';

export interface Port {
  index: number;
  connectorType: ConnectorType;
  powerKw: number;
  status: PortStatus;
  /** ISO time the current session started (live API only). */
  occupiedSince?: string | null;
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
  /** True when `ports` was rebuilt from the counts because the list endpoint doesn't carry the board. */
  portsApprox?: boolean;
}

export interface StationQuery {
  city?: string;
  connectorType?: ConnectorType;
  operator?: string;
}

/** Where the map says "you are here": VIT Pune, Bibwewadi. */
export const HOME: LatLng & { label: string } = { lat: 18.4636, lng: 73.8681, label: 'You · VIT Bibwewadi' };

// ─── Sample data ────────────────────────────────────────────────────────────

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

export const SAMPLE_STATIONS: Station[] = SEEDS.map(build);

// ─── Server → client mapping ───────────────────────────────────────────────

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null;
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

const TYPICAL_KW: Record<ConnectorType, number> = {
  CCS2: 60,
  CHAdeMO: 50,
  Type2: 22,
  'GB/T': 50,
  'Bharat-AC-001': 3.3,
  'Bharat-DC-001': 15,
};

const asConnector = (v: unknown): ConnectorType =>
  (CONNECTOR_TYPES as readonly string[]).includes(v as string) ? (v as ConnectorType) : 'Type2';

/** free stays free, occupied/busy/charging are occupied, anything else (faulted, offline…) is faulted. */
export function toPortStatus(v: unknown): PortStatus {
  if (v === 'free') return 'free';
  if (v === 'occupied' || v === 'busy' || v === 'charging') return 'occupied';
  return 'faulted';
}

function readLocation(v: unknown): LatLng {
  if (isObj(v)) {
    if (Array.isArray(v.coordinates)) return { lat: num(v.coordinates[1]), lng: num(v.coordinates[0]) };
    return { lat: num(v.lat), lng: num(v.lng) };
  }
  return { lat: 0, lng: 0 };
}

function readPorts(v: unknown): Port[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((p, i) => ({
    index: num(p.index, i),
    connectorType: asConnector(p.connectorType),
    powerKw: num(p.powerKw, 22),
    status: toPortStatus(p.status),
    occupiedSince: typeof p.occupiedSince === 'string' ? p.occupiedSince : null,
  }));
}

/** The list endpoint sends counts, not the board. Rebuild a plausible one: free ports first. */
function approxPorts(types: ConnectorType[], total: number, free: number): Port[] {
  const kinds = types.length > 0 ? types : (['Type2'] as ConnectorType[]);
  return Array.from({ length: total }, (_, index) => {
    const connectorType = kinds[index % kinds.length];
    return { index, connectorType, powerKw: TYPICAL_KW[connectorType], status: index < free ? ('free' as const) : ('occupied' as const) };
  });
}

/**
 * Turn whatever the server sent (the flat list item or the full station
 * document: GeoJSON location, `{ average, count }` rating, ports) into the
 * client `Station`.
 */
export function mapServerStation(input: unknown): Station {
  const raw: Raw = isObj(input) ? input : {};
  const address = isObj(raw.address) ? raw.address : {};
  const ratingRaw = raw.rating;
  const rating = isObj(ratingRaw) ? num(ratingRaw.average) : num(ratingRaw);
  const ratingCount = isObj(ratingRaw) ? num(ratingRaw.count) : num(raw.ratingCount);

  let ports = readPorts(raw.ports);
  const listedTypes = Array.isArray(raw.connectorTypes) ? raw.connectorTypes.map(asConnector) : [];
  let portsApprox = false;
  if (ports.length === 0 && num(raw.totalPorts) > 0) {
    ports = approxPorts(listedTypes, num(raw.totalPorts), num(raw.freePorts));
    portsApprox = true;
  }

  const connectorTypes = listedTypes.length > 0 ? [...new Set(listedTypes)] : [...new Set(ports.map((p) => p.connectorType))];
  const station: Station = {
    id: str(raw.id) || str(raw._id),
    name: str(raw.name),
    operator: str(raw.operator),
    address: {
      line1: str(address.line1),
      locality: str(address.locality),
      city: str(address.city),
      state: str(address.state),
      ...(typeof address.pincode === 'string' ? { pincode: address.pincode } : {}),
    },
    location: readLocation(raw.location),
    pricePerKwh: num(raw.pricePerKwh),
    rating,
    ratingCount,
    connectorTypes,
    totalPorts: ports.length > 0 ? ports.length : num(raw.totalPorts),
    freePorts: ports.length > 0 && !portsApprox ? ports.filter((p) => p.status === 'free').length : num(raw.freePorts),
    queueLength: num(raw.queueLength),
    amenities: Array.isArray(raw.amenities) ? raw.amenities.filter((a): a is string => typeof a === 'string') : [],
    isActive: raw.isActive !== false,
    ports,
  };
  if (portsApprox) station.portsApprox = true;
  return station;
}

// ─── Service functions ──────────────────────────────────────────────────────

export interface StationList {
  stations: Station[];
  /** True when the API was unreachable and these are the built-in sample stations. */
  offline: boolean;
}

const PAGE = 100;
const LIVE_TTL_MS = 20_000;
const OFFLINE_TTL_MS = 5_000;

async function fetchAllStations(): Promise<Station[]> {
  const out: Station[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const data = await request<{ stations: unknown[] }>(`/api/stations?limit=${PAGE}&page=${page}`);
    const batch = Array.isArray(data?.stations) ? data.stations : [];
    out.push(...batch.map(mapServerStation));
    if (batch.length < PAGE) break;
  }
  return out;
}

let cache: { at: number; ttl: number; value: Promise<StationList> } | null = null;

/** Every active station from the API, or the sample set (flagged `offline`) when it's unreachable. Cached briefly and shared by all pages. */
export function loadStations(options: { force?: boolean } = {}): Promise<StationList> {
  if (!options.force && cache && Date.now() - cache.at < cache.ttl) return cache.value;
  const entry = { at: Date.now(), ttl: LIVE_TTL_MS, value: null as unknown as Promise<StationList> };
  entry.value = fetchAllStations().then(
    (stations): StationList => ({ stations, offline: false }),
    (error): StationList => {
      if (!isUnreachable(error)) {
        if (cache === entry) cache = null;
        throw error;
      }
      entry.ttl = OFFLINE_TTL_MS;
      return { stations: SAMPLE_STATIONS, offline: true };
    },
  );
  cache = entry;
  return entry.value;
}

export function clearStationCache() {
  cache = null;
}

const matches = (s: Station, q: StationQuery) =>
  (!q.city || s.address.city.toLowerCase() === q.city.toLowerCase()) &&
  (!q.operator || s.operator.toLowerCase() === q.operator.toLowerCase()) &&
  (!q.connectorType || s.connectorTypes.includes(q.connectorType));

export async function listStations(query: StationQuery = {}): Promise<Station[]> {
  return (await loadStations()).stations.filter((s) => matches(s, query));
}

/** One station with its real port board. `null` when it doesn't exist. */
export async function getStation(id: string): Promise<Station | null> {
  const { stations, offline } = await loadStations();
  const listed = stations.find((s) => s.id === id);
  if (offline) return listed ?? null;
  try {
    const data = await request<{ station: unknown }>(`/api/stations/${encodeURIComponent(id)}`);
    const detail = mapServerStation(data.station);
    // The detail document has the board but not the live queue length.
    return listed ? { ...detail, queueLength: listed.queueLength } : detail;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    if (isUnreachable(error)) return listed ?? null;
    throw error;
  }
}
