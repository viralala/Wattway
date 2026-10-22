/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  Queue.ts - FIFO queues, two ways, from scratch.
 *
 *  CS2305 Unit 3 ("Queue using arrays and linked lists") and Lab 6 (job
 *  scheduling). PRD Section 5 assigns the Queue to the per-station waiting line
 *  and to BFS - the routing module's range-limited reachability search uses
 *  `LinkedQueue` as its frontier.
 *
 *  WHY A *CIRCULAR* ARRAY QUEUE?
 *  -----------------------------
 *  The naive array queue keeps `front` and `rear` indices that only ever move
 *  right. After capacity enqueues the rear hits the end of the array, and the
 *  queue reports "full" even if every element has already been dequeued - all
 *  the slots to the left of `front` are dead space. Shifting the elements left
 *  on every dequeue fixes that but makes dequeue O(n).
 *
 *  The circular queue lets both indices wrap with `(i + 1) % capacity`, so a
 *  slot freed at the front is reused by the next enqueue. Every slot is usable
 *  and both operations stay O(1). We keep an explicit `count` rather than
 *  sacrificing one slot to tell "full" from "empty" (front === rear is
 *  ambiguous otherwise) - both are textbook answers; the counter is clearer.
 *
 *  ARRAY vs LINKED
 *  ---------------
 *  CircularQueue  fixed memory, cache-friendly, needs a capacity up front.
 *                 Optional `growable` mode doubles the buffer when full
 *                 (amortised O(1)), unrolling the wrap-around into the new array.
 *  LinkedQueue    no capacity at all, one allocation per element. Head and
 *                 tail pointers make both ends O(1).
 *
 *  COMPLEXITY
 *  ----------
 *                      CircularQueue        LinkedQueue
 *      enqueue ....... O(1) (amortised O(1) when growable)   O(1)
 *      dequeue ....... O(1)                 O(1)
 *      peek .......... O(1)                 O(1)
 *      size/isEmpty .. O(1)                 O(1)
 *      toArray ....... O(n)                 O(n)
 *      space ......... O(capacity)          O(n)
 * ============================================================================
 */

/** The interface both implementations share, so callers can swap freely. */
export interface Queue<T> extends Iterable<T> {
  enqueue(value: T): void;
  dequeue(): T | undefined;
  peek(): T | undefined;
  readonly size: number;
  readonly isEmpty: boolean;
  toArray(): T[];
  clear(): void;
}

/** Thrown by a fixed-capacity CircularQueue that is full. */
export class QueueOverflowError extends Error {
  constructor(capacity: number) {
    super(`Queue is full (capacity ${capacity})`);
    this.name = 'QueueOverflowError';
  }
}

// ─── Circular array queue ───────────────────────────────────────────────────

export interface CircularQueueOptions {
  /** Double the buffer instead of throwing when full. Default `false`. */
  growable?: boolean;
}

export class CircularQueue<T> implements Queue<T> {
  private buffer: (T | undefined)[];
  /** Index of the current front element. */
  private front = 0;
  /** Index of the current rear element (-1 mod capacity when empty). */
  private rear: number;
  private count = 0;
  private readonly growable: boolean;

  constructor(capacity = 16, options: CircularQueueOptions = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('Capacity must be a positive integer');
    }
    this.buffer = new Array<T | undefined>(capacity);
    this.rear = capacity - 1;
    this.growable = options.growable ?? false;
  }

  get capacity(): number {
    return this.buffer.length;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get isFull(): boolean {
    return this.count === this.buffer.length;
  }

  /** Positions of front and rear, exposed for the lab demo / visualiser. */
  get pointers(): { front: number; rear: number; capacity: number } {
    return { front: this.front, rear: this.rear, capacity: this.buffer.length };
  }

  enqueue(value: T): void {
    if (this.isFull) {
      if (!this.growable) throw new QueueOverflowError(this.buffer.length);
      this.grow();
    }
    this.rear = (this.rear + 1) % this.buffer.length; // the wrap-around
    this.buffer[this.rear] = value;
    this.count += 1;
  }

  /** Like enqueue, but returns false instead of throwing on overflow. */
  offer(value: T): boolean {
    if (this.isFull && !this.growable) return false;
    this.enqueue(value);
    return true;
  }

  dequeue(): T | undefined {
    if (this.count === 0) return undefined;
    const value = this.buffer[this.front];
    this.buffer[this.front] = undefined; // let the GC have it
    this.front = (this.front + 1) % this.buffer.length;
    this.count -= 1;
    return value;
  }

  peek(): T | undefined {
    return this.count === 0 ? undefined : this.buffer[this.front];
  }

  peekRear(): T | undefined {
    return this.count === 0 ? undefined : this.buffer[this.rear];
  }

  /** Front-to-rear copy. O(n). */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i += 1) {
      out.push(this.buffer[(this.front + i) % this.buffer.length] as T);
    }
    return out;
  }

  clear(): void {
    this.buffer = new Array<T | undefined>(this.buffer.length);
    this.front = 0;
    this.rear = this.buffer.length - 1;
    this.count = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.toArray();
  }

  /** Copy into a buffer twice the size, un-wrapping so front lands at 0. */
  private grow(): void {
    const items = this.toArray();
    this.buffer = new Array<T | undefined>(this.buffer.length * 2);
    items.forEach((item, index) => {
      this.buffer[index] = item;
    });
    this.front = 0;
    this.rear = items.length - 1;
  }
}

// ─── Linked queue ───────────────────────────────────────────────────────────

class QueueNode<T> {
  value: T;
  next: QueueNode<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

export class LinkedQueue<T> implements Queue<T> {
  private head: QueueNode<T> | null = null;
  private tail: QueueNode<T> | null = null;
  private count = 0;

  static from<T>(values: Iterable<T>): LinkedQueue<T> {
    const queue = new LinkedQueue<T>();
    for (const value of values) queue.enqueue(value);
    return queue;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** Append at the tail. O(1). */
  enqueue(value: T): void {
    const node = new QueueNode(value);
    if (this.tail === null) {
      this.head = node;
    } else {
      this.tail.next = node;
    }
    this.tail = node;
    this.count += 1;
  }

  /** Remove from the head. O(1). */
  dequeue(): T | undefined {
    const node = this.head;
    if (node === null) return undefined;
    this.head = node.next;
    if (this.head === null) this.tail = null;
    node.next = null;
    this.count -= 1;
    return node.value;
  }

  peek(): T | undefined {
    return this.head?.value;
  }

  peekRear(): T | undefined {
    return this.tail?.value;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let node = this.head; node !== null; node = node.next) out.push(node.value);
    return out;
  }

  clear(): void {
    this.head = null;
    this.tail = null;
    this.count = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let node = this.head; node !== null; node = node.next) yield node.value;
  }
}
