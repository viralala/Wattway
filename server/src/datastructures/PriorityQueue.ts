/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  PriorityQueue.ts - binary heaps and the priority queues built on them.
 *
 *  CS2305 Unit 3 (priority queue, double-ended priority queue) and Unit 5
 *  (min heap, max heap, heap operations, heapsort).
 *
 *  WHAT IS IN HERE AND WHERE WATTWAY USES IT
 *  -----------------------------------------
 *  BinaryHeap<T>               array-backed heap ordered by a comparator.
 *                              Children of i live at 2i+1 and 2i+2, parent at
 *                              floor((i-1)/2). Pass an ascending comparator for
 *                              a min-heap, a descending one for a max-heap -
 *                              "a max-heap is a min-heap with the comparator
 *                              reversed". (If the routing module's MinHeap
 *                              takes a comparator, it can stand in here 1:1.)
 *
 *  MaxPriorityQueue<T>         the URGENT-CHARGE queue: highest urgency score
 *                              comes out first; equal scores leave in arrival
 *                              order (a sequence number breaks ties, which a
 *                              bare heap does not guarantee - heaps are not
 *                              stable). Also drives the preemptive scheduler.
 *
 *  DoubleEndedPriorityQueue<T> a MIN-MAX HEAP. Even levels are min levels, odd
 *                              levels are max levels, so the smallest element
 *                              is the root and the largest is one of its two
 *                              children. The operator dashboard reads BOTH the
 *                              most urgent and the least urgent waiting driver
 *                              in O(1) and can remove either in O(log n).
 *                              (Two heaps with cross-links would also work, but
 *                              need twice the memory and paired deletions.)
 *
 *  heapSort()                  in-place, O(n log n), O(1) extra space. Operator
 *                              report "drivers sorted by wait time". Not stable
 *                              - say so in the viva; merge sort is the stable
 *                              alternative.
 *
 *  WHY BOTTOM-UP HEAPIFY IS O(n), NOT O(n log n)
 *  ---------------------------------------------
 *  Sift-down from node i costs O(height of i). Half the nodes are leaves (cost
 *  0), a quarter have height 1, an eighth height 2 ... so the total is
 *  n * sum(h / 2^(h+1)) <= n. Inserting n items one by one is O(n log n).
 *
 *  COMPLEXITY
 *  ----------
 *                       BinaryHeap / MaxPQ     Min-max heap (DEPQ)
 *      push ........... O(log n)               O(log n)
 *      peek ........... O(1)                   O(1) min, O(1) max
 *      pop ............ O(log n)               O(log n) min, O(log n) max
 *      heapify ........ O(n)                   O(n log n) (n pushes)
 *      heapSort ....... O(n log n) time, O(1) extra space, not stable
 * ============================================================================
 */

/** Negative when `a` should leave the heap before `b`. */
export type Comparator<T> = (a: T, b: T) => number;

export const ascending: Comparator<number> = (a, b) => a - b;
export const descending: Comparator<number> = (a, b) => b - a;

// ─── Binary heap ────────────────────────────────────────────────────────────

export class BinaryHeap<T> implements Iterable<T> {
  private readonly items: T[] = [];
  private readonly compare: Comparator<T>;

  constructor(compare: Comparator<T>) {
    this.compare = compare;
  }

  /** Build from an array in O(n) with bottom-up sift-down. Does not mutate `values`. */
  static heapify<T>(values: readonly T[], compare: Comparator<T>): BinaryHeap<T> {
    const heap = new BinaryHeap<T>(compare);
    heap.items.push(...values);
    for (let i = (heap.items.length >> 1) - 1; i >= 0; i -= 1) heap.siftDown(i);
    return heap;
  }

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(value: T): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top === undefined || last === undefined) return undefined;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Heap-order copy of the backing array (index 0 is the top). */
  toArray(): T[] {
    return [...this.items];
  }

  /** Drain a copy in priority order. O(n log n); the heap is untouched. */
  toSortedArray(): T[] {
    const copy = BinaryHeap.heapify(this.items, this.compare);
    const out: T[] = [];
    while (!copy.isEmpty) out.push(copy.pop() as T);
    return out;
  }

  /** Verify the heap property everywhere. O(n). For tests. */
  isValid(): boolean {
    for (let i = 1; i < this.items.length; i += 1) {
      if (this.compare(this.items[(i - 1) >> 1], this.items[i]) > 0) return false;
    }
    return true;
  }

  clear(): void {
    this.items.length = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.items;
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.compare(this.items[parent], this.items[child]) <= 0) return;
      this.swap(parent, child);
      child = parent;
    }
  }

  private siftDown(index: number): void {
    const n = this.items.length;
    let parent = index;
    for (;;) {
      const left = 2 * parent + 1;
      const right = left + 1;
      let best = parent;
      if (left < n && this.compare(this.items[left], this.items[best]) < 0) best = left;
      if (right < n && this.compare(this.items[right], this.items[best]) < 0) best = right;
      if (best === parent) return;
      this.swap(parent, best);
      parent = best;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = tmp;
  }
}

// ─── Max priority queue ─────────────────────────────────────────────────────

interface Prioritised<T> {
  value: T;
  priority: number;
  /** Insertion counter: equal priorities leave first-in, first-out. */
  seq: number;
}

/** Highest priority out first; ties broken by arrival order (stable). */
export class MaxPriorityQueue<T> implements Iterable<T> {
  private readonly heap = new BinaryHeap<Prioritised<T>>(
    (a, b) => b.priority - a.priority || a.seq - b.seq,
  );
  private seq = 0;

  get size(): number {
    return this.heap.size;
  }

  get isEmpty(): boolean {
    return this.heap.isEmpty;
  }

  enqueue(value: T, priority: number): void {
    if (!Number.isFinite(priority)) throw new RangeError('Priority must be a finite number');
    this.heap.push({ value, priority, seq: this.seq });
    this.seq += 1;
  }

  /** Remove and return the most urgent value. */
  dequeue(): T | undefined {
    return this.heap.pop()?.value;
  }

  peek(): T | undefined {
    return this.heap.peek()?.value;
  }

  peekPriority(): number | undefined {
    return this.heap.peek()?.priority;
  }

  /** The `n` most urgent, in order, without disturbing the queue. */
  top(n: number): { value: T; priority: number }[] {
    return this.heap
      .toSortedArray()
      .slice(0, Math.max(0, n))
      .map(({ value, priority }) => ({ value, priority }));
  }

  toSortedArray(): T[] {
    return this.heap.toSortedArray().map((entry) => entry.value);
  }

  clear(): void {
    this.heap.clear();
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.toSortedArray();
  }
}

// ─── Double-ended priority queue (min-max heap) ─────────────────────────────

/** Level of index i in a complete binary tree: floor(log2(i + 1)). */
function levelOf(index: number): number {
  return Math.floor(Math.log2(index + 1));
}

export class DoubleEndedPriorityQueue<T> implements Iterable<T> {
  private readonly items: T[] = [];
  private readonly compare: Comparator<T>;

  /** `compare` orders values ascending: the "min" end is compare's smallest. */
  constructor(compare: Comparator<T>) {
    this.compare = compare;
  }

  static from<T>(values: Iterable<T>, compare: Comparator<T>): DoubleEndedPriorityQueue<T> {
    const depq = new DoubleEndedPriorityQueue<T>(compare);
    for (const value of values) depq.push(value);
    return depq;
  }

  get size(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  push(value: T): void {
    this.items.push(value);
    this.bubbleUp(this.items.length - 1);
  }

  /** Smallest value - always the root. O(1). */
  peekMin(): T | undefined {
    return this.items[0];
  }

  /** Largest value - the root itself, or the larger of its two children. O(1). */
  peekMax(): T | undefined {
    const index = this.maxIndex();
    return index === -1 ? undefined : this.items[index];
  }

  popMin(): T | undefined {
    return this.removeAt(this.items.length === 0 ? -1 : 0);
  }

  popMax(): T | undefined {
    return this.removeAt(this.maxIndex());
  }

  /** Ascending copy. O(n log n); the queue is untouched. */
  toSortedArray(): T[] {
    const copy = DoubleEndedPriorityQueue.from(this.items, this.compare);
    const out: T[] = [];
    while (!copy.isEmpty) out.push(copy.popMin() as T);
    return out;
  }

  /** Verify the min-max property everywhere. O(n log n). For tests. */
  isValid(): boolean {
    for (let i = 0; i < this.items.length; i += 1) {
      const isMin = levelOf(i) % 2 === 0;
      for (const d of this.descendants(i)) {
        const order = this.compare(this.items[i], this.items[d]);
        if (isMin ? order > 0 : order < 0) return false;
      }
    }
    return true;
  }

  clear(): void {
    this.items.length = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.toSortedArray();
  }

  // ── internals ──

  private less(a: number, b: number): boolean {
    return this.compare(this.items[a], this.items[b]) < 0;
  }

  private maxIndex(): number {
    const n = this.items.length;
    if (n === 0) return -1;
    if (n === 1) return 0;
    if (n === 2) return 1;
    return this.less(1, 2) ? 2 : 1;
  }

  private removeAt(index: number): T | undefined {
    if (index < 0) return undefined;
    const removed = this.items[index];
    const last = this.items.pop() as T;
    if (index < this.items.length) {
      this.items[index] = last;
      this.trickleDown(index);
    }
    return removed;
  }

  private bubbleUp(index: number): void {
    if (index === 0) return;
    const parent = (index - 1) >> 1;
    if (levelOf(index) % 2 === 0) {
      // min level: if bigger than its (max-level) parent, it belongs on max levels
      if (this.less(parent, index)) {
        this.swap(index, parent);
        this.bubbleUpGrand(parent, false);
      } else {
        this.bubbleUpGrand(index, true);
      }
    } else if (this.less(index, parent)) {
      this.swap(index, parent);
      this.bubbleUpGrand(parent, true);
    } else {
      this.bubbleUpGrand(index, false);
    }
  }

  /** Climb by grandparents while the min (or max) property is violated. */
  private bubbleUpGrand(index: number, minLevel: boolean): void {
    let i = index;
    while (i > 2) {
      const grand = (((i - 1) >> 1) - 1) >> 1;
      const violates = minLevel ? this.less(i, grand) : this.less(grand, i);
      if (!violates) return;
      this.swap(i, grand);
      i = grand;
    }
  }

  private trickleDown(index: number): void {
    const minLevel = levelOf(index) % 2 === 0;
    let i = index;
    for (;;) {
      const m = this.extremeDescendant(i, minLevel);
      if (m === -1) return;
      const better = minLevel ? this.less(m, i) : this.less(i, m);
      if (m > 2 * i + 2) {
        // m is a grandchild
        if (!better) return;
        this.swap(m, i);
        const parent = (m - 1) >> 1;
        const wrongSide = minLevel ? this.less(parent, m) : this.less(m, parent);
        if (wrongSide) this.swap(m, parent);
        i = m;
      } else {
        if (better) this.swap(m, i);
        return;
      }
    }
  }

  /** Index of the smallest (or largest) among children and grandchildren, or -1. */
  private extremeDescendant(index: number, smallest: boolean): number {
    const n = this.items.length;
    const first = 2 * index + 1;
    if (first >= n) return -1;
    const candidates = [first, first + 1, 2 * first + 1, 2 * first + 2, 2 * (first + 1) + 1, 2 * (first + 1) + 2];
    let best = first;
    for (const c of candidates) {
      if (c >= n) continue;
      if (smallest ? this.less(c, best) : this.less(best, c)) best = c;
    }
    return best;
  }

  private *descendants(index: number): Generator<number> {
    const stack = [2 * index + 1, 2 * index + 2];
    while (stack.length > 0) {
      const d = stack.pop() as number;
      if (d >= this.items.length) continue;
      yield d;
      stack.push(2 * d + 1, 2 * d + 2);
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = tmp;
  }
}

// ─── Heapsort ───────────────────────────────────────────────────────────────

/**
 * In-place heapsort, ascending by `compare`.
 *
 * Phase 1 builds a MAX-heap in the array itself (O(n)). Phase 2 swaps the max
 * to the end of the unsorted region and sifts the new root down, shrinking the
 * heap by one each pass (n - 1 passes of O(log n)).
 *
 * `onPass`, if given, receives a snapshot after the heap is built and after
 * every extraction - the operator report and the DS visualiser show these.
 * Returns the same array it was given.
 */
export function heapSort<T>(
  items: T[],
  compare: Comparator<T>,
  onPass?: (snapshot: T[], sortedFrom: number) => void,
): T[] {
  const n = items.length;

  const siftDown = (start: number, end: number): void => {
    let parent = start;
    for (;;) {
      const left = 2 * parent + 1;
      const right = left + 1;
      let largest = parent;
      if (left < end && compare(items[left], items[largest]) > 0) largest = left;
      if (right < end && compare(items[right], items[largest]) > 0) largest = right;
      if (largest === parent) return;
      const tmp = items[parent];
      items[parent] = items[largest];
      items[largest] = tmp;
      parent = largest;
    }
  };

  for (let i = (n >> 1) - 1; i >= 0; i -= 1) siftDown(i, n);
  onPass?.([...items], n);

  for (let end = n - 1; end > 0; end -= 1) {
    const tmp = items[0];
    items[0] = items[end];
    items[end] = tmp;
    siftDown(0, end);
    onPass?.([...items], end);
  }
  return items;
}
