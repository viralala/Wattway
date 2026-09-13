/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * BST.test.ts
 *
 * PRD Section 11: "Each custom data structure ships with unit tests
 *                  demonstrating correctness independent of the web app."
 *
 * Nothing here imports Express or Mongoose. The tree is tested as a tree.
 * ---------------------------------------------------------------------------
 */

import { BST } from '../../src/datastructures/BST';

interface Station {
  id: string;
  price: number;
}

const station = (id: string, price: number): Station => ({ id, price });

describe('BST — construction', () => {
  it('starts empty', () => {
    const tree = new BST<Station>();
    expect(tree.isEmpty).toBe(true);
    expect(tree.size).toBe(0);
    expect(tree.keyCount).toBe(0);
    expect(tree.height).toBe(0);
    expect(tree.min()).toBeNull();
    expect(tree.max()).toBeNull();
  });

  it('inserts and reports sizes separately for values and distinct keys', () => {
    const tree = new BST<Station>();
    tree.insert(12, station('a', 12));
    tree.insert(12, station('b', 12));
    tree.insert(8, station('c', 8));

    expect(tree.size).toBe(3); // three payloads
    expect(tree.keyCount).toBe(2); // two distinct prices
  });

  it('rejects a non-finite key rather than silently corrupting the tree', () => {
    const tree = new BST<Station>();
    expect(() => tree.insert(Number.NaN, station('a', 0))).toThrow(/finite/);
    expect(() => tree.insert(Infinity, station('b', 0))).toThrow(/finite/);
    expect(tree.size).toBe(0);
  });

  it('builds a balanced tree from unsorted input', () => {
    const items = Array.from({ length: 1000 }, (_, i) => station(`s${i}`, i));
    const tree = BST.build(items, (s) => s.price);

    expect(tree.size).toBe(1000);
    // Perfectly balanced over 1000 distinct keys: ceil(log2(1001)) = 10.
    expect(tree.height).toBe(10);
    expect(tree.isBalanced()).toBe(true);
  });

  it('skips un-indexable rows in build() instead of poisoning the tree', () => {
    const items = [station('a', 10), station('b', Number.NaN), station('c', 12)];
    const tree = BST.build(items, (s) => s.price);
    expect(tree.size).toBe(2);
  });

  it('rejects unsorted input to fromSorted', () => {
    expect(() =>
      BST.fromSorted([
        { key: 5, values: ['a'] },
        { key: 3, values: ['b'] },
      ]),
    ).toThrow(/ascending/);
  });

  it('degenerates on sorted insert — the reason rebalance() exists', () => {
    const tree = new BST<Station>();
    for (let i = 0; i < 64; i += 1) tree.insert(i, station(`s${i}`, i));

    // A plain BST fed ascending keys is a linked list.
    expect(tree.height).toBe(64);
    expect(tree.isBalanced()).toBe(false);

    tree.rebalance();

    expect(tree.height).toBe(7); // floor(log2(64)) + 1
    expect(tree.isBalanced()).toBe(true);
    // Rebalancing must not lose or reorder anything.
    expect(tree.size).toBe(64);
    expect(tree.toSortedValues().map((s) => s.price)).toEqual(
      Array.from({ length: 64 }, (_, i) => i),
    );
  });
});

describe('BST — search', () => {
  const tree = BST.build(
    [station('a', 8), station('b', 12), station('c', 12), station('d', 15), station('e', 20)],
    (s) => s.price,
  );

  it('returns every value in a duplicate-key bucket', () => {
    expect(tree.search(12).map((s) => s.id).sort()).toEqual(['b', 'c']);
  });

  it('returns an empty array for a missing key', () => {
    expect(tree.search(9)).toEqual([]);
    expect(tree.has(9)).toBe(false);
    expect(tree.has(12)).toBe(true);
  });

  it('finds min and max', () => {
    expect(tree.min()?.key).toBe(8);
    expect(tree.max()?.key).toBe(20);
  });

  it('computes floor and ceiling, including exact hits', () => {
    expect(tree.floorKey(14)).toBe(12);
    expect(tree.ceilKey(14)).toBe(15);
    expect(tree.floorKey(12)).toBe(12);
    expect(tree.ceilKey(12)).toBe(12);
    expect(tree.floorKey(1)).toBeNull(); // nothing cheaper exists
    expect(tree.ceilKey(999)).toBeNull(); // nothing dearer exists
  });

  it('finds the nearest key, breaking ties toward the cheaper option', () => {
    expect(tree.nearest(13)?.key).toBe(12);
    expect(tree.nearest(16)?.key).toBe(15);
    // 10 is equidistant from 8 and 12; the cheaper one wins.
    expect(tree.nearest(10)?.key).toBe(8);
    expect(tree.nearest(-5)?.key).toBe(8);
    expect(tree.nearest(1000)?.key).toBe(20);
  });

  it('returns copies, so a caller cannot mutate a bucket in place', () => {
    const bucket = tree.search(12);
    bucket.pop();
    expect(tree.search(12)).toHaveLength(2);
  });
});

describe('BST — range queries', () => {
  const prices = [6, 8, 8, 10, 12, 12, 12, 15, 18, 22, 30];
  const tree = BST.build(
    prices.map((price, i) => station(`s${i}`, price)),
    (s) => s.price,
  );

  it('returns everything inside an inclusive range, in key order', () => {
    const hits = tree.rangeQuery(8, 12);
    expect(hits.map((s) => s.price)).toEqual([8, 8, 10, 12, 12, 12]);
  });

  it('honours exclusive bounds', () => {
    expect(tree.rangeQuery(8, 12, { inclusiveMin: false }).map((s) => s.price)).toEqual([
      10, 12, 12, 12,
    ]);
    expect(tree.rangeQuery(8, 12, { inclusiveMax: false }).map((s) => s.price)).toEqual([
      8, 8, 10,
    ]);
    expect(
      tree.rangeQuery(8, 12, { inclusiveMin: false, inclusiveMax: false }).map((s) => s.price),
    ).toEqual([10]);
  });

  it('walks descending when asked', () => {
    expect(tree.rangeQuery(8, 12, { descending: true }).map((s) => s.price)).toEqual([
      12, 12, 12, 10, 8, 8,
    ]);
  });

  it('stops at the limit', () => {
    expect(tree.rangeQuery(6, 30, { limit: 3 })).toHaveLength(3);
    expect(tree.rangeQuery(6, 30, { limit: 3, descending: true }).map((s) => s.price)).toEqual([
      30, 22, 18,
    ]);
  });

  it('handles ranges that match nothing, one end, or everything', () => {
    expect(tree.rangeQuery(100, 200)).toEqual([]);
    expect(tree.rangeQuery(0, 5)).toEqual([]);
    expect(tree.rangeQuery(30, 30).map((s) => s.price)).toEqual([30]);
    expect(tree.rangeQuery(-Infinity, Infinity)).toHaveLength(prices.length);
  });

  it('returns nothing when min exceeds max', () => {
    expect(tree.rangeQuery(20, 10)).toEqual([]);
    expect(tree.countInRange(20, 10)).toBe(0);
  });

  it('counts a range in O(h) without materialising it', () => {
    expect(tree.countInRange(8, 12)).toBe(6);
    expect(tree.countInRange(8, 12, { inclusiveMin: false })).toBe(4);
    expect(tree.countInRange(8, 12, { inclusiveMax: false })).toBe(3);
    expect(tree.countInRange(-Infinity, Infinity)).toBe(prices.length);
    expect(tree.countInRange(100, 200)).toBe(0);
  });

  it('agrees with a brute-force filter for every bound, on random data', () => {
    const values = Array.from({ length: 400 }, (_, i) =>
      station(`r${i}`, Math.round(Math.random() * 200) / 2),
    );
    const random = BST.build(values, (s) => s.price);

    for (let trial = 0; trial < 60; trial += 1) {
      const a = Math.round(Math.random() * 200) / 2;
      const b = Math.round(Math.random() * 200) / 2;
      const [low, high] = a <= b ? [a, b] : [b, a];

      const expected = values
        .filter((s) => s.price >= low && s.price <= high)
        .map((s) => s.price)
        .sort((x, y) => x - y);

      const actual = random.rangeQuery(low, high).map((s) => s.price);

      expect(actual).toEqual(expected);
      expect(random.countInRange(low, high)).toBe(expected.length);
    }
  });

  it('reports rank correctly at and around a key', () => {
    // prices: 6, 8, 8, 10, 12, 12, 12, 15, 18, 22, 30
    expect(tree.rankLess(8)).toBe(1);
    expect(tree.rankLessOrEqual(8)).toBe(3);
    expect(tree.rankLess(12)).toBe(4);
    expect(tree.rankLessOrEqual(12)).toBe(7);
    expect(tree.rankLess(-100)).toBe(0);
    expect(tree.rankLessOrEqual(1000)).toBe(prices.length);
  });
});

describe('BST — removal', () => {
  const build = () =>
    BST.build(
      [
        station('a', 8),
        station('b', 12),
        station('c', 12),
        station('d', 15),
        station('e', 20),
        station('f', 3),
        station('g', 17),
      ],
      (s) => s.price,
    );

  it('removes an entire bucket', () => {
    const tree = build();
    expect(tree.remove(12)).toBe(2);
    expect(tree.has(12)).toBe(false);
    expect(tree.size).toBe(5);
    expect(tree.keyCount).toBe(5);
  });

  it('removes one value from a shared bucket and leaves the node standing', () => {
    const tree = build();
    expect(tree.remove(12, (s) => s.id === 'b')).toBe(1);
    expect(tree.search(12).map((s) => s.id)).toEqual(['c']);
    expect(tree.size).toBe(6);
    // Seven stations occupy six distinct prices (two share 12). Dropping one
    // value out of the shared bucket must not drop the node itself.
    expect(tree.keyCount).toBe(6);
  });

  it('reports zero when nothing matched', () => {
    const tree = build();
    expect(tree.remove(999)).toBe(0);
    expect(tree.remove(12, (s) => s.id === 'nope')).toBe(0);
    expect(tree.size).toBe(7);
  });

  it('keeps in-order traversal correct after removing a two-child node', () => {
    const tree = build();
    // 15 has both a left and a right subtree in the balanced build.
    tree.remove(15);
    expect(tree.toSortedValues().map((s) => s.price)).toEqual([3, 8, 12, 12, 17, 20]);
  });

  it('can be emptied one key at a time and stays consistent throughout', () => {
    const tree = build();
    for (const key of [3, 20, 12, 8, 17, 15]) {
      tree.remove(key);
      const sorted = tree.toSortedValues().map((s) => s.price);
      // Traversal must stay sorted after every single deletion.
      expect([...sorted].sort((a, b) => a - b)).toEqual(sorted);
    }
    expect(tree.isEmpty).toBe(true);
    expect(tree.size).toBe(0);
    expect(tree.keyCount).toBe(0);
    expect(tree.height).toBe(0);
  });

  it('keeps cached subtree sizes correct after removals (countInRange still works)', () => {
    const tree = build();
    tree.remove(12, (s) => s.id === 'b');
    tree.remove(3);
    expect(tree.countInRange(-Infinity, Infinity)).toBe(tree.size);
    expect(tree.countInRange(8, 20)).toBe(5); // 8, 12, 15, 17, 20
  });

  it('removeWhere drops matching values across every bucket', () => {
    const tree = build();
    const removed = tree.removeWhere((s) => s.price >= 15);
    expect(removed).toBe(3);
    expect(tree.toSortedValues().map((s) => s.price)).toEqual([3, 8, 12, 12]);
  });

  it('survives removing the root repeatedly', () => {
    const tree = build();
    while (!tree.isEmpty) {
      const root = tree.toSortedValues();
      expect(root.length).toBe(tree.size);
      tree.remove(tree.min()!.key);
    }
    expect(tree.size).toBe(0);
  });
});

describe('BST — traversal and diagnostics', () => {
  const tree = BST.build(
    [station('a', 8), station('b', 12), station('c', 12), station('d', 3)],
    (s) => s.price,
  );

  it('iterates ascending by key', () => {
    expect([...tree].map((s) => s.price)).toEqual([3, 8, 12, 12]);
  });

  it('exposes inorder buckets', () => {
    expect(tree.inorder().map((entry) => entry.key)).toEqual([3, 8, 12]);
  });

  it('reports stats an operator can act on', () => {
    const stats = tree.stats();
    expect(stats).toMatchObject({
      values: 4,
      keys: 3,
      minKey: 3,
      maxKey: 12,
      balanced: true,
    });
    expect(stats.height).toBeGreaterThanOrEqual(stats.idealHeight);
  });

  it('clears completely', () => {
    const scratch = BST.build([station('a', 1)], (s) => s.price);
    scratch.clear();
    expect(scratch.isEmpty).toBe(true);
    expect(scratch.stats().values).toBe(0);
  });
});

describe('BST — performance characteristics', () => {
  it('answers a narrow range over 50k stations without scanning them all', () => {
    const items = Array.from({ length: 50_000 }, (_, i) => station(`s${i}`, (i % 4000) / 10));
    const tree = BST.build(items, (s) => s.price);

    const startedAt = Date.now();
    const hits = tree.rangeQuery(100, 102);
    const elapsed = Date.now() - startedAt;

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((s) => s.price >= 100 && s.price <= 102)).toBe(true);
    // Generous bound — the point is that it is not a 50k linear scan.
    expect(elapsed).toBeLessThan(50);
  });
});
