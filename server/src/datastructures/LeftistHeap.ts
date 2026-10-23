/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  LeftistHeap.ts - a mergeable (min-)heap, from scratch.
 *
 *  CS2305 Unit 5 (leftist heap).
 *
 *  THE ONE PLACE IN WATTWAY WHERE MERGING MATTERS
 *  ----------------------------------------------
 *  When a station's ports fault, everyone in its waiting line has to be moved
 *  into the nearest working station's line - without losing their seniority.
 *  Both lines are ordered by (urgent first, then join time), so the job is
 *  "merge two priority queues".
 *
 *    · Binary heap: no structural merge. Concatenate the arrays and re-heapify
 *      - O(n + m).
 *    · Leftist heap: O(log n + log m). The merge only ever walks the two RIGHT
 *      spines, and the leftist property keeps right spines short.
 *
 *  THE LEFTIST PROPERTY
 *  --------------------
 *  Every node stores its s-value / null-path length (npl): the distance to the
 *  nearest missing child (npl(null) = 0, a leaf has npl 1). A heap is leftist
 *  when, at every node, npl(left) >= npl(right). Consequence: the right spine
 *  of a tree with n nodes has at most floor(log2(n + 1)) nodes - so a merge
 *  that only walks right spines is logarithmic.
 *
 *  merge(a, b):
 *    1. If either is empty, return the other.
 *    2. Let a be the root with the smaller key.
 *    3. a.right = merge(a.right, b).
 *    4. If npl(a.left) < npl(a.right), swap a's children.
 *    5. a.npl = npl(a.right) + 1.
 *
 *  Insert is "merge with a one-node heap"; delete-min is "merge the root's two
 *  subtrees". Everything is merge.
 *
 *  COMPLEXITY
 *  ----------
 *      merge .......... O(log n + log m)
 *      insert ......... O(log n)
 *      peek ........... O(1)
 *      pop ............ O(log n)
 *      build from n ... O(n) (pairwise merging with a queue of singletons)
 *  Recursion depth of merge is bounded by the two right spines, i.e. O(log n),
 *  so the call stack is never at risk.
 * ============================================================================
 */

import type { Comparator } from './PriorityQueue';

export class LeftistNode<T> {
  value: T;
  left: LeftistNode<T> | null = null;
  right: LeftistNode<T> | null = null;
  /** Null-path length (s-value). */
  npl = 1;

  constructor(value: T) {
    this.value = value;
  }
}

const nplOf = <T>(node: LeftistNode<T> | null): number => (node === null ? 0 : node.npl);

export class LeftistHeap<T> implements Iterable<T> {
  private root: LeftistNode<T> | null = null;
  private count = 0;
  private readonly compare: Comparator<T>;

  /** `compare(a, b) < 0` means `a` comes out first. */
  constructor(compare: Comparator<T>) {
    this.compare = compare;
  }

  /**
   * Build in O(n): start with n one-node heaps in a FIFO, repeatedly merge the
   * front two and append the result (same idea as bottom-up heapify).
   */
  static from<T>(values: Iterable<T>, compare: Comparator<T>): LeftistHeap<T> {
    const heap = new LeftistHeap<T>(compare);
    const pending: (LeftistNode<T> | null)[] = [];
    for (const value of values) {
      pending.push(new LeftistNode(value));
      heap.count += 1;
    }
    let head = 0;
    while (pending.length - head > 1) {
      const a = pending[head];
      const b = pending[head + 1];
      head += 2;
      pending.push(heap.mergeNodes(a, b));
    }
    heap.root = pending.length > head ? pending[head] : null;
    return heap;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  peek(): T | undefined {
    return this.root?.value;
  }

  insert(value: T): void {
    this.root = this.mergeNodes(this.root, new LeftistNode(value));
    this.count += 1;
  }

  pop(): T | undefined {
    const root = this.root;
    if (root === null) return undefined;
    this.root = this.mergeNodes(root.left, root.right);
    this.count -= 1;
    return root.value;
  }

  /**
   * Destructively merge `other` into this heap in O(log n + log m). `other` is
   * left empty, because its nodes now belong to this tree - sharing them would
   * let a later pop on one heap corrupt the other.
   */
  merge(other: LeftistHeap<T>): this {
    if (other === this) return this;
    this.root = this.mergeNodes(this.root, other.root);
    this.count += other.count;
    other.root = null;
    other.count = 0;
    return this;
  }

  /** Length of the right spine - the quantity the leftist property bounds. */
  rightSpineLength(): number {
    let length = 0;
    for (let node = this.root; node !== null; node = node.right) length += 1;
    return length;
  }

  /** Check heap order, the leftist property and every stored npl. O(n). */
  isValid(): boolean {
    let ok = true;
    let seen = 0;
    const check = (node: LeftistNode<T> | null): number => {
      if (node === null) return 0;
      seen += 1;
      const l = check(node.left);
      const r = check(node.right);
      if (l < r) ok = false;
      if (node.npl !== r + 1) ok = false;
      if (node.left && this.compare(node.value, node.left.value) > 0) ok = false;
      if (node.right && this.compare(node.value, node.right.value) > 0) ok = false;
      return r + 1;
    };
    check(this.root);
    return ok && seen === this.count;
  }

  /** Drain a copy in priority order; this heap is untouched. O(n log n). */
  toSortedArray(): T[] {
    const copy = LeftistHeap.from(this.values(), this.compare);
    const out: T[] = [];
    while (!copy.isEmpty) out.push(copy.pop() as T);
    return out;
  }

  /** Every value, in no particular order. O(n), iterative. */
  values(): T[] {
    const out: T[] = [];
    const stack: LeftistNode<T>[] = this.root ? [this.root] : [];
    while (stack.length > 0) {
      const node = stack.pop() as LeftistNode<T>;
      out.push(node.value);
      if (node.right) stack.push(node.right);
      if (node.left) stack.push(node.left);
    }
    return out;
  }

  clear(): void {
    this.root = null;
    this.count = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.toSortedArray();
  }

  private mergeNodes(a: LeftistNode<T> | null, b: LeftistNode<T> | null): LeftistNode<T> | null {
    if (a === null) return b;
    if (b === null) return a;
    // Step 2: the smaller root wins (ties keep `a`, so earlier heaps win ties).
    if (this.compare(b.value, a.value) < 0) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    // Step 3: merge down the right spine.
    a.right = this.mergeNodes(a.right, b);
    // Step 4: restore the leftist property.
    if (nplOf(a.left) < nplOf(a.right)) {
      const tmp = a.left;
      a.left = a.right;
      a.right = tmp;
    }
    // Step 5.
    a.npl = nplOf(a.right) + 1;
    return a;
  }
}
