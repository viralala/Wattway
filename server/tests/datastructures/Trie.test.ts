/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Trie.test.ts
 *
 * PRD Section 11: "Each custom data structure ships with unit tests
 *                  demonstrating correctness independent of the web app."
 * ---------------------------------------------------------------------------
 */

import { Trie } from '../../src/datastructures/Trie';

interface Station {
  id: string;
  name: string;
}

const s = (id: string, name: string): Station => ({ id, name });

function seeded(): Trie<Station> {
  const trie = new Trie<Station>();
  trie.insert('Andheri East', { id: '1', value: s('1', 'Andheri East'), score: 0.9 });
  trie.insert('Andheri West', { id: '2', value: s('2', 'Andheri West'), score: 0.7 });
  trie.insert('Andaman Plaza', { id: '3', value: s('3', 'Andaman Plaza'), score: 0.8 });
  trie.insert('Bandra Kurla', { id: '4', value: s('4', 'Bandra Kurla'), score: 0.95 });
  return trie;
}

describe('Trie — normalisation', () => {
  it('folds case, punctuation and diacritics to one key', () => {
    expect(Trie.normalise('Tata Power - Andhèri (West)')).toBe('tata power andheri west');
    expect(Trie.normalise('ANDHERI')).toBe('andheri');
    expect(Trie.normalise('  spaced   out  ')).toBe('spaced out');
    expect(Trie.normalise('!!!')).toBe('');
  });

  it('tokenises, dropping single characters', () => {
    expect(Trie.tokenise('Tata Power A Andheri')).toEqual(['tata', 'power', 'andheri']);
    expect(Trie.tokenise('---')).toEqual([]);
  });

  it('treats differently-cased spellings as the same term', () => {
    const trie = new Trie<Station>();
    trie.insert('Andheri', { id: '1', value: s('1', 'Andheri'), score: 1 });
    trie.insert('ANDHERI', { id: '2', value: s('2', 'ANDHERI'), score: 1 });
    expect(trie.size).toBe(1); // one term
    expect(trie.entries).toBe(2); // two stations under it
  });
});

describe('Trie — insert and lookup', () => {
  it('starts empty', () => {
    const trie = new Trie<Station>();
    expect(trie.isEmpty).toBe(true);
    expect(trie.size).toBe(0);
    expect(trie.suggest('anything')).toEqual([]);
  });

  it('ignores a term that normalises to nothing', () => {
    const trie = new Trie<Station>();
    trie.insert('!!!', { id: '1', value: s('1', 'x'), score: 1 });
    expect(trie.isEmpty).toBe(true);
  });

  it('finds exact terms', () => {
    const trie = seeded();
    expect(trie.search('andheri east').map((v) => v.id)).toEqual(['1']);
    expect(trie.search('ANDHERI EAST').map((v) => v.id)).toEqual(['1']);
    expect(trie.search('andheri')).toEqual([]); // a prefix is not a term
    expect(trie.hasTerm('andheri east')).toBe(true);
    expect(trie.hasTerm('andheri')).toBe(false);
  });

  it('distinguishes a prefix from a term', () => {
    const trie = seeded();
    expect(trie.hasPrefix('and')).toBe(true);
    expect(trie.hasPrefix('zzz')).toBe(false);
  });

  it('counts entries under a prefix in O(L)', () => {
    const trie = seeded();
    expect(trie.countWithPrefix('and')).toBe(3); // two Andheris + Andaman
    expect(trie.countWithPrefix('andheri')).toBe(2);
    expect(trie.countWithPrefix('b')).toBe(1);
    expect(trie.countWithPrefix('zzz')).toBe(0);
    expect(trie.countWithPrefix('')).toBe(4); // empty prefix = everything
  });

  it('lists complete terms under a prefix, lexicographically', () => {
    const trie = seeded();
    expect(trie.termsWithPrefix('and')).toEqual([
      'andaman plaza',
      'andheri east',
      'andheri west',
    ]);
  });

  it('overwrites rather than duplicates when the same (term, id) is re-inserted', () => {
    const trie = new Trie<Station>();
    trie.insert('Andheri', { id: '1', value: s('1', 'Andheri'), score: 0.5 });
    trie.insert('Andheri', { id: '1', value: s('1', 'Andheri Renamed'), score: 0.9 });

    expect(trie.entries).toBe(1);
    expect(trie.suggest('and')[0].score).toBe(0.9);
    expect(trie.suggest('and')[0].value.name).toBe('Andheri Renamed');
  });
});

describe('Trie — ranked autocomplete', () => {
  it('returns prefix matches ordered by score', () => {
    const trie = seeded();
    const hits = trie.suggest('and');
    expect(hits.map((h) => h.id)).toEqual(['1', '3', '2']); // 0.9, 0.8, 0.7
  });

  it('narrows as more characters are typed', () => {
    const trie = seeded();
    expect(trie.suggest('a').map((h) => h.id).sort()).toEqual(['1', '2', '3']);
    expect(trie.suggest('andh').map((h) => h.id).sort()).toEqual(['1', '2']);
    expect(trie.suggest('andheri e').map((h) => h.id)).toEqual(['1']);
    expect(trie.suggest('andheri x')).toEqual([]);
  });

  it('respects the limit', () => {
    const trie = seeded();
    expect(trie.suggest('a', 2)).toHaveLength(2);
    expect(trie.suggest('a', 2).map((h) => h.id)).toEqual(['1', '3']); // highest first
    expect(trie.suggest('a', 0)).toEqual([]);
  });

  it('returns the global top-N for an empty prefix', () => {
    const trie = seeded();
    expect(trie.suggest('', 2).map((h) => h.id)).toEqual(['4', '1']); // 0.95, 0.9
  });

  it('de-duplicates by id, keeping the better-scoring term', () => {
    const trie = new Trie<Station>();
    const value = s('1', 'Andheri Metro Hub');
    trie.insert('Andheri Metro Hub', { id: '1', value, score: 0.9 });
    trie.insert('Andheri', { id: '1', value, score: 0.4 });

    const hits = trie.suggest('andheri');
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBe(0.9);
    expect(hits[0].term).toBe('andheri metro hub');
  });

  it('reports which term matched', () => {
    const trie = seeded();
    expect(trie.suggest('bandra')[0].term).toBe('bandra kurla');
  });

  it('agrees with a brute-force prefix scan on random data', () => {
    const trie = new Trie<Station>();
    const words: Array<{ id: string; term: string; score: number }> = [];
    const alphabet = 'abcde';

    for (let i = 0; i < 500; i += 1) {
      const length = 3 + Math.floor(Math.random() * 5);
      let term = '';
      for (let c = 0; c < length; c += 1) {
        term += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      const id = `id${i}`;
      const score = Math.random();
      words.push({ id, term, score });
      trie.insert(term, { id, value: s(id, term), score });
    }

    for (const prefix of ['a', 'ab', 'abc', 'bd', 'e', 'zz']) {
      const expected = words
        .filter((w) => w.term.startsWith(prefix))
        // The trie keeps one entry per (term, id), and ids are unique here.
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((w) => w.id);

      const actual = trie.suggest(prefix, 5).map((h) => h.id);
      expect(actual).toEqual(expected);
    }
  });
});

describe('Trie — phrase indexing', () => {
  it('makes a station findable by any word in its name', () => {
    const trie = new Trie<Station>();
    const value = s('1', 'Tata Power Andheri West');
    trie.insertPhrase('Tata Power Andheri West', { id: '1', value, score: 1 });

    expect(trie.suggest('tata')).toHaveLength(1);
    expect(trie.suggest('power')).toHaveLength(1);
    expect(trie.suggest('andheri')).toHaveLength(1);
    expect(trie.suggest('west')).toHaveLength(1);
    expect(trie.suggest('mumbai')).toEqual([]);
  });

  it('scores the full phrase above an incidental token match', () => {
    const trie = new Trie<Station>();
    trie.insertPhrase('Andheri Hub', { id: '1', value: s('1', 'Andheri Hub'), score: 1 });

    const full = trie.suggest('andheri hub')[0];
    const token = trie.suggest('hub')[0];
    expect(full.score).toBeGreaterThan(token.score);
  });

  it('does not double-index a single-word phrase', () => {
    const trie = new Trie<Station>();
    trie.insertPhrase('Andheri', { id: '1', value: s('1', 'Andheri'), score: 1 });
    expect(trie.termsFor('1')).toEqual(['andheri']);
  });
});

describe('Trie — removal', () => {
  it('removes one (term, id) pair', () => {
    const trie = seeded();
    expect(trie.remove('Andheri East', '1')).toBe(true);
    expect(trie.suggest('andheri').map((h) => h.id)).toEqual(['2']);
    expect(trie.entries).toBe(3);
  });

  it('reports false for a pair that was never there', () => {
    const trie = seeded();
    expect(trie.remove('Nowhere', '99')).toBe(false);
    expect(trie.remove('Andheri East', '99')).toBe(false);
  });

  it('removes every term for a station id', () => {
    const trie = new Trie<Station>();
    const value = s('1', 'Tata Power Andheri West');
    trie.insertPhrase('Tata Power Andheri West', { id: '1', value, score: 1 });
    trie.insertPhrase('Andheri', { id: '2', value: s('2', 'Andheri'), score: 1 });

    expect(trie.removeById('1')).toBeGreaterThan(1);
    expect(trie.suggest('tata')).toEqual([]);
    expect(trie.suggest('andheri').map((h) => h.id)).toEqual(['2']);
    expect(trie.termsFor('1')).toEqual([]);
  });

  it('prunes dead branches instead of accumulating them', () => {
    const trie = new Trie<Station>();
    const before = trie.stats().nodes;

    trie.insert('zzzzzzzzzz', { id: '1', value: s('1', 'z'), score: 1 });
    expect(trie.stats().nodes).toBeGreaterThan(before);

    trie.remove('zzzzzzzzzz', '1');
    expect(trie.stats().nodes).toBe(before);
  });

  it('keeps a shared branch alive when only one of its terms is removed', () => {
    const trie = seeded();
    trie.remove('Andheri East', '1');
    // 'andheri west' still needs the 'andheri' path.
    expect(trie.hasPrefix('andheri')).toBe(true);
    expect(trie.suggest('andheri')).toHaveLength(1);
  });

  it('keeps subtree score bounds correct after the best entry is removed', () => {
    const trie = seeded();
    // '1' scores 0.9, the best under 'and'.
    trie.removeById('1');
    const hits = trie.suggest('and');
    expect(hits.map((h) => h.id)).toEqual(['3', '2']); // 0.8, then 0.7
  });

  it('clears completely', () => {
    const trie = seeded();
    trie.clear();
    expect(trie.isEmpty).toBe(true);
    expect(trie.entries).toBe(0);
    expect(trie.suggest('a')).toEqual([]);
    expect(trie.stats().nodes).toBe(1); // just the root
  });
});

describe('Trie — performance characteristics', () => {
  it('stays fast on a large dictionary, independent of dataset size', () => {
    const trie = new Trie<Station>();
    for (let i = 0; i < 20_000; i += 1) {
      const name = `station ${i.toString(36)} hub`;
      trie.insert(name, { id: `s${i}`, value: s(`s${i}`, name), score: Math.random() });
    }

    const startedAt = Date.now();
    for (let i = 0; i < 200; i += 1) trie.suggest('station 1', 8);
    const elapsed = Date.now() - startedAt;

    // 200 keystroke-equivalent lookups over 20k terms. Generous bound; the
    // point is that pruning keeps this off a linear scan.
    expect(elapsed).toBeLessThan(500);
  });
});
