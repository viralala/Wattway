/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Queue.test.ts — circular array queue and linked queue. No database.
 * ---------------------------------------------------------------------------
 */

import { CircularQueue, LinkedQueue, QueueOverflowError, type Queue } from '../../src/datastructures/Queue';

const implementations: [string, () => Queue<number>][] = [
  ['CircularQueue (growable)', () => new CircularQueue<number>(2, { growable: true })],
  ['LinkedQueue', () => new LinkedQueue<number>()],
];

describe.each(implementations)('%s — FIFO contract', (_name, make) => {
  it('starts empty', () => {
    const queue = make();
    expect(queue.size).toBe(0);
    expect(queue.isEmpty).toBe(true);
    expect(queue.peek()).toBeUndefined();
    expect(queue.dequeue()).toBeUndefined();
  });

  it('is first-in, first-out, duplicates included', () => {
    const queue = make();
    [5, 1, 5, 3].forEach((v) => queue.enqueue(v));
    expect(queue.peek()).toBe(5);
    expect(queue.toArray()).toEqual([5, 1, 5, 3]);
    expect([queue.dequeue(), queue.dequeue(), queue.dequeue(), queue.dequeue()]).toEqual([5, 1, 5, 3]);
    expect(queue.isEmpty).toBe(true);
  });

  it('handles a single element and reuse after emptying', () => {
    const queue = make();
    queue.enqueue(1);
    expect(queue.dequeue()).toBe(1);
    queue.enqueue(2);
    expect([...queue]).toEqual([2]);
    queue.clear();
    expect(queue.size).toBe(0);
  });

  it('matches an array model under random operations (property test)', () => {
    const queue = make();
    const model: number[] = [];
    let seed = 99;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let step = 0; step < 5000; step += 1) {
      if (random() < 0.55) {
        queue.enqueue(step);
        model.push(step);
      } else {
        expect(queue.dequeue()).toBe(model.shift());
      }
      expect(queue.size).toBe(model.length);
      expect(queue.peek()).toBe(model[0]);
    }
    expect(queue.toArray()).toEqual(model);
  });
});

describe('CircularQueue — wrap-around', () => {
  it('reuses slots freed at the front (the space a linear array queue wastes)', () => {
    const queue = new CircularQueue<number>(3);
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    expect(queue.isFull).toBe(true);
    expect(queue.dequeue()).toBe(1);
    expect(queue.dequeue()).toBe(2);
    // A linear queue would now report "full" (rear at the end). We wrap:
    queue.enqueue(4);
    queue.enqueue(5);
    expect(queue.toArray()).toEqual([3, 4, 5]);
    expect(queue.pointers).toEqual({ front: 2, rear: 1, capacity: 3 });
    expect(queue.peekRear()).toBe(5);
  });

  it('throws on overflow when fixed, and offer() reports it instead', () => {
    const queue = new CircularQueue<string>(1);
    queue.enqueue('a');
    expect(() => queue.enqueue('b')).toThrow(QueueOverflowError);
    expect(queue.offer('b')).toBe(false);
    expect(queue.toArray()).toEqual(['a']);
  });

  it('grows by doubling while wrapped, keeping order', () => {
    const queue = new CircularQueue<number>(4, { growable: true });
    [1, 2, 3, 4].forEach((v) => queue.enqueue(v));
    queue.dequeue();
    queue.dequeue();
    [5, 6, 7].forEach((v) => queue.enqueue(v)); // wraps, then must grow
    expect(queue.capacity).toBe(8);
    expect(queue.toArray()).toEqual([3, 4, 5, 6, 7]);
    expect(queue.dequeue()).toBe(3);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new CircularQueue(0)).toThrow(RangeError);
  });
});

describe('LinkedQueue', () => {
  it('builds from an iterable and keeps the rear pointer right', () => {
    const queue = LinkedQueue.from(['x', 'y']);
    expect(queue.peekRear()).toBe('y');
    queue.dequeue();
    queue.dequeue();
    expect(queue.peekRear()).toBeUndefined();
    queue.enqueue('z');
    expect(queue.peek()).toBe('z');
    expect(queue.peekRear()).toBe('z');
  });
});
