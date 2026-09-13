/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Indexing & Backend  ·  Owner: Viral
 * ============================================================================
 *
 *  BST.ts - Binary Search Tree, implemented from first principles.
 *
 *  PRD Section 5 (Data Structures Map) assigns the Tree to:
 *      "Index of stations keyed by price-per-kWh (and a second BST keyed by
 *       average rating) to answer range queries like
 *       'stations between Rs.8-Rs.12/kWh near me'."
 *
 *  WHY A BST AND NOT A SORTED ARRAY?
 *  ---------------------------------
 *  A sorted array gives O(log n) binary search too, but every insert or delete
 *  costs O(n) because elements must shift. Station prices and ratings change
 *  while the server is live (an operator edits a tariff, a driver leaves a
 *  review), so the index must support cheap point updates as well as fast
 *  range scans. A BST gives O(log n) for both on a balanced tree.
 *
 *  DESIGN NOTES
 *  ------------
 *  1. DUPLICATE KEYS. Many stations share a price (Rs.12.00/kWh is common), so
 *     a node stores a *bucket* of values rather than a single payload. This
 *     keeps the tree shallow and makes "all stations at exactly Rs.12" an
 *     O(log n) hit.
 *
 *  2. SUBTREE SIZES. Every node caches the number of payloads in its subtree.
 *     That buys us `countInRange()` in O(log n) *without* materialising the
 *     matching values - used by the API to report a total result count for
 *     pagination without paying for the whole range scan.
 *
 *  3. BALANCE. A textbook BST degenerates into a linked list when keys arrive
 *     in sorted order - exactly what happens if you stream stations out of
 *     MongoDB with `.sort({ pricePerKwh: 1 })`. Rather than hide that behind a
 *     self-balancing rotation scheme (which stops being a plain BST, and the
 *     PRD asks for a BST), we keep the honest BST and expose two escape
 *     hatches: `BST.fromSorted()` builds a perfectly balanced tree in O(n) via
 *     divide-and-conquer, and `rebalance()` restores balance after heavy
 *     churn. `StationIndex` (src/services/stationIndex.ts) calls the balanced
 *     bulk-build on every rebuild, so the live index is never degenerate.
 *
 *  4. ITERATIVE INSERT. Insert is iterative on purpose: it is the one operation
 *     that can be called n times in sorted order, and a recursive version would
 *     overflow the call stack on a degenerate tree before `rebalance()` ever
 *     got a chance to run.
 *
 *  COMPLEXITY (h = tree height; log n when balanced, n in the worst case)
 *  ---------------------------------------------------------------------
 *      insert / search / remove / floor / ceil / nearest .... O(h)
 *      rangeQuery ........................................... O(h + k)
 *      countInRange ......................................... O(h)
 *      inorder / toSortedValues ............................. O(n)
 *      rebalance / fromSorted ............................... O(n)
 * ============================================================================
 */

/** A key/bucket pair as seen from outside the tree. */
export interface BSTEntry<T> {
  key: number;
  values: T[];
}

/** Options accepted by the range operations. */
export interface RangeOptions {
  /** Include values whose key === min. Default `true`. */
  inclusiveMin?: boolean;
  /** Include values whose key === max. Default `true`. */
  inclusiveMax?: boolean;
  /** Stop after this many *values* have been collected. Default: no limit. */
  limit?: number;
  /** Emit keys high -> low instead of low -> high. Default `false`. */
  descending?: boolean;
}

/** Diagnostics shape surfaced by `GET /api/index/stats`. */
export interface BSTStats {
  values: number;
  keys: number;
  height: number;
  idealHeight: number;
  balanced: boolean;
  minKey: number | null;
  maxKey: number | null;
}

/** Internal tree node. Exported only so tests can assert on tree shape. */
export class BSTNode<T> {
  key: number;
  values: T[];
  left: BSTNode<T> | null = null;
  right: BSTNode<T> | null = null;
  /** Number of payload values in this subtree (not the number of nodes). */
  size: number;
  /** Height of this subtree; a leaf has height 1. */
  height = 1;

  constructor(key: number, values: T[]) {
    this.key = key;
    this.values = values;
    this.size = values.length;
  }
}

export class BST<T> {
  private root: BSTNode<T> | null = null;
  /** Total payload count across the whole tree. */
  private valueCount = 0;
  /** Distinct-key count (i.e. number of nodes). */
  private nodeCount = 0;

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Build a perfectly balanced tree from an arbitrary collection in
   * O(n log n) (the sort dominates). This is the entry point the station index
   * uses, because it sidesteps the degenerate-chain problem entirely.
   */
  static build<T>(items: readonly T[], keyOf: (item: T) => number): BST<T> {
    const buckets = new Map<number, T[]>();
    for (const item of items) {
      const key = keyOf(item);
      // Skip un-indexable rows rather than poisoning the tree with NaN keys.
      if (!Number.isFinite(key)) continue;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
    const entries: BSTEntry<T>[] = [...buckets.entries()]
      .map(([key, values]) => ({ key, values }))
      .sort((a, b) => a.key - b.key);
    return BST.fromSorted(entries);
  }

  /**
   * Build a perfectly balanced tree from entries already sorted by ascending,
   * distinct key. O(n). Throws if the precondition is violated, because a
   * silently malformed index is far worse than a loud failure at boot.
   */
  static fromSorted<T>(entries: readonly BSTEntry<T>[]): BST<T> {
    for (let i = 1; i < entries.length; i += 1) {
      if (entries[i].key <= entries[i - 1].key) {
        throw new Error(
          'BST.fromSorted: entries must be sorted by strictly ascending key ' +
            `(index ${i - 1} = ${entries[i - 1].key}, index ${i} = ${entries[i].key})`,
        );
      }
    }
    const tree = new BST<T>();
    tree.root = BST.buildBalanced(entries, 0, entries.length - 1);
    for (const entry of entries) {
      tree.valueCount += entry.values.length;
      tree.nodeCount += 1;
    }
    return tree;
  }

  /** Divide-and-conquer: the middle entry becomes the root of each subtree. */
  private static buildBalanced<T>(
    entries: readonly BSTEntry<T>[],
    lo: number,
    hi: number,
  ): BSTNode<T> | null {
    if (lo > hi) return null;
    const mid = (lo + hi) >> 1;
    const node = new BSTNode<T>(entries[mid].key, [...entries[mid].values]);
    node.left = BST.buildBalanced(entries, lo, mid - 1);
    node.right = BST.buildBalanced(entries, mid + 1, hi);
    BST.recompute(node);
    return node;
  }

  // ---------------------------------------------------------------------------
  // Size / shape
  // ---------------------------------------------------------------------------

  /** Number of payload values stored (duplicates counted individually). */
  get size(): number {
    return this.valueCount;
  }

  /** Number of distinct keys, i.e. the number of nodes. */
  get keyCount(): number {
    return this.nodeCount;
  }

  /** Height of the tree; 0 for an empty tree, 1 for a single node. */
  get height(): number {
    return this.root ? this.root.height : 0;
  }

  get isEmpty(): boolean {
    return this.root === null;
  }

  /**
   * A tree is "healthy" when its height is within a small constant of the
   * theoretical minimum. The index scheduler uses this to decide whether a run
   * of incremental updates has degraded the tree enough to justify a rebuild.
   */
  isBalanced(slack = 2): boolean {
    if (this.nodeCount === 0) return true;
    const ideal = Math.floor(Math.log2(this.nodeCount)) + 1;
    return this.height <= ideal + slack;
  }

  clear(): void {
    this.root = null;
    this.valueCount = 0;
    this.nodeCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Insert
  // ---------------------------------------------------------------------------

  /**
   * Insert a value under `key`. Duplicate keys append to the existing bucket.
   * Iterative by design - see design note 4 at the top of this file.
   */
  insert(key: number, value: T): this {
    if (!Number.isFinite(key)) {
      throw new Error(`BST.insert: key must be a finite number, received ${String(key)}`);
    }

    if (this.root === null) {
      this.root = new BSTNode<T>(key, [value]);
      this.valueCount += 1;
      this.nodeCount += 1;
      return this;
    }

    const path: BSTNode<T>[] = [];
    let current: BSTNode<T> = this.root;

    for (;;) {
      path.push(current);

      if (key === current.key) {
        current.values.push(value);
        this.valueCount += 1;
        BST.recomputeUp(path);
        return this;
      }

      const goLeft = key < current.key;
      const next = goLeft ? current.left : current.right;

      if (next === null) {
        const created = new BSTNode<T>(key, [value]);
        if (goLeft) current.left = created;
        else current.right = created;
        this.valueCount += 1;
        this.nodeCount += 1;
        BST.recomputeUp(path);
        return this;
      }

      current = next;
    }
  }

  /** Convenience bulk insert. Prefer `BST.build()` when seeding from scratch. */
  insertAll(items: readonly T[], keyOf: (item: T) => number): this {
    for (const item of items) this.insert(keyOf(item), item);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /** All values stored at exactly `key`. Empty array if the key is absent. */
  search(key: number): T[] {
    const node = this.findNode(key);
    return node ? [...node.values] : [];
  }

  has(key: number): boolean {
    return this.findNode(key) !== null;
  }

  private findNode(key: number): BSTNode<T> | null {
    let current = this.root;
    while (current !== null) {
      if (key === current.key) return current;
      current = key < current.key ? current.left : current.right;
    }
    return null;
  }

  /** Smallest key present, with its bucket. */
  min(): BSTEntry<T> | null {
    if (!this.root) return null;
    let current = this.root;
    while (current.left) current = current.left;
    return { key: current.key, values: [...current.values] };
  }

  /** Largest key present, with its bucket. */
  max(): BSTEntry<T> | null {
    if (!this.root) return null;
    let current = this.root;
    while (current.right) current = current.right;
    return { key: current.key, values: [...current.values] };
  }

  /** Greatest key <= `key`, or null. */
  floorKey(key: number): number | null {
    let current = this.root;
    let best: number | null = null;
    while (current !== null) {
      if (current.key === key) return current.key;
      if (current.key < key) {
        best = current.key;
        current = current.right;
      } else {
        current = current.left;
      }
    }
    return best;
  }

  /** Smallest key >= `key`, or null. */
  ceilKey(key: number): number | null {
    let current = this.root;
    let best: number | null = null;
    while (current !== null) {
      if (current.key === key) return current.key;
      if (current.key > key) {
        best = current.key;
        current = current.left;
      } else {
        current = current.right;
      }
    }
    return best;
  }

  /**
   * Entry whose key is numerically closest to `key`. Ties break low, so
   * `nearest(10)` over {8, 12} returns the 8 bucket - cheaper is the friendlier
   * default when a driver asks for "around Rs.10".
   */
  nearest(key: number): BSTEntry<T> | null {
    if (!this.root) return null;
    let current: BSTNode<T> | null = this.root;
    let best: BSTNode<T> = this.root;
    while (current !== null) {
      const delta = Math.abs(current.key - key);
      const bestDelta = Math.abs(best.key - key);
      if (delta < bestDelta || (delta === bestDelta && current.key < best.key)) {
        best = current;
      }
      if (current.key === key) break;
      current = key < current.key ? current.left : current.right;
    }
    return { key: best.key, values: [...best.values] };
  }

  // ---------------------------------------------------------------------------
  // Range queries - the reason this tree exists
  // ---------------------------------------------------------------------------

  /**
   * Flattened values whose key falls inside [min, max].
   * This is what powers `GET /api/search/range?minPrice=8&maxPrice=12`.
   */
  rangeQuery(min: number, max: number, options: RangeOptions = {}): T[] {
    const out: T[] = [];
    const limit = options.limit ?? Infinity;
    for (const entry of this.rangeEntries(min, max, options)) {
      for (const value of entry.values) {
        if (out.length >= limit) return out;
        out.push(value);
      }
    }
    return out;
  }

  /**
   * Key buckets inside [min, max], in key order.
   *
   * The traversal is an explicit-stack in-order walk with two prunes, which is
   * what makes this O(h + k) rather than O(n):
   *
   *   - while descending, a node whose key is already below the lower bound
   *     lets us skip its entire left subtree;
   *   - while collecting, the first key past the upper bound ends the walk,
   *     because in-order emits keys in ascending order.
   *
   * The stack is a plain array local to this method - the shared Stack data
   * structure (owned by the traversal module) is deliberately not imported, so
   * the index layer stays dependency-free and independently testable.
   */
  rangeEntries(min: number, max: number, options: RangeOptions = {}): BSTEntry<T>[] {
    const { inclusiveMin = true, inclusiveMax = true, descending = false, limit } = options;

    if (min > max) return [];

    const out: BSTEntry<T>[] = [];
    const maxValues = limit ?? Infinity;
    let collected = 0;

    const aboveLower = (k: number): boolean => (inclusiveMin ? k >= min : k > min);
    const belowUpper = (k: number): boolean => (inclusiveMax ? k <= max : k < max);

    // `descending` mirrors the whole walk: the other subtree goes first, and
    // the early-exit bound flips from the upper bound to the lower one.
    const first = (n: BSTNode<T>): BSTNode<T> | null => (descending ? n.right : n.left);
    const second = (n: BSTNode<T>): BSTNode<T> | null => (descending ? n.left : n.right);
    const canDescend = (k: number): boolean => (descending ? belowUpper(k) : aboveLower(k));
    const withinExitBound = (k: number): boolean => (descending ? aboveLower(k) : belowUpper(k));

    const stack: BSTNode<T>[] = [];
    let current: BSTNode<T> | null = this.root;

    while (current !== null || stack.length > 0) {
      while (current !== null) {
        if (canDescend(current.key)) {
          stack.push(current);
          current = first(current);
        } else {
          // The whole `first` subtree is outside the range - skip it wholesale.
          current = second(current);
        }
      }

      const node = stack.pop();
      if (!node) break;

      // In-order is monotonic, so the first out-of-bounds key ends the scan.
      if (!withinExitBound(node.key)) break;

      if (aboveLower(node.key) && belowUpper(node.key)) {
        out.push({ key: node.key, values: [...node.values] });
        collected += node.values.length;
        if (collected >= maxValues) break;
      }

      current = second(node);
    }

    return out;
  }

  /**
   * How many values fall inside [min, max], in O(h), *without* touching the
   * values themselves. Used for `total` in paginated API responses.
   */
  countInRange(min: number, max: number, options: RangeOptions = {}): number {
    const { inclusiveMin = true, inclusiveMax = true } = options;
    if (min > max) return 0;
    const upper = inclusiveMax ? this.rankLessOrEqual(max) : this.rankLess(max);
    const lower = inclusiveMin ? this.rankLess(min) : this.rankLessOrEqual(min);
    return Math.max(0, upper - lower);
  }

  /** Number of values with a key strictly less than `key`. O(h). */
  rankLess(key: number): number {
    let current = this.root;
    let acc = 0;
    while (current !== null) {
      if (key <= current.key) {
        current = current.left;
      } else {
        acc += BST.sizeOf(current.left) + current.values.length;
        current = current.right;
      }
    }
    return acc;
  }

  /** Number of values with a key less than or equal to `key`. O(h). */
  rankLessOrEqual(key: number): number {
    let current = this.root;
    let acc = 0;
    while (current !== null) {
      if (key < current.key) {
        current = current.left;
      } else {
        acc += BST.sizeOf(current.left) + current.values.length;
        current = current.right;
      }
    }
    return acc;
  }

  // ---------------------------------------------------------------------------
  // Remove
  // ---------------------------------------------------------------------------

  /**
   * Remove values stored at `key`.
   *
   * With no `match` predicate the whole bucket goes. With one, only the values
   * it selects are dropped, and the node survives if anything is left - this is
   * how a single station is pulled out of the index when its price changes
   * without disturbing the other stations that share that price.
   *
   * Returns the number of values actually removed.
   */
  remove(key: number, match?: (value: T) => boolean): number {
    const path: BSTNode<T>[] = [];
    let current = this.root;

    while (current !== null && current.key !== key) {
      path.push(current);
      current = key < current.key ? current.left : current.right;
    }
    if (current === null) return 0;

    const target = current;
    let removed: number;

    if (match) {
      const kept = target.values.filter((value) => !match(value));
      removed = target.values.length - kept.length;
      if (removed === 0) return 0;
      target.values = kept;
    } else {
      removed = target.values.length;
      target.values = [];
    }

    this.valueCount -= removed;

    if (target.values.length > 0) {
      // Bucket survives: nothing structural changed, just refresh the spine.
      path.push(target);
      BST.recomputeUp(path);
      return removed;
    }

    this.removeNode(target, path);
    this.nodeCount -= 1;
    return removed;
  }

  /** Remove every value matching a predicate, anywhere in the tree. O(n). */
  removeWhere(match: (value: T, key: number) => boolean): number {
    const doomed: Array<{ key: number; values: T[] }> = [];
    for (const entry of this.inorder()) {
      const hits = entry.values.filter((value) => match(value, entry.key));
      if (hits.length > 0) doomed.push({ key: entry.key, values: hits });
    }
    let removed = 0;
    for (const { key, values } of doomed) {
      const doomedSet = new Set(values);
      removed += this.remove(key, (value) => doomedSet.has(value));
    }
    return removed;
  }

  /**
   * Standard Hibbard deletion.
   *
   * `path` holds the ancestors of `node`, root-first. For the two-child case we
   * splice in the in-order successor (smallest key in the right subtree), which
   * by construction has no left child and is therefore trivially detachable.
   */
  private removeNode(node: BSTNode<T>, path: BSTNode<T>[]): void {
    if (node.left !== null && node.right !== null) {
      // Two children - hand the node over to its in-order successor.
      const successorPath: BSTNode<T>[] = [node];
      let successorParent = node;
      let successor = node.right;
      while (successor.left !== null) {
        successorPath.push(successor);
        successorParent = successor;
        successor = successor.left;
      }

      node.key = successor.key;
      node.values = successor.values;

      // Detach the successor, which has at most a right child.
      if (successorParent === node) successorParent.right = successor.right;
      else successorParent.left = successor.right;

      BST.recomputeUp([...path, ...successorPath]);
      return;
    }

    // Zero or one child - promote whichever child exists (possibly null).
    const child = node.left ?? node.right;
    const parent = path.length > 0 ? path[path.length - 1] : null;

    if (parent === null) {
      this.root = child;
    } else if (parent.left === node) {
      parent.left = child;
    } else {
      parent.right = child;
    }

    BST.recomputeUp(path);
  }

  // ---------------------------------------------------------------------------
  // Traversal & maintenance
  // ---------------------------------------------------------------------------

  /** Every bucket in ascending key order. Iterative, so height is irrelevant. */
  inorder(): BSTEntry<T>[] {
    const out: BSTEntry<T>[] = [];
    const stack: BSTNode<T>[] = [];
    let current = this.root;
    while (current !== null || stack.length > 0) {
      while (current !== null) {
        stack.push(current);
        current = current.left;
      }
      const node = stack.pop()!;
      out.push({ key: node.key, values: [...node.values] });
      current = node.right;
    }
    return out;
  }

  /** Every value, ascending by key. */
  toSortedValues(): T[] {
    const out: T[] = [];
    for (const entry of this.inorder()) out.push(...entry.values);
    return out;
  }

  /** Ascending iteration over values, so a BST can be spread or for..of'd. */
  *[Symbol.iterator](): IterableIterator<T> {
    for (const entry of this.inorder()) yield* entry.values;
  }

  /**
   * Rebuild the tree perfectly balanced from its own contents. O(n).
   * Cheap enough to run on a schedule; see `StationIndex.maybeRebalance()`.
   */
  rebalance(): this {
    if (this.nodeCount <= 2) return this;
    const entries = this.inorder();
    this.root = BST.buildBalanced(entries, 0, entries.length - 1);
    return this;
  }

  /** Diagnostics surfaced by `GET /api/index/stats`. */
  stats(): BSTStats {
    const lo = this.min();
    const hi = this.max();
    return {
      values: this.valueCount,
      keys: this.nodeCount,
      height: this.height,
      idealHeight: this.nodeCount === 0 ? 0 : Math.floor(Math.log2(this.nodeCount)) + 1,
      balanced: this.isBalanced(),
      minKey: lo ? lo.key : null,
      maxKey: hi ? hi.key : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private static sizeOf<T>(node: BSTNode<T> | null): number {
    return node ? node.size : 0;
  }

  private static heightOf<T>(node: BSTNode<T> | null): number {
    return node ? node.height : 0;
  }

  /** Refresh one node's cached size and height from its children. */
  private static recompute<T>(node: BSTNode<T>): void {
    node.size = node.values.length + BST.sizeOf(node.left) + BST.sizeOf(node.right);
    node.height = 1 + Math.max(BST.heightOf(node.left), BST.heightOf(node.right));
  }

  /**
   * Refresh a root-first path, deepest node first. Recomputing from children
   * (rather than applying +1/-1 deltas) means every structural edit above only
   * has to get the *path* right, not the arithmetic.
   */
  private static recomputeUp<T>(path: readonly BSTNode<T>[]): void {
    for (let i = path.length - 1; i >= 0; i -= 1) BST.recompute(path[i]);
  }
}

export default BST;
