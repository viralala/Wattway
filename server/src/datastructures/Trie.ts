/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Indexing & Backend  ·  Owner: Viral
 * ============================================================================
 *
 *  Trie.ts - Prefix tree, implemented from first principles.
 *
 *  PRD Section 5 (Data Structures Map) assigns the Trie to:
 *      "Autocomplete for station-name / locality search box ...
 *       O(L) prefix lookup regardless of dataset size, and naturally ranks by
 *       shared prefix."
 *
 *  WHY A TRIE AND NOT A DATABASE REGEX / TEXT INDEX?
 *  ------------------------------------------------
 *  `db.stations.find({ name: /^andh/i })` is O(n) per keystroke and hits the
 *  network. A trie answers from memory in O(L) where L is the length of what
 *  the user has typed so far - independent of how many stations exist. For a
 *  search box that fires on every keypress, that difference is the whole
 *  feature.
 *
 *  DESIGN NOTES
 *  ------------
 *  1. RANKED, NOT JUST MATCHING. Raw prefix matching returns results in
 *     insertion order, which is useless in a UI. Every terminal node stores a
 *     score, and every node caches `bestScore` - the maximum score anywhere in
 *     its subtree. Collecting the top K is then a best-first descent that
 *     prunes any subtree whose ceiling cannot beat the worst result held so
 *     far. In practice that touches a tiny fraction of the subtree.
 *
 *  2. MANY TERMS, ONE STATION. "Tata Power Andheri West" is indexed as the
 *     full phrase *and* as each of its tokens, so typing "andheri" finds it.
 *     Results are de-duplicated by station id, keeping the best-scoring term,
 *     so the dropdown never shows the same station four times.
 *
 *  3. REMOVABLE. An id -> terms reverse map makes "drop this station from the
 *     index" O(number of its terms) instead of a full tree walk, which is what
 *     lets the index update incrementally when an operator renames a station.
 *
 *  4. NORMALISATION AT THE BOUNDARY. Both writes and reads run through
 *     `normalise()`, so "Andhèri", "ANDHERI" and "andheri" collapse to one key
 *     and casing/diacritics never fragment the tree.
 *
 *  COMPLEXITY (L = term length, K = requested result count, A = alphabet size)
 *  --------------------------------------------------------------------------
 *      insert ............................... O(L)
 *      search (exact) ....................... O(L)
 *      hasPrefix / countWithPrefix .......... O(L)
 *      suggest (top-K) ...................... O(L + P log A + K log K), where P
 *                                             is the pruned subtree actually
 *                                             visited (<< full subtree)
 *      remove ............................... O(L)
 * ============================================================================
 */

/** One indexed payload sitting at a terminal node. */
export interface TrieEntry<T> {
  /** Stable identity used for de-duplication and removal (station id). */
  id: string;
  /** The payload handed back to callers. */
  value: T;
  /** Higher wins. See `StationIndex` for how station scores are composed. */
  score: number;
}

/** A single autocomplete hit. */
export interface TrieSuggestion<T> {
  id: string;
  value: T;
  score: number;
  /** The indexed term that matched, already normalised. */
  term: string;
}

export interface TrieStats {
  terms: number;
  entries: number;
  nodes: number;
  maxDepth: number;
}

/**
 * Internal node. `children` is a Map rather than a 26-slot array because
 * station names carry digits, and Indian locality names carry a long tail of
 * characters - a fixed array would be mostly empty.
 */
export class TrieNode<T> {
  children = new Map<string, TrieNode<T>>();
  /** Payloads terminating here, keyed by id so re-inserts overwrite cleanly. */
  entries: Map<string, TrieEntry<T>> | null = null;
  /** Max score anywhere in this subtree. The pruning bound for top-K. */
  bestScore = -Infinity;
  /** Number of terminal entries in this subtree - powers `countWithPrefix`. */
  subtreeEntries = 0;
}

/**
 * Bounded top-K collector.
 *
 * K is small (a dropdown shows ~10 items), so a linear insertion into a sorted
 * array beats the constant factors of a heap and keeps this file free of any
 * dependency on the shared MinHeap, which the routing module owns.
 */
class TopK<T> {
  private readonly items: TrieSuggestion<T>[] = [];

  constructor(private readonly limit: number) {}

  /** Score that a candidate must beat to be worth exploring. */
  get threshold(): number {
    if (this.items.length < this.limit) return -Infinity;
    return this.items[this.items.length - 1].score;
  }

  get full(): boolean {
    return this.items.length >= this.limit;
  }

  offer(candidate: TrieSuggestion<T>): void {
    if (this.full && candidate.score <= this.threshold) return;

    // Same id already held: keep whichever term scored better.
    const existing = this.items.findIndex((item) => item.id === candidate.id);
    if (existing !== -1) {
      if (this.items[existing].score >= candidate.score) return;
      this.items.splice(existing, 1);
    }

    let at = this.items.length;
    while (at > 0 && this.items[at - 1].score < candidate.score) at -= 1;
    this.items.splice(at, 0, candidate);

    if (this.items.length > this.limit) this.items.length = this.limit;
  }

  drain(): TrieSuggestion<T>[] {
    return [...this.items];
  }
}

export class Trie<T> {
  private root = new TrieNode<T>();
  private termCount = 0;
  private entryCount = 0;
  private nodeCount = 1;

  /** id -> the set of terms indexed for it, so removal is cheap. */
  private readonly termsById = new Map<string, Set<string>>();

  // ---------------------------------------------------------------------------
  // Normalisation
  // ---------------------------------------------------------------------------

  /**
   * Fold a raw string into its index key: strip diacritics, lowercase, reduce
   * punctuation to single spaces. "Tata Power - Andhèri (West)" becomes
   * "tata power andheri west".
   */
  static normalise(raw: string): string {
    return raw
      .normalize('NFD')
      .replace(/\p{M}/gu, '') // drop combining marks left behind by NFD
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Split a phrase into the tokens worth indexing individually. */
  static tokenise(raw: string): string[] {
    const normalised = Trie.normalise(raw);
    if (!normalised) return [];
    return normalised.split(' ').filter((token) => token.length > 1);
  }

  // ---------------------------------------------------------------------------
  // Size
  // ---------------------------------------------------------------------------

  /** Number of distinct indexed terms. */
  get size(): number {
    return this.termCount;
  }

  /** Number of (term, id) pairs stored. */
  get entries(): number {
    return this.entryCount;
  }

  get isEmpty(): boolean {
    return this.termCount === 0;
  }

  clear(): void {
    this.root = new TrieNode<T>();
    this.termCount = 0;
    this.entryCount = 0;
    this.nodeCount = 1;
    this.termsById.clear();
  }

  // ---------------------------------------------------------------------------
  // Insert
  // ---------------------------------------------------------------------------

  /**
   * Index `term` as a route to `entry`. Re-inserting the same (term, id) pair
   * updates the score in place rather than duplicating it.
   */
  insert(term: string, entry: TrieEntry<T>): this {
    const key = Trie.normalise(term);
    if (!key) return this;

    const path: TrieNode<T>[] = [this.root];
    let node = this.root;

    for (const char of key) {
      let next = node.children.get(char);
      if (!next) {
        next = new TrieNode<T>();
        node.children.set(char, next);
        this.nodeCount += 1;
      }
      node = next;
      path.push(node);
    }

    if (node.entries === null) {
      node.entries = new Map<string, TrieEntry<T>>();
      this.termCount += 1;
    }

    const isNewEntry = !node.entries.has(entry.id);
    node.entries.set(entry.id, { ...entry });
    if (isNewEntry) this.entryCount += 1;

    let terms = this.termsById.get(entry.id);
    if (!terms) {
      terms = new Set<string>();
      this.termsById.set(entry.id, terms);
    }
    terms.add(key);

    // A score can go down on re-insert, so refresh the whole spine rather than
    // just raising the maxima.
    Trie.refreshPath(path);
    return this;
  }

  /**
   * Index a phrase under the full string *and* each of its tokens, so a
   * station is findable by any word in its name or locality.
   *
   * Token entries are scored slightly below the full phrase (`tokenPenalty`),
   * which keeps a whole-name match ahead of an incidental word match when both
   * are in play.
   */
  insertPhrase(phrase: string, entry: TrieEntry<T>, tokenPenalty = 0.15): this {
    const full = Trie.normalise(phrase);
    if (!full) return this;

    this.insert(full, entry);

    const tokens = Trie.tokenise(phrase);
    if (tokens.length <= 1) return this;

    for (const token of tokens) {
      if (token === full) continue;
      this.insert(token, { ...entry, score: entry.score * (1 - tokenPenalty) });
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  /** Walk to the node owning `prefix`, or null if the prefix is absent. */
  private nodeFor(prefix: string): TrieNode<T> | null {
    let node = this.root;
    for (const char of prefix) {
      const next = node.children.get(char);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  /** Exact-term lookup. Returns every payload indexed under that exact term. */
  search(term: string): T[] {
    const key = Trie.normalise(term);
    if (!key) return [];
    const node = this.nodeFor(key);
    if (!node || !node.entries) return [];
    return [...node.entries.values()].map((entry) => entry.value);
  }

  hasTerm(term: string): boolean {
    const key = Trie.normalise(term);
    if (!key) return false;
    const node = this.nodeFor(key);
    return node !== null && node.entries !== null && node.entries.size > 0;
  }

  hasPrefix(prefix: string): boolean {
    const key = Trie.normalise(prefix);
    if (!key) return !this.isEmpty;
    return this.nodeFor(key) !== null;
  }

  /** How many (term, id) pairs live under `prefix`. O(L), thanks to the cache. */
  countWithPrefix(prefix: string): number {
    const key = Trie.normalise(prefix);
    if (!key) return this.entryCount;
    const node = this.nodeFor(key);
    return node ? node.subtreeEntries : 0;
  }

  /** Every complete term under `prefix`, in lexicographic order. */
  termsWithPrefix(prefix: string, limit = Infinity): string[] {
    const key = Trie.normalise(prefix);
    const start = key ? this.nodeFor(key) : this.root;
    if (!start) return [];

    const out: string[] = [];
    // Explicit stack keeps deep tries (long locality names) off the call stack.
    const stack: Array<{ node: TrieNode<T>; term: string }> = [{ node: start, term: key }];

    while (stack.length > 0 && out.length < limit) {
      const { node, term } = stack.pop()!;
      if (node.entries && node.entries.size > 0) out.push(term);

      // Push in reverse so the smallest character is popped first.
      const chars = [...node.children.keys()].sort().reverse();
      for (const char of chars) {
        stack.push({ node: node.children.get(char)!, term: term + char });
      }
    }

    return out.slice(0, limit === Infinity ? undefined : limit).sort();
  }

  // ---------------------------------------------------------------------------
  // Ranked autocomplete - the reason this trie exists
  // ---------------------------------------------------------------------------

  /**
   * Top `limit` payloads whose indexed term starts with `prefix`, best score
   * first, de-duplicated by id.
   *
   * This is what `GET /api/search/autocomplete?q=andh` calls on every keypress.
   *
   * The walk is a best-first descent: children are visited in descending
   * `bestScore` order, and any child whose ceiling cannot beat the worst
   * result already held is skipped entirely. Once the collector is full, that
   * bound tightens with every hit, so most of the subtree is never touched.
   */
  suggest(prefix: string, limit = 10): TrieSuggestion<T>[] {
    if (limit <= 0) return [];

    const key = Trie.normalise(prefix);
    const start = key ? this.nodeFor(key) : this.root;
    if (!start) return [];

    const collector = new TopK<T>(limit);
    const stack: Array<{ node: TrieNode<T>; term: string }> = [{ node: start, term: key }];

    while (stack.length > 0) {
      const { node, term } = stack.pop()!;

      // Prune: nothing in this subtree can displace what we already hold.
      if (collector.full && node.bestScore <= collector.threshold) continue;

      if (node.entries) {
        for (const entry of node.entries.values()) {
          collector.offer({ id: entry.id, value: entry.value, score: entry.score, term });
        }
      }

      // Sort ascending and push, so the highest-ceiling child is popped first.
      const children = [...node.children.entries()].sort(
        (a, b) => a[1].bestScore - b[1].bestScore,
      );
      for (const [char, child] of children) {
        if (collector.full && child.bestScore <= collector.threshold) continue;
        stack.push({ node: child, term: term + char });
      }
    }

    return collector.drain();
  }

  // ---------------------------------------------------------------------------
  // Remove
  // ---------------------------------------------------------------------------

  /** Drop one (term, id) pair. Returns true if something was removed. */
  remove(term: string, id: string): boolean {
    const key = Trie.normalise(term);
    if (!key) return false;

    const path: TrieNode<T>[] = [this.root];
    let node = this.root;
    for (const char of key) {
      const next = node.children.get(char);
      if (!next) return false;
      node = next;
      path.push(node);
    }

    if (!node.entries || !node.entries.delete(id)) return false;
    this.entryCount -= 1;

    if (node.entries.size === 0) {
      node.entries = null;
      this.termCount -= 1;
    }

    const terms = this.termsById.get(id);
    if (terms) {
      terms.delete(key);
      if (terms.size === 0) this.termsById.delete(id);
    }

    this.pruneEmptyTail(key, path);
    Trie.refreshPath(path);
    return true;
  }

  /**
   * Drop every term pointing at `id`. This is the one the index calls when a
   * station is deleted or renamed. O(total length of that station's terms).
   */
  removeById(id: string): number {
    const terms = this.termsById.get(id);
    if (!terms) return 0;
    let removed = 0;
    for (const term of [...terms]) {
      if (this.remove(term, id)) removed += 1;
    }
    return removed;
  }

  /** Terms currently indexed for an id. Mostly useful in tests and diagnostics. */
  termsFor(id: string): string[] {
    const terms = this.termsById.get(id);
    return terms ? [...terms].sort() : [];
  }

  /**
   * Walk back up the removed term's path detaching nodes that no longer lead
   * anywhere, so a long-lived index does not accumulate dead branches.
   */
  private pruneEmptyTail(key: string, path: TrieNode<T>[]): void {
    for (let depth = path.length - 1; depth > 0; depth -= 1) {
      const node = path[depth];
      if (node.children.size > 0 || (node.entries && node.entries.size > 0)) break;
      const parent = path[depth - 1];
      parent.children.delete(key[depth - 1]);
      this.nodeCount -= 1;
      path.pop();
    }
  }

  // ---------------------------------------------------------------------------
  // Maintenance & diagnostics
  // ---------------------------------------------------------------------------

  /**
   * Recompute `bestScore` and `subtreeEntries` for a root-to-leaf path,
   * deepest node first. Derived from children rather than patched with deltas,
   * so callers only have to get the path right.
   */
  private static refreshPath<T>(path: readonly TrieNode<T>[]): void {
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const node = path[i];
      let best = -Infinity;
      let count = 0;

      if (node.entries) {
        for (const entry of node.entries.values()) {
          if (entry.score > best) best = entry.score;
          count += 1;
        }
      }
      for (const child of node.children.values()) {
        if (child.bestScore > best) best = child.bestScore;
        count += child.subtreeEntries;
      }

      node.bestScore = best;
      node.subtreeEntries = count;
    }
  }

  stats(): TrieStats {
    let maxDepth = 0;
    const stack: Array<{ node: TrieNode<T>; depth: number }> = [{ node: this.root, depth: 0 }];
    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (depth > maxDepth) maxDepth = depth;
      for (const child of node.children.values()) stack.push({ node: child, depth: depth + 1 });
    }
    return {
      terms: this.termCount,
      entries: this.entryCount,
      nodes: this.nodeCount,
      maxDepth,
    };
  }
}

export default Trie;
