/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * rangeQuery.test.ts — the BST-backed search, tested without a database.
 * ---------------------------------------------------------------------------
 */

import { BST } from '../../src/datastructures/BST';
import { rangeQuery } from '../../src/algorithms/rangeQuery';
import { makeIndexedStation } from '../helpers/factories';
import type { IndexedStation } from '../../src/types';

const MUMBAI = { lat: 19.076, lng: 72.8777 };
const PUNE = { lat: 18.5204, lng: 73.8567 }; // ~120 km from Mumbai

function fixture(): IndexedStation[] {
  return [
    makeIndexedStation({ id: 'a', name: 'Cheap Andheri', pricePerKwh: 7, rating: 3.0 }),
    makeIndexedStation({ id: 'b', name: 'Mid Bandra', pricePerKwh: 10, rating: 4.5 }),
    makeIndexedStation({ id: 'c', name: 'Mid Colaba', pricePerKwh: 10, rating: 2.5 }),
    makeIndexedStation({ id: 'd', name: 'Premium Worli', pricePerKwh: 18, rating: 4.8 }),
    makeIndexedStation({
      id: 'e',
      name: 'Pune Hub',
      pricePerKwh: 12,
      rating: 4.0,
      location: PUNE,
      address: {
        line1: '9 FC Road',
        locality: 'Shivajinagar',
        city: 'Pune',
        state: 'Maharashtra',
      },
    }),
    makeIndexedStation({
      id: 'f',
      name: 'Full House',
      pricePerKwh: 9,
      rating: 4.2,
      freePorts: 0,
      queueLength: 6,
    }),
    makeIndexedStation({
      id: 'g',
      name: 'Retired Station',
      pricePerKwh: 5,
      rating: 5,
      isActive: false,
    }),
    makeIndexedStation({
      id: 'h',
      name: 'CHAdeMO Only',
      pricePerKwh: 11,
      rating: 3.8,
      connectorTypes: ['CHAdeMO'],
    }),
  ];
}

function run(criteria: Parameters<typeof rangeQuery>[0]['criteria']) {
  const stations = fixture();
  // `isActive: false` rows never reach the index in production; mirror that.
  const active = stations.filter((station) => station.isActive);
  return rangeQuery({
    priceIndex: BST.build(active, (station) => station.pricePerKwh),
    ratingIndex: BST.build(active, (station) => station.rating),
    criteria,
  });
}

describe('rangeQuery — price bounds', () => {
  it('returns stations inside a price band, cheapest first', () => {
    const result = run({ minPrice: 9, maxPrice: 12 });
    expect(result.stations.map((s) => s.id)).toEqual(['f', 'b', 'c', 'h', 'e']);
    expect(result.total).toBe(5);
  });

  it('treats an open lower or upper bound as unbounded', () => {
    expect(run({ maxPrice: 8 }).stations.map((s) => s.id)).toEqual(['a']);
    expect(run({ minPrice: 12 }).stations.map((s) => s.id)).toEqual(['e', 'd']);
  });

  it('returns nothing for an impossible band and says why', () => {
    const result = run({ minPrice: 20, maxPrice: 10 });
    expect(result.stations).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.explain.reason).toMatch(/exceeds/i);
  });

  it('excludes inactive stations even if they match the bound', () => {
    const result = run({ minPrice: 0, maxPrice: 100 });
    expect(result.stations.map((s) => s.id)).not.toContain('g');
  });
});

describe('rangeQuery — rating bounds', () => {
  it('returns stations above a rating floor, best first', () => {
    const result = run({ minRating: 4, sort: 'rating_desc' });
    expect(result.stations.map((s) => s.id)).toEqual(['d', 'b', 'f', 'e']);
  });

  it('applies a rating ceiling too', () => {
    expect(run({ maxRating: 3 }).stations.map((s) => s.id).sort()).toEqual(['a', 'c']);
  });
});

describe('rangeQuery — the index planner', () => {
  it('drives on the price index when only price is bounded', () => {
    expect(run({ minPrice: 9 }).explain.drivingIndex).toBe('price');
  });

  it('drives on the rating index when only rating is bounded', () => {
    expect(run({ minRating: 4 }).explain.drivingIndex).toBe('rating');
  });

  it('picks the more selective index when both are bounded', () => {
    // Price 0-100 matches everything; rating 4.8-5 matches one station.
    const result = run({ minPrice: 0, maxPrice: 100, minRating: 4.8, maxRating: 5 });
    expect(result.explain.drivingIndex).toBe('rating');
    expect(result.explain.reason).toMatch(/more selective/i);
    expect(result.stations.map((s) => s.id)).toEqual(['d']);

    // And the other way round.
    const flipped = run({ minPrice: 17.5, maxPrice: 18.5, minRating: 0, maxRating: 5 });
    expect(flipped.explain.drivingIndex).toBe('price');
    expect(flipped.stations.map((s) => s.id)).toEqual(['d']);
  });

  it('scans fewer candidates than the full dataset when a bound is selective', () => {
    const result = run({ minPrice: 0, maxPrice: 100, minRating: 4.8, maxRating: 5 });
    expect(result.explain.candidatesScanned).toBeLessThan(7);
    expect(result.explain.matched).toBe(1);
  });

  it('skips the sort when the scan already produced the requested order', () => {
    expect(run({ minPrice: 0, maxPrice: 100, sort: 'price_asc' }).explain.sortedByIndexScan).toBe(
      true,
    );
    expect(run({ minPrice: 0, maxPrice: 100, sort: 'price_desc' }).explain.sortedByIndexScan).toBe(
      true,
    );
    // Distance is not an index key, so this one has to sort.
    expect(
      run({ minPrice: 0, maxPrice: 100, sort: 'distance_asc', near: MUMBAI }).explain
        .sortedByIndexScan,
    ).toBe(false);
  });
});

describe('rangeQuery — residual filters', () => {
  it('filters by connector type', () => {
    const result = run({ connectorType: 'CHAdeMO' });
    expect(result.stations.map((s) => s.id)).toEqual(['h']);
  });

  it('filters by city, case-insensitively', () => {
    expect(run({ city: 'pune' }).stations.map((s) => s.id)).toEqual(['e']);
    expect(run({ city: 'PUNE' }).stations.map((s) => s.id)).toEqual(['e']);
  });

  it('filters out stations with no free port when asked', () => {
    const result = run({ onlyWithFreePorts: true });
    expect(result.stations.map((s) => s.id)).not.toContain('f');
  });

  it('filters by radius and reports distance', () => {
    const result = run({ near: MUMBAI, radiusKm: 50 });
    expect(result.stations.map((s) => s.id)).not.toContain('e'); // Pune is ~120 km
    for (const station of result.stations) {
      expect(station.distanceKm).toBeLessThanOrEqual(50);
    }
  });

  it('combines every filter at once', () => {
    const result = run({
      minPrice: 9,
      maxPrice: 13,
      minRating: 4,
      onlyWithFreePorts: true,
      city: 'Mumbai',
      near: MUMBAI,
      radiusKm: 100,
    });
    expect(result.stations.map((s) => s.id)).toEqual(['b']);
  });
});

describe('rangeQuery — ordering', () => {
  it('sorts by distance when a position is given', () => {
    const result = run({ near: MUMBAI, sort: 'distance_asc' });
    const distances = result.stations.map((s) => s.distanceKm ?? 0);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(result.stations[result.stations.length - 1].id).toBe('e'); // Pune, farthest
  });

  it('breaks a rating tie on how many ratings backed it', () => {
    const stations = [
      makeIndexedStation({ id: 'x', pricePerKwh: 10, rating: 4.5, ratingCount: 2 }),
      makeIndexedStation({ id: 'y', pricePerKwh: 11, rating: 4.5, ratingCount: 300 }),
    ];
    const result = rangeQuery({
      priceIndex: BST.build(stations, (s) => s.pricePerKwh),
      ratingIndex: BST.build(stations, (s) => s.rating),
      criteria: { sort: 'rating_desc' },
    });
    expect(result.stations.map((s) => s.id)).toEqual(['y', 'x']);
  });

  it('sorts by free ports, breaking ties on the shorter queue', () => {
    const result = run({ sort: 'free_ports_desc' });
    expect(result.stations[result.stations.length - 1].id).toBe('f'); // zero free
  });
});

describe('rangeQuery — pagination', () => {
  it('paginates while reporting the full total', () => {
    const first = run({ minPrice: 0, maxPrice: 100, limit: 2, page: 1 });
    const second = run({ minPrice: 0, maxPrice: 100, limit: 2, page: 2 });

    expect(first.stations).toHaveLength(2);
    expect(second.stations).toHaveLength(2);
    expect(first.total).toBe(7);
    expect(second.total).toBe(7);
    // No overlap between pages.
    expect(first.stations.map((s) => s.id)).not.toEqual(second.stations.map((s) => s.id));
  });

  it('returns an empty page past the end without failing', () => {
    const result = run({ minPrice: 0, maxPrice: 100, limit: 20, page: 99 });
    expect(result.stations).toEqual([]);
    expect(result.total).toBe(7);
  });
});
