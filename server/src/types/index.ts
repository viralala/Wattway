/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * types/index.ts — the vocabulary shared across modules.
 *
 * If the routing module and the queue module both need to talk about a
 * station, they talk about it in these terms. Add to this file rather than
 * redefining a near-identical interface inside your own module.
 * ---------------------------------------------------------------------------
 */

import type { LatLng } from '../utils/geo';

// ─── Users ──────────────────────────────────────────────────────────────────

export const USER_ROLES = ['driver', 'operator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** What the auth middleware attaches to `req.user` once a token checks out. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  tokenVersion: number;
}

// ─── Connectors & ports ─────────────────────────────────────────────────────

export const CONNECTOR_TYPES = [
  'CCS2',
  'CHAdeMO',
  'Type2',
  'GB/T',
  'Bharat-AC-001',
  'Bharat-DC-001',
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/**
 * PRD Section 5 maps the Array to the "slot-status board per station (fixed-size
 * array of port states: free / occupied / faulted)".
 */
export const PORT_STATUSES = ['free', 'occupied', 'faulted'] as const;
export type PortStatus = (typeof PORT_STATUSES)[number];

export interface Port {
  /** Position in the station's fixed-size port array. O(1) addressable. */
  index: number;
  connectorType: ConnectorType;
  powerKw: number;
  status: PortStatus;
  /** Set by the queue module when a session starts. */
  occupiedSince?: Date | null;
}

// ─── Stations ───────────────────────────────────────────────────────────────

export interface StationAddress {
  line1: string;
  locality: string;
  city: string;
  state: string;
  pincode?: string;
}

/**
 * The flattened, read-only projection of a station that lives inside the
 * in-memory index (BST buckets and Trie payloads).
 *
 * It is deliberately NOT a Mongoose document: the index holds thousands of
 * these and must stay cheap to build, cheap to copy and free of any live
 * database handle.
 */
export interface IndexedStation {
  id: string;
  name: string;
  operator: string;
  address: StationAddress;
  location: LatLng;
  /** BST key #1 — rupees per kWh. */
  pricePerKwh: number;
  /** BST key #2 — mean of submitted ratings, 0 when unrated. */
  rating: number;
  ratingCount: number;
  connectorTypes: ConnectorType[];
  totalPorts: number;
  freePorts: number;
  /** Maintained by the queue module; 0 until that module lands. */
  queueLength: number;
  amenities: string[];
  isActive: boolean;
}

/** A station as returned to clients, with per-request extras folded in. */
export interface StationResult extends IndexedStation {
  /** Straight-line km from the caller's position, when one was supplied. */
  distanceKm?: number;
  /** Composite relevance/recommendation score, when the result was ranked. */
  score?: number;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface AutocompleteSuggestion {
  id: string;
  name: string;
  locality: string;
  city: string;
  /** The normalised indexed term that matched the prefix. */
  matchedTerm: string;
  score: number;
  location: LatLng;
  pricePerKwh: number;
  rating: number;
}

export interface RangeSearchCriteria {
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  maxRating?: number;
  connectorType?: ConnectorType;
  city?: string;
  /** Caller position, enabling `radiusKm` and distance-aware sorting. */
  near?: LatLng;
  radiusKm?: number;
  onlyWithFreePorts?: boolean;
  sort?: RangeSortKey;
  page?: number;
  limit?: number;
}

export const RANGE_SORT_KEYS = [
  'price_asc',
  'price_desc',
  'rating_desc',
  'distance_asc',
  'free_ports_desc',
] as const;
export type RangeSortKey = (typeof RANGE_SORT_KEYS)[number];

/** What the range query reports about how it got its answer. */
export interface RangeSearchExplain {
  /** Which BST drove the scan. */
  drivingIndex: 'price' | 'rating';
  /** Why that index was chosen over the other. */
  reason: string;
  /** Candidates the BST returned before the secondary filters ran. */
  candidatesScanned: number;
  /** Results surviving every filter. */
  matched: number;
  /** True when the index scan already emitted the requested order, so no sort ran. */
  sortedByIndexScan: boolean;
  tookMs: number;
}
