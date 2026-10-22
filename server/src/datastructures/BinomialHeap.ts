/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  BinomialHeap.ts - a binomial (min-)heap. The "optional" item of the plan,
 *  built so the comparison table in docs/DATA-STRUCTURES.md is backed by code.
 *
 *  CS2305 Unit 5 (binomial heaps).
 *
 *  STRUCTURE
 *  ---------
 *  A binomial tree B_k has 2^k nodes: B_0 is one node, and B_k is two B_(k-1)
 *  trees with one root made the leftmost child of the other. A binomial heap
 *  is a list of heap-ordered binomial trees with *distinct* degrees, kept in
 *  increasing degree order - exactly like the 1-bits of n in binary. (n = 13 =
 *  1101b is held as B_0, B_2 and B_3.)
 *
 *  Union is therefore binary addition: merge the two root lists by degree, then
 *  walk it and "carry" - link any two trees of equal degree into one of the
 *  next degree.
 *
 *  Representation: left-child / right-sibling. `child` is the highest-degree
 *  child, `sibling` links roots (in the root list) or brothers (under a parent).
 *
 *  COMPLEXITY
 *  ----------
 *      insert ........ O(log n) worst, O(1) amortised
 *      peek .......... O(log n) (scan <= log n + 1 roots)
 *      pop ........... O(log n)
 *      merge ......... O(log n)
 *  Compare: binary heap merge O(n); Fibonacci heap insert / merge /
 *  decrease-key O(1) amortised (see docs/DATA-STRUCTURES.md).
 * ============================================================================
 */

import type { Comparator } from './PriorityQueue';

export class BinomialNode<T> {
  value: T;
  degree = 0;
  parent: BinomialNode<T> | null = null;
  child: BinomialNode<T> | null = null;
  sibling: BinomialNode<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

export class BinomialHeap<T> {
  private head: BinomialNode<T> | null = null;
  private count = 0;
  private readonly compare: Comparator<T>;

  constructor(compare: Comparator<T>) {
    this.compare = compare;
  }

  static from<T>(values: Iterable<T>, compare: Comparator<T>): BinomialHeap<T> {
    const heap = new BinomialHeap<T>(compare);
    for (const value of values) heap.insert(value);
    return heap;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** Degrees of the root trees, ascending - mirrors the binary digits of `size`. */
  rootDegrees(): number[] {
    const out: number[] = [];
    for (let node = this.head; node !== null; node = node.sibling) out.push(node.degree);
    return out;
  }

  insert(value: T): void {
    this.head = this.union(this.head, new BinomialNode(value));
    this.count += 1;
  }

  peek(): T | undefined {
    return this.minRoot()?.node.value;
  }

  pop(): T | undefined {
    const found = this.minRoot();
    if (found === null) return undefined;
    const { node, previous } = found;

    // Cut the min tree out of the root list.
    if (previous === null) this.head = node.sibling;
    else previous.sibling = node.sibling;

    // Its children form a binomial heap in DECREASING degree order: reverse it.
    let reversed: BinomialNode<T> | null = null;
    let child = node.child;
    while (child !== null) {
      const next: BinomialNode<T> | null = child.sibling;
      child.sibling = reversed;
      child.parent = null;
      reversed = child;
      child = next;
    }

    this.head = this.union(this.head, reversed);
    this.count -= 1;
    return node.value;
  }

  /** Destructively merge `other` into this heap. O(log n). */
  merge(other: BinomialHeap<T>): this {
    if (other === this) return this;
    this.head = this.union(this.head, other.head);
    this.count += other.count;
    other.head = null;
    other.count = 0;
    return this;
  }

  toSortedArray(): T[] {
    const copy = BinomialHeap.from(this.values(), this.compare);
    const out: T[] = [];
    while (!copy.isEmpty) out.push(copy.pop() as T);
    return out;
  }

  values(): T[] {
    const out: T[] = [];
    const stack: BinomialNode<T>[] = [];
    for (let root = this.head; root !== null; root = root.sibling) stack.push(root);
    while (stack.length > 0) {
      const node = stack.pop() as BinomialNode<T>;
      out.push(node.value);
      for (let c = node.child; c !== null; c = c.sibling) stack.push(c);
    }
    return out;
  }

  // ── internals ──

  private minRoot(): { node: BinomialNode<T>; previous: BinomialNode<T> | null } | null {
    if (this.head === null) return null;
    let best = this.head;
    let bestPrev: BinomialNode<T> | null = null;
    let prev = this.head;
    for (let node = this.head.sibling; node !== null; node = node.sibling) {
      if (this.compare(node.value, best.value) < 0) {
        best = node;
        bestPrev = prev;
      }
      prev = node;
    }
    return { node: best, previous: bestPrev };
  }

  /** Make `child` (same degree) the leftmost child of `parent`. O(1). */
  private link(child: BinomialNode<T>, parent: BinomialNode<T>): void {
    child.parent = parent;
    child.sibling = parent.child;
    parent.child = child;
    parent.degree += 1;
  }

  /** Merge two degree-sorted root lists into one. */
  private mergeRootLists(
    a: BinomialNode<T> | null,
    b: BinomialNode<T> | null,
  ): BinomialNode<T> | null {
    const dummy = new BinomialNode<T>(undefined as unknown as T);
    let tail = dummy;
    while (a !== null && b !== null) {
      if (a.degree <= b.degree) {
        tail.sibling = a;
        a = a.sibling;
      } else {
        tail.sibling = b;
        b = b.sibling;
      }
      tail = tail.sibling;
    }
    tail.sibling = a ?? b;
    return dummy.sibling;
  }

  /** Binary addition of two heaps' root lists. */
  private union(a: BinomialNode<T> | null, b: BinomialNode<T> | null): BinomialNode<T> | null {
    const head = this.mergeRootLists(a, b);
    if (head === null) return null;

    let newHead = head;
    let prev: BinomialNode<T> | null = null;
    let x = head;
    let next = x.sibling;

    while (next !== null) {
      const carryAhead = next.sibling !== null && next.sibling.degree === x.degree;
      if (x.degree !== next.degree || carryAhead) {
        prev = x;
        x = next;
      } else if (this.compare(x.value, next.value) <= 0) {
        x.sibling = next.sibling;
        this.link(next, x);
      } else {
        if (prev === null) newHead = next;
        else prev.sibling = next;
        this.link(x, next);
        x = next;
      }
      next = x.sibling;
    }
    return newHead;
  }
}
