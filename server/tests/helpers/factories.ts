/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * factories.ts — test fixtures.
 *
 * One place to build a valid station or user, so a schema change breaks one
 * file rather than every test. Everything takes an overrides object, so a test
 * states only the field it actually cares about.
 * ---------------------------------------------------------------------------
 */

import type { ConnectorType, IndexedStation, Port } from '../../src/types';

let sequence = 0;

/** A unique, well-formed UUID (v4 shape), so tests never collide and zId accepts it. */
export function testId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

export function makePorts(
  count: number,
  free = count,
  connectorType: ConnectorType = 'CCS2',
): Port[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    connectorType,
    powerKw: 60,
    status: index < free ? ('free' as const) : ('occupied' as const),
    occupiedSince: null,
  }));
}

export function makeIndexedStation(overrides: Partial<IndexedStation> = {}): IndexedStation {
  const id = overrides.id ?? testId();
  return {
    id,
    name: `Station ${id.slice(-4)}`,
    operator: 'Tata Power',
    address: {
      line1: '1 Test Road',
      locality: 'Andheri',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400053',
    },
    location: { lat: 19.119, lng: 72.8465 },
    pricePerKwh: 12,
    rating: 4,
    ratingCount: 10,
    connectorTypes: ['CCS2'],
    totalPorts: 4,
    freePorts: 2,
    queueLength: 0,
    amenities: [],
    isActive: true,
    ...overrides,
  };
}

/** A station payload shaped for `POST /api/stations`. */
export function makeStationBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Test Station ${testId().slice(-6)}`,
    operator: 'Tata Power',
    address: {
      line1: '1 Test Road',
      locality: 'Andheri',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400053',
    },
    location: { lat: 19.119, lng: 72.8465 },
    pricePerKwh: 12.5,
    ports: [
      { connectorType: 'CCS2', powerKw: 60 },
      { connectorType: 'Type2', powerKw: 22 },
    ],
    amenities: ['restroom'],
    ...overrides,
  };
}

export function makeUserBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = testId().slice(-8);
  return {
    name: 'Test Driver',
    email: `driver-${id}@wattway.test`,
    password: 'kothimbir123',
    ...overrides,
  };
}
