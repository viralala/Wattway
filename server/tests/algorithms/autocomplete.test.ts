/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * autocomplete.test.ts — Trie search plus the query-dependent re-rank.
 * ---------------------------------------------------------------------------
 */

import { Trie } from '../../src/datastructures/Trie';
import { autocomplete } from '../../src/algorithms/autocomplete';
import { StationIndex } from '../../src/services/stationIndex';
import { makeIndexedStation } from '../helpers/factories';
import type { IndexedStation } from '../../src/types';

const MUMBAI = { lat: 19.076, lng: 72.8777 };
const PUNE = { lat: 18.5204, lng: 73.8567 };

function indexOf(stations: IndexedStation[]): Trie<IndexedStation> {
  const trie = new Trie<IndexedStation>();
  for (const station of stations) {
    const score = StationIndex.scoreOf(station);
    for (const term of [station.name, station.address.locality, station.address.city]) {
      trie.insertPhrase(term, { id: station.id, value: station, score });
    }
  }
  return trie;
}

const stations: IndexedStation[] = [
  makeIndexedStation({ id: 'a', name: 'Andheri Metro Hub', rating: 4.6, ratingCount: 120 }),
  makeIndexedStation({ id: 'b', name: 'Andheri East Plaza', rating: 3.9, ratingCount: 40 }),
  makeIndexedStation({
    id: 'c',
    name: 'Tata Power Andheri',
    rating: 4.2,
    ratingCount: 80,
  }),
  makeIndexedStation({
    id: 'd',
    name: 'Bandra Kurla Complex',
    rating: 4.8,
    ratingCount: 300,
    address: {
      line1: '5 BKC Road',
      locality: 'Bandra',
      city: 'Mumbai',
      state: 'Maharashtra',
    },
  }),
];

describe('autocomplete — query handling', () => {
  const index = indexOf(stations);

  it('ignores a query shorter than two characters', () => {
    expect(autocomplete({ index, query: 'a' }).suggestions).toEqual([]);
    expect(autocomplete({ index, query: '' }).suggestions).toEqual([]);
    expect(autocomplete({ index, query: '   ' }).suggestions).toEqual([]);
  });

  it('normalises the query the same way the trie normalised its terms', () => {
    const plain = autocomplete({ index, query: 'andheri' });
    const shouty = autocomplete({ index, query: '  ANDHÉRI!! ' });
    expect(shouty.explain.normalisedQuery).toBe('andheri');
    expect(shouty.suggestions.map((s) => s.id)).toEqual(plain.suggestions.map((s) => s.id));
  });

  it('returns nothing for a prefix that matches nothing', () => {
    const result = autocomplete({ index, query: 'zzzz' });
    expect(result.suggestions).toEqual([]);
    expect(result.explain.prefixMatches).toBe(0);
  });

  it('respects the limit and caps it', () => {
    expect(autocomplete({ index, query: 'and', limit: 2 }).suggestions).toHaveLength(2);
    expect(autocomplete({ index, query: 'and', limit: 999 }).suggestions.length).toBeLessThanOrEqual(
      25,
    );
  });

  it('reports how much work it did', () => {
    const result = autocomplete({ index, query: 'andheri' });
    expect(result.explain.prefixMatches).toBeGreaterThan(0);
    expect(result.explain.candidatesConsidered).toBeGreaterThanOrEqual(
      result.explain.returned,
    );
    expect(result.explain.tookMs).toBeGreaterThanOrEqual(0);
  });
});

describe('autocomplete — ranking', () => {
  const index = indexOf(stations);

  it('puts a name-prefix match above an incidental word match', () => {
    const result = autocomplete({ index, query: 'andheri' });
    const ids = result.suggestions.map((s) => s.id);
    // 'Andheri Metro Hub' and 'Andheri East Plaza' start with the query;
    // 'Tata Power Andheri' only contains it.
    expect(ids.indexOf('c')).toBeGreaterThan(ids.indexOf('a'));
  });

  it('de-duplicates a station indexed under several terms', () => {
    const result = autocomplete({ index, query: 'andheri' });
    const ids = result.suggestions.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prefers a nearby station over an identical distant one', () => {
    const near = makeIndexedStation({ id: 'near', name: 'Powai Charge', location: MUMBAI });
    const far = makeIndexedStation({ id: 'far', name: 'Powai Charge Two', location: PUNE });
    const trie = indexOf([near, far]);

    const withPosition = autocomplete({ index: trie, query: 'powai', near: MUMBAI });
    expect(withPosition.suggestions[0].id).toBe('near');
  });

  it('does not use distance when no position is supplied', () => {
    const near = makeIndexedStation({
      id: 'near',
      name: 'Powai Charge',
      location: MUMBAI,
      rating: 2,
      ratingCount: 100,
    });
    const far = makeIndexedStation({
      id: 'far',
      name: 'Powai Charge Two',
      location: PUNE,
      rating: 5,
      ratingCount: 100,
    });
    const trie = indexOf([near, far]);

    // Without a position the better-rated station wins despite being farther.
    expect(autocomplete({ index: trie, query: 'powai' }).suggestions[0].id).toBe('far');
  });

  it('rewards an exact term match', () => {
    const result = autocomplete({ index, query: 'bandra' });
    expect(result.suggestions[0].id).toBe('d');
    expect(result.suggestions[0].matchedTerm).toBe('bandra');
  });

  it('returns a suggestion shaped for the dropdown', () => {
    const [first] = autocomplete({ index, query: 'bandra' }).suggestions;
    expect(first).toMatchObject({
      id: 'd',
      name: 'Bandra Kurla Complex',
      locality: 'Bandra',
      city: 'Mumbai',
    });
    expect(typeof first.score).toBe('number');
    expect(first.location).toEqual(expect.objectContaining({ lat: expect.any(Number) }));
  });

  it('narrows as the user keeps typing', () => {
    const broad = autocomplete({ index, query: 'an' }).suggestions.length;
    const narrow = autocomplete({ index, query: 'andheri e' }).suggestions.length;
    expect(narrow).toBeLessThanOrEqual(broad);
    expect(autocomplete({ index, query: 'andheri e' }).suggestions[0].id).toBe('b');
  });
});

describe('StationIndex.scoreOf — the intrinsic quality signal', () => {
  it('damps a great rating backed by almost no reviews', () => {
    const trusted = makeIndexedStation({ rating: 4.6, ratingCount: 400 });
    const suspicious = makeIndexedStation({ rating: 5, ratingCount: 1 });
    expect(StationIndex.scoreOf(trusted)).toBeGreaterThan(StationIndex.scoreOf(suspicious));
  });

  it('rewards free ports', () => {
    const open = makeIndexedStation({ freePorts: 4, totalPorts: 4 });
    const full = makeIndexedStation({ freePorts: 0, totalPorts: 4 });
    expect(StationIndex.scoreOf(open)).toBeGreaterThan(StationIndex.scoreOf(full));
  });

  it('penalises a long queue, with diminishing effect', () => {
    const empty = makeIndexedStation({ queueLength: 0 });
    const oneWaiting = makeIndexedStation({ queueLength: 1 });
    const tenWaiting = makeIndexedStation({ queueLength: 10 });

    const firstCarCost = StationIndex.scoreOf(empty) - StationIndex.scoreOf(oneWaiting);
    const tenthCarCost =
      StationIndex.scoreOf(makeIndexedStation({ queueLength: 9 })) -
      StationIndex.scoreOf(tenWaiting);

    expect(StationIndex.scoreOf(empty)).toBeGreaterThan(StationIndex.scoreOf(tenWaiting));
    expect(firstCarCost).toBeGreaterThan(tenthCarCost);
  });

  it('never returns a non-positive score, which would break trie pruning', () => {
    const worst = makeIndexedStation({
      rating: 0,
      ratingCount: 0,
      freePorts: 0,
      totalPorts: 0,
      queueLength: 999,
    });
    expect(StationIndex.scoreOf(worst)).toBeGreaterThan(0);
  });
});
