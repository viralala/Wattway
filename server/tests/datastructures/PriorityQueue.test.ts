/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * PriorityQueue.test.ts — binary heap, max priority queue, min-max heap
 * (double-ended PQ) and heapsort. No database.
 * ---------------------------------------------------------------------------
 */

import {
  BinaryHeap,
  DoubleEndedPriorityQueue,
  MaxPriorityQueue,
  ascending,
  descending,
  heapSort,
} from '../../src/datastructures/PriorityQueue';

function randomInts(count: number, seed: number, max = 1000): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 48271) % 2147483647;
    return state % max;
  });
}

describe('BinaryHeap', () => {
  it('is empty to start', () => {
    const heap = new BinaryHeap<number>(ascending);
    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
  });

  it('works as a min-heap and, with the comparator reversed, as a max-heap', () => {
    const values = [5, 3, 8, 1, 9, 1, 4];
    const min = new BinaryHeap<number>(ascending);
    const max = new BinaryHeap<number>(descending);
    values.forEach((v) => {
      min.push(v);
      max.push(v);
    });
    expect(min.isValid()).toBe(true);
    expect(max.isValid()).toBe(true);
    expect(min.toSortedArray()).toEqual([1, 1, 3, 4, 5, 8, 9]);
    expect(max.toSortedArray()).toEqual([9, 8, 5, 4, 3, 1, 1]);
    expect(max.pop()).toBe(9);
    expect(max.peek()).toBe(8);
  });

  it('heapify builds a valid heap in place of n pushes', () => {
    const values = randomInts(500, 3);
    const heap = BinaryHeap.heapify(values, ascending);
    expect(heap.isValid()).toBe(true);
    expect(heap.size).toBe(500);
    const drained: number[] = [];
    while (!heap.isEmpty) drained.push(heap.pop() as number);
    expect(drained).toEqual([...values].sort((a, b) => a - b));
  });
});

describe('MaxPriorityQueue — urgent-charge queue', () => {
  it('serves the highest priority first and is FIFO among equals', () => {
    const pq = new MaxPriorityQueue<string>();
    pq.enqueue('regular-1', 10);
    pq.enqueue('ambulance', 100);
    pq.enqueue('regular-2', 10);
    pq.enqueue('low-battery', 60);
    pq.enqueue('regular-3', 10);
    expect(pq.peek()).toBe('ambulance');
    expect(pq.peekPriority()).toBe(100);
    expect(pq.top(2)).toEqual([
      { value: 'ambulance', priority: 100 },
      { value: 'low-battery', priority: 60 },
    ]);
    expect(pq.toSortedArray()).toEqual(['ambulance', 'low-battery', 'regular-1', 'regular-2', 'regular-3']);
    expect(pq.size).toBe(5); // top/toSortedArray do not consume
    const out: string[] = [];
    while (!pq.isEmpty) out.push(pq.dequeue() as string);
    expect(out).toEqual(['ambulance', 'low-battery', 'regular-1', 'regular-2', 'regular-3']);
  });

  it('rejects non-finite priorities', () => {
    expect(() => new MaxPriorityQueue<string>().enqueue('x', Number.NaN)).toThrow(RangeError);
  });
});

describe('DoubleEndedPriorityQueue — min-max heap', () => {
  it('handles 0, 1 and 2 elements', () => {
    const depq = new DoubleEndedPriorityQueue<number>(ascending);
    expect(depq.peekMin()).toBeUndefined();
    expect(depq.peekMax()).toBeUndefined();
    expect(depq.popMax()).toBeUndefined();
    depq.push(5);
    expect([depq.peekMin(), depq.peekMax()]).toEqual([5, 5]);
    depq.push(2);
    expect([depq.peekMin(), depq.peekMax()]).toEqual([2, 5]);
    expect(depq.popMax()).toBe(5);
    expect(depq.popMin()).toBe(2);
    expect(depq.isEmpty).toBe(true);
  });

  it('reads both ends in O(1) and keeps the min-max property', () => {
    const depq = DoubleEndedPriorityQueue.from([40, 7, 99, 3, 55, 21, 3, 80], ascending);
    expect(depq.isValid()).toBe(true);
    expect(depq.peekMin()).toBe(3);
    expect(depq.peekMax()).toBe(99);
    expect(depq.toSortedArray()).toEqual([3, 3, 7, 21, 40, 55, 80, 99]);
  });

  it('matches a sorted array under random push / popMin / popMax (property test)', () => {
    const values = randomInts(3000, 11, 500);
    const depq = new DoubleEndedPriorityQueue<number>(ascending);
    const model: number[] = [];
    values.forEach((value, step) => {
      const op = value % 4;
      if (op <= 1 || model.length === 0) {
        depq.push(value);
        model.push(value);
        model.sort((a, b) => a - b);
      } else if (op === 2) {
        expect(depq.popMin()).toBe(model.shift());
      } else {
        expect(depq.popMax()).toBe(model.pop());
      }
      expect(depq.size).toBe(model.length);
      expect(depq.peekMin()).toBe(model[0]);
      expect(depq.peekMax()).toBe(model[model.length - 1]);
      if (step % 300 === 0) expect(depq.isValid()).toBe(true);
    });
  });
});

describe('heapSort', () => {
  it('sorts in place, ascending, with duplicates and edge sizes', () => {
    expect(heapSort([], ascending)).toEqual([]);
    expect(heapSort([1], ascending)).toEqual([1]);
    const array = [4, 1, 3, 1, 5, 9, 2, 6];
    const result = heapSort(array, ascending);
    expect(result).toBe(array); // in place
    expect(array).toEqual([1, 1, 2, 3, 4, 5, 6, 9]);
  });

  it('agrees with Array.prototype.sort on random input', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const values = randomInts(200 + seed, seed);
      expect(heapSort([...values], ascending)).toEqual([...values].sort((a, b) => a - b));
      expect(heapSort([...values], descending)).toEqual([...values].sort((a, b) => b - a));
    }
  });

  it('reports one pass for the build plus one per extraction', () => {
    const passes: number[][] = [];
    heapSort([3, 1, 2, 5, 4], ascending, (snapshot) => passes.push(snapshot));
    expect(passes).toHaveLength(5);
    expect(passes[0][0]).toBe(5); // after build, the max is at the root
    expect(passes[passes.length - 1]).toEqual([1, 2, 3, 4, 5]);
  });
});
