/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * LeftistHeap.test.ts — mergeable heaps: leftist heap and binomial heap.
 * No database.
 * ---------------------------------------------------------------------------
 */

import { LeftistHeap } from '../../src/datastructures/LeftistHeap';
import { BinomialHeap } from '../../src/datastructures/BinomialHeap';
import { ascending } from '../../src/datastructures/PriorityQueue';

function randomInts(count: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 16807) % 2147483647;
    return state % 10_000;
  });
}

describe('LeftistHeap', () => {
  it('starts empty', () => {
    const heap = new LeftistHeap<number>(ascending);
    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
    expect(heap.isValid()).toBe(true);
  });

  it('inserts and pops in order, duplicates included', () => {
    const heap = new LeftistHeap<number>(ascending);
    [7, 3, 9, 3, 1].forEach((v) => heap.insert(v));
    expect(heap.isValid()).toBe(true);
    expect(heap.peek()).toBe(1);
    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop(), heap.pop(), heap.pop()]).toEqual([1, 3, 3, 7, 9, undefined]);
  });

  it('merges two heaps, emptying the donor', () => {
    const a = LeftistHeap.from([10, 4, 8], ascending);
    const b = LeftistHeap.from([6, 2, 12, 1], ascending);
    a.merge(b);
    expect(b.size).toBe(0);
    expect(b.peek()).toBeUndefined();
    expect(a.size).toBe(7);
    expect(a.isValid()).toBe(true);
    expect(a.toSortedArray()).toEqual([1, 2, 4, 6, 8, 10, 12]);
    expect(a.merge(a)).toBe(a); // self-merge is a no-op
    expect(a.size).toBe(7);
  });

  it('keeps the right spine logarithmic (the reason merge is O(log n))', () => {
    const sizes = [1, 10, 100, 1000, 5000];
    for (const n of sizes) {
      const heap = LeftistHeap.from(randomInts(n, n), ascending);
      expect(heap.isValid()).toBe(true);
      expect(heap.rightSpineLength()).toBeLessThanOrEqual(Math.floor(Math.log2(n + 1)));
    }
  });

  it('matches a sorted array through random inserts, pops and merges (property test)', () => {
    let heap = new LeftistHeap<number>(ascending);
    let model: number[] = [];
    const values = randomInts(2000, 5);
    values.forEach((value, step) => {
      if (value % 5 === 0) {
        const extra = randomInts(value % 17, step + 1);
        const donor = LeftistHeap.from(extra, ascending);
        heap = heap.merge(donor);
        model.push(...extra);
      } else if (value % 3 === 0 && model.length) {
        model.sort((a, b) => a - b);
        expect(heap.pop()).toBe(model.shift());
      } else {
        heap.insert(value);
        model.push(value);
      }
      expect(heap.size).toBe(model.length);
    });
    expect(heap.isValid()).toBe(true);
    model = model.sort((a, b) => a - b);
    expect(heap.toSortedArray()).toEqual(model);
  });

  it('merges objects with a custom order (line order: urgent first, then seniority)', () => {
    type D = { id: string; urgent: boolean; joinedAt: number };
    const order = (x: D, y: D): number => Number(y.urgent) - Number(x.urgent) || x.joinedAt - y.joinedAt;
    const stationA = LeftistHeap.from<D>(
      [
        { id: 'a1', urgent: false, joinedAt: 1 },
        { id: 'a2', urgent: false, joinedAt: 5 },
      ],
      order,
    );
    const stationB = LeftistHeap.from<D>(
      [
        { id: 'b1', urgent: false, joinedAt: 3 },
        { id: 'b2', urgent: true, joinedAt: 9 },
      ],
      order,
    );
    stationA.merge(stationB);
    expect(stationA.toSortedArray().map((d) => d.id)).toEqual(['b2', 'a1', 'b1', 'a2']);
  });
});

describe('BinomialHeap', () => {
  it('keeps one tree per 1-bit of the size', () => {
    const heap = BinomialHeap.from(Array.from({ length: 13 }, (_, i) => i), ascending);
    expect(heap.rootDegrees()).toEqual([0, 2, 3]); // 13 = 1101b
    expect(heap.peek()).toBe(0);
  });

  it('pops in order and merges (property test against sort)', () => {
    const a = BinomialHeap.from(randomInts(300, 2), ascending);
    const b = BinomialHeap.from(randomInts(170, 9), ascending);
    const expected = [...randomInts(300, 2), ...randomInts(170, 9)].sort((x, y) => x - y);
    a.merge(b);
    expect(b.size).toBe(0);
    expect(a.size).toBe(470);
    const out: number[] = [];
    while (!a.isEmpty) out.push(a.pop() as number);
    expect(out).toEqual(expected);
    expect(a.pop()).toBeUndefined();
  });
});
