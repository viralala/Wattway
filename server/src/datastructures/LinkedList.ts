/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  LinkedList.ts - singly, doubly and circular linked lists, from scratch.
 *
 *  CS2305 Unit 2 (pointers, dynamic memory, fast & slow pointers, singly /
 *  doubly / circular lists) and Lab 3 (insert, delete, search, traverse).
 *
 *  WHERE EACH VARIANT IS USED IN WATTWAY
 *  -------------------------------------
 *  SinglyLinkedList   trip history, most recent first (insert at head).
 *                     `Trip.previousTrip` in MongoDB is literally the `next`
 *                     pointer of this list - see services/tripService.ts.
 *                     Also exported as `LinkedList` for the graph module's
 *                     adjacency lists.
 *
 *  DoublyLinkedList   the live waiting line of a station. A driver who gives up
 *                     and leaves from the middle of the line is unlinked in
 *                     O(1): a hash index maps userId -> node, and a node knows
 *                     both neighbours, so nothing has to shift. An array would
 *                     pay O(n) to close the gap - that is the viva point.
 *
 *  CircularLinkedList round-robin port rotation. When every port is busy and
 *                     fast-charge slots are time-sliced, a "turn" pointer walks
 *                     around the circle forever without ever hitting a null.
 *                     The Josephus problem runs on the same list.
 *
 *  FAST & SLOW POINTERS
 *  --------------------
 *  `middle()`   slow moves 1, fast moves 2; when fast falls off the end, slow
 *               is at the middle. One pass, O(1) extra space. The operator view
 *               uses it for "half the queue will be served by ...".
 *  `hasCycle()` Floyd's tortoise and hare. A *linear* list must never contain a
 *               cycle - if a bug ever wired a node back into the line, every
 *               traversal would spin forever. This is the integrity check.
 *
 *  MEMORY NOTE
 *  -----------
 *  JavaScript has no malloc/free; `new ListNode()` is the dynamic allocation and
 *  dropping the last reference to a node is the free (the GC reclaims it). The
 *  unlink routines null out a removed node's pointers so a stale handle cannot
 *  keep a whole chain alive, or be used to corrupt the list.
 *
 *  COMPLEXITY (n = number of nodes)
 *  --------------------------------
 *                         Singly        Doubly        Circular
 *      insert head ...... O(1)          O(1)          O(1)
 *      insert tail ...... O(1)*         O(1)          O(1)
 *      insert at pos .... O(pos)        O(min(pos, n-pos))  O(pos)
 *      remove head ...... O(1)          O(1)          O(1)
 *      remove tail ...... O(n)          O(1)          O(n)
 *      remove node ...... -             O(1)          -
 *      remove at pos .... O(pos)        O(min(pos, n-pos))  O(pos)
 *      search ........... O(n)          O(n)          O(n)
 *      traverse ......... O(n)          O(n)          O(n)
 *      middle / hasCycle  O(n) time, O(1) space
 *      josephus(n, k) ... O(n * k)
 *   (* a tail pointer is kept, so appending does not walk the list.)
 * ============================================================================
 */

// ─── Nodes ──────────────────────────────────────────────────────────────────

/** A node with one forward pointer. */
export class ListNode<T> {
  value: T;
  next: ListNode<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

/** A node with forward and backward pointers. */
export class DListNode<T> {
  value: T;
  next: DListNode<T> | null = null;
  prev: DListNode<T> | null = null;
  /**
   * The list this node currently belongs to, or null once unlinked. Lets
   * `unlink()` reject a node from a different list (or one already removed)
   * instead of silently corrupting both lists' sizes.
   */
  owner: DoublyLinkedList<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

/** Anything with a `next` pointer - enough for the two-pointer helpers. */
export interface ForwardNode {
  next: ForwardNode | null;
}

// ─── Two-pointer helpers (shared by every variant) ──────────────────────────

/**
 * Floyd's cycle detection over any forward-linked chain. O(n) time, O(1) space.
 *
 * Slow advances one node per step, fast advances two. If there is no cycle,
 * fast reaches null. If there is one, fast enters it and gains one node per
 * step on slow, so it must land on slow within one lap.
 */
export function hasCycleFrom(head: ForwardNode | null): boolean {
  let slow = head;
  let fast = head;
  while (fast !== null && fast.next !== null) {
    slow = (slow as ForwardNode).next;
    fast = fast.next.next;
    if (slow === fast) return true;
  }
  return false;
}

/**
 * The middle node of a null-terminated chain. For an even length this is the
 * *first* of the two middles (position floor((n-1)/2), 0-based), which is the
 * natural reading of "half the queue served".
 */
export function middleFrom<N extends ForwardNode>(head: N | null): N | null {
  if (head === null) return null;
  let slow: ForwardNode = head;
  let fast: ForwardNode = head;
  while (fast.next !== null && fast.next.next !== null) {
    slow = slow.next as ForwardNode;
    fast = fast.next.next;
  }
  return slow as N;
}

function assertIndex(index: number, max: number): void {
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new RangeError(`Position ${index} is out of bounds (0..${max})`);
  }
}

// ─── Singly linked list ─────────────────────────────────────────────────────

export class SinglyLinkedList<T> implements Iterable<T> {
  private head: ListNode<T> | null = null;
  private tail: ListNode<T> | null = null;
  private count = 0;

  static from<T>(values: Iterable<T>): SinglyLinkedList<T> {
    const list = new SinglyLinkedList<T>();
    for (const value of values) list.insertAtTail(value);
    return list;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** First node, for read-only walks (e.g. the cycle check). */
  get headNode(): ListNode<T> | null {
    return this.head;
  }

  /** O(1). */
  insertAtHead(value: T): ListNode<T> {
    const node = new ListNode(value);
    node.next = this.head;
    this.head = node;
    if (this.tail === null) this.tail = node;
    this.count += 1;
    return node;
  }

  /** O(1) thanks to the tail pointer. */
  insertAtTail(value: T): ListNode<T> {
    const node = new ListNode(value);
    if (this.tail === null) {
      this.head = node;
      this.tail = node;
    } else {
      this.tail.next = node;
      this.tail = node;
    }
    this.count += 1;
    return node;
  }

  /** Insert so the value ends up at 0-based `position` (0..size). O(position). */
  insertAt(position: number, value: T): ListNode<T> {
    assertIndex(position, this.count);
    if (position === 0) return this.insertAtHead(value);
    if (position === this.count) return this.insertAtTail(value);

    const before = this.nodeAt(position - 1) as ListNode<T>;
    const node = new ListNode(value);
    node.next = before.next;
    before.next = node;
    this.count += 1;
    return node;
  }

  /** O(1). */
  removeHead(): T | undefined {
    const node = this.head;
    if (node === null) return undefined;
    this.head = node.next;
    if (this.head === null) this.tail = null;
    node.next = null;
    this.count -= 1;
    return node.value;
  }

  /** O(n): a singly list has to find the node before the tail. */
  removeTail(): T | undefined {
    if (this.count <= 1) return this.removeHead();
    const before = this.nodeAt(this.count - 2) as ListNode<T>;
    const node = before.next as ListNode<T>;
    before.next = null;
    this.tail = before;
    this.count -= 1;
    return node.value;
  }

  /** Remove the value at 0-based `position`. O(position). */
  removeAt(position: number): T | undefined {
    if (this.count === 0) return undefined;
    assertIndex(position, this.count - 1);
    if (position === 0) return this.removeHead();

    const before = this.nodeAt(position - 1) as ListNode<T>;
    const node = before.next as ListNode<T>;
    before.next = node.next;
    if (node === this.tail) this.tail = before;
    node.next = null;
    this.count -= 1;
    return node.value;
  }

  /** Remove the first value matching `predicate`. O(n). */
  remove(predicate: (value: T) => boolean): T | undefined {
    let previous: ListNode<T> | null = null;
    let current = this.head;
    while (current !== null) {
      if (predicate(current.value)) {
        if (previous === null) return this.removeHead();
        previous.next = current.next;
        if (current === this.tail) this.tail = previous;
        current.next = null;
        this.count -= 1;
        return current.value;
      }
      previous = current;
      current = current.next;
    }
    return undefined;
  }

  /** Linear search. O(n). */
  find(predicate: (value: T) => boolean): T | undefined {
    for (let node = this.head; node !== null; node = node.next) {
      if (predicate(node.value)) return node.value;
    }
    return undefined;
  }

  /** 0-based position of the first match, or -1. O(n). */
  indexOf(predicate: (value: T) => boolean): number {
    let index = 0;
    for (let node = this.head; node !== null; node = node.next) {
      if (predicate(node.value)) return index;
      index += 1;
    }
    return -1;
  }

  /** Value at 0-based position. O(position). */
  get(position: number): T | undefined {
    return this.nodeAt(position)?.value;
  }

  peekHead(): T | undefined {
    return this.head?.value;
  }

  peekTail(): T | undefined {
    return this.tail?.value;
  }

  /** Reverse in place by re-pointing every `next`. O(n), O(1) space. */
  reverse(): this {
    let previous: ListNode<T> | null = null;
    let current = this.head;
    this.tail = this.head;
    while (current !== null) {
      const next: ListNode<T> | null = current.next;
      current.next = previous;
      previous = current;
      current = next;
    }
    this.head = previous;
    return this;
  }

  /** Fast/slow middle. */
  middle(): T | undefined {
    return middleFrom(this.head)?.value;
  }

  /** Floyd integrity check - must be false for a healthy list. */
  hasCycle(): boolean {
    return hasCycleFrom(this.head);
  }

  /** Traverse head -> tail. */
  forEach(visit: (value: T, index: number) => void): void {
    let index = 0;
    for (let node = this.head; node !== null; node = node.next) {
      visit(node.value, index);
      index += 1;
    }
  }

  toArray(): T[] {
    const out: T[] = [];
    this.forEach((value) => out.push(value));
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

  private nodeAt(position: number): ListNode<T> | null {
    if (!Number.isInteger(position) || position < 0 || position >= this.count) return null;
    let node = this.head;
    for (let i = 0; i < position && node !== null; i += 1) node = node.next;
    return node;
  }
}

/**
 * Alias for the graph module: an adjacency list is a singly linked list of
 * edges per vertex, so `import { LinkedList }` reads the way the syllabus does.
 */
export { SinglyLinkedList as LinkedList };

// ─── Doubly linked list ─────────────────────────────────────────────────────

export class DoublyLinkedList<T> implements Iterable<T> {
  private head: DListNode<T> | null = null;
  private tail: DListNode<T> | null = null;
  private count = 0;

  static from<T>(values: Iterable<T>): DoublyLinkedList<T> {
    const list = new DoublyLinkedList<T>();
    for (const value of values) list.pushBack(value);
    return list;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get first(): DListNode<T> | null {
    return this.head;
  }

  get last(): DListNode<T> | null {
    return this.tail;
  }

  /** O(1). Returns the node so a caller can hold a handle for O(1) removal. */
  pushFront(value: T): DListNode<T> {
    const node = this.adopt(value);
    node.next = this.head;
    if (this.head !== null) this.head.prev = node;
    this.head = node;
    if (this.tail === null) this.tail = node;
    this.count += 1;
    return node;
  }

  /** O(1). */
  pushBack(value: T): DListNode<T> {
    const node = this.adopt(value);
    node.prev = this.tail;
    if (this.tail !== null) this.tail.next = node;
    this.tail = node;
    if (this.head === null) this.head = node;
    this.count += 1;
    return node;
  }

  /** Insert directly after `anchor`. O(1). */
  insertAfter(anchor: DListNode<T>, value: T): DListNode<T> {
    this.assertOwned(anchor);
    if (anchor === this.tail) return this.pushBack(value);
    const node = this.adopt(value);
    const after = anchor.next as DListNode<T>;
    node.prev = anchor;
    node.next = after;
    anchor.next = node;
    after.prev = node;
    this.count += 1;
    return node;
  }

  /** Insert directly before `anchor`. O(1). */
  insertBefore(anchor: DListNode<T>, value: T): DListNode<T> {
    this.assertOwned(anchor);
    if (anchor === this.head) return this.pushFront(value);
    return this.insertAfter(anchor.prev as DListNode<T>, value);
  }

  /** Insert so the value ends up at 0-based `position` (0..size). */
  insertAt(position: number, value: T): DListNode<T> {
    assertIndex(position, this.count);
    if (position === 0) return this.pushFront(value);
    if (position === this.count) return this.pushBack(value);
    return this.insertBefore(this.nodeAt(position) as DListNode<T>, value);
  }

  /**
   * THE operation this structure exists for: remove a node you already hold a
   * handle to, in O(1). No search, no shifting - just re-point the two
   * neighbours at each other.
   */
  unlink(node: DListNode<T>): T {
    this.assertOwned(node);
    if (node.prev !== null) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next !== null) node.next.prev = node.prev;
    else this.tail = node.prev;

    node.prev = null;
    node.next = null;
    node.owner = null;
    this.count -= 1;
    return node.value;
  }

  /** O(1). */
  popFront(): T | undefined {
    return this.head === null ? undefined : this.unlink(this.head);
  }

  /** O(1) - the doubly list's advantage over the singly one. */
  popBack(): T | undefined {
    return this.tail === null ? undefined : this.unlink(this.tail);
  }

  /** Remove the value at 0-based `position`. */
  removeAt(position: number): T | undefined {
    const node = this.nodeAt(position);
    return node === null ? undefined : this.unlink(node);
  }

  /** Remove the first value matching `predicate`. O(n). */
  remove(predicate: (value: T) => boolean): T | undefined {
    const node = this.findNode(predicate);
    return node === null ? undefined : this.unlink(node);
  }

  /** Linear search returning the node. O(n). */
  findNode(predicate: (value: T) => boolean): DListNode<T> | null {
    for (let node = this.head; node !== null; node = node.next) {
      if (predicate(node.value)) return node;
    }
    return null;
  }

  find(predicate: (value: T) => boolean): T | undefined {
    return this.findNode(predicate)?.value;
  }

  /** 0-based position of a node in this list, by walking back to the head. O(position). */
  positionOf(node: DListNode<T>): number {
    this.assertOwned(node);
    let index = 0;
    for (let cursor = node.prev; cursor !== null; cursor = cursor.prev) index += 1;
    return index;
  }

  /**
   * Node at a 0-based position, walking from whichever end is closer -
   * O(min(position, n - position)), which a singly list cannot do.
   */
  nodeAt(position: number): DListNode<T> | null {
    if (!Number.isInteger(position) || position < 0 || position >= this.count) return null;
    if (position < this.count / 2) {
      let node = this.head;
      for (let i = 0; i < position && node !== null; i += 1) node = node.next;
      return node;
    }
    let node = this.tail;
    for (let i = this.count - 1; i > position && node !== null; i -= 1) node = node.prev;
    return node;
  }

  get(position: number): T | undefined {
    return this.nodeAt(position)?.value;
  }

  peekFront(): T | undefined {
    return this.head?.value;
  }

  peekBack(): T | undefined {
    return this.tail?.value;
  }

  /** Fast/slow middle node. */
  middleNode(): DListNode<T> | null {
    return middleFrom(this.head);
  }

  middle(): T | undefined {
    return this.middleNode()?.value;
  }

  /** Floyd over the forward pointers. */
  hasCycle(): boolean {
    return hasCycleFrom(this.head);
  }

  /**
   * Full structural audit: forward and backward walks agree, `prev` mirrors
   * `next` everywhere, the count is right and there is no cycle. O(n). Used
   * by tests and by the queue service's debug endpoint.
   */
  isConsistent(): boolean {
    if (this.hasCycle()) return false;
    let seen = 0;
    let previous: DListNode<T> | null = null;
    for (let node = this.head; node !== null; node = node.next) {
      if (node.prev !== previous || node.owner !== this) return false;
      previous = node;
      seen += 1;
      if (seen > this.count) return false;
    }
    return previous === this.tail && seen === this.count;
  }

  forEach(visit: (value: T, index: number, node: DListNode<T>) => void): void {
    let index = 0;
    for (let node = this.head; node !== null; node = node.next) {
      visit(node.value, index, node);
      index += 1;
    }
  }

  /** Traverse tail -> head (the backward pointers earn their keep). */
  toArrayReversed(): T[] {
    const out: T[] = [];
    for (let node = this.tail; node !== null; node = node.prev) out.push(node.value);
    return out;
  }

  toArray(): T[] {
    const out: T[] = [];
    this.forEach((value) => out.push(value));
    return out;
  }

  clear(): void {
    for (let node = this.head; node !== null; ) {
      const next: DListNode<T> | null = node.next;
      node.prev = null;
      node.next = null;
      node.owner = null;
      node = next;
    }
    this.head = null;
    this.tail = null;
    this.count = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let node = this.head; node !== null; node = node.next) yield node.value;
  }

  private adopt(value: T): DListNode<T> {
    const node = new DListNode(value);
    node.owner = this;
    return node;
  }

  private assertOwned(node: DListNode<T>): void {
    if (node.owner !== this) {
      throw new Error('Node does not belong to this list (already removed, or from another list)');
    }
  }
}

// ─── Circular linked list ───────────────────────────────────────────────────

/**
 * Singly-linked and circular: `tail.next === head`. Only the tail pointer is
 * stored, because the head is always one hop away from it - so both ends are
 * O(1) to reach with a single field.
 *
 * A separate `turn` cursor supports round-robin: `advance()` moves it one node
 * around the ring and never runs off the end.
 */
export class CircularLinkedList<T> implements Iterable<T> {
  private tail: ListNode<T> | null = null;
  private turn: ListNode<T> | null = null;
  private count = 0;

  static from<T>(values: Iterable<T>): CircularLinkedList<T> {
    const list = new CircularLinkedList<T>();
    for (const value of values) list.insertAtTail(value);
    return list;
  }

  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** O(1). */
  insertAtHead(value: T): void {
    const node = new ListNode(value);
    if (this.tail === null) {
      node.next = node;
      this.tail = node;
      this.turn = node;
    } else {
      node.next = this.tail.next;
      this.tail.next = node;
    }
    this.count += 1;
  }

  /** O(1): insert at head, then declare the new node the tail. */
  insertAtTail(value: T): void {
    this.insertAtHead(value);
    if (this.count > 1) this.tail = (this.tail as ListNode<T>).next;
  }

  /** Insert at 0-based `position` (0..size). O(position). */
  insertAt(position: number, value: T): void {
    assertIndex(position, this.count);
    if (position === 0) {
      this.insertAtHead(value);
      return;
    }
    if (position === this.count) {
      this.insertAtTail(value);
      return;
    }
    const before = this.nodeAt(position - 1) as ListNode<T>;
    const node = new ListNode(value);
    node.next = before.next;
    before.next = node;
    this.count += 1;
  }

  /** O(1). */
  removeHead(): T | undefined {
    if (this.tail === null) return undefined;
    const head = this.tail.next as ListNode<T>;
    return this.unlinkAfter(this.tail, head);
  }

  /** Remove the value at 0-based `position`. O(position). */
  removeAt(position: number): T | undefined {
    if (this.count === 0) return undefined;
    assertIndex(position, this.count - 1);
    const before = position === 0 ? (this.tail as ListNode<T>) : (this.nodeAt(position - 1) as ListNode<T>);
    return this.unlinkAfter(before, before.next as ListNode<T>);
  }

  /** Remove the first value (from the head) matching `predicate`. O(n). */
  remove(predicate: (value: T) => boolean): T | undefined {
    if (this.tail === null) return undefined;
    let before = this.tail;
    for (let i = 0; i < this.count; i += 1) {
      const node = before.next as ListNode<T>;
      if (predicate(node.value)) return this.unlinkAfter(before, node);
      before = node;
    }
    return undefined;
  }

  find(predicate: (value: T) => boolean): T | undefined {
    if (this.tail === null) return undefined;
    let node = this.tail.next as ListNode<T>;
    for (let i = 0; i < this.count; i += 1) {
      if (predicate(node.value)) return node.value;
      node = node.next as ListNode<T>;
    }
    return undefined;
  }

  get(position: number): T | undefined {
    return this.nodeAt(position)?.value;
  }

  peekHead(): T | undefined {
    return this.tail?.next?.value;
  }

  peekTail(): T | undefined {
    return this.tail?.value;
  }

  // ── Round-robin cursor ──

  /** Whose turn it is. */
  current(): T | undefined {
    return this.turn?.value;
  }

  /** Move the turn pointer one step around the ring and return the new holder. */
  advance(steps = 1): T | undefined {
    if (this.turn === null) return undefined;
    for (let i = 0; i < steps; i += 1) this.turn = this.turn.next as ListNode<T>;
    return this.turn.value;
  }

  /** Remove whoever holds the turn; the turn passes to the next node. O(n) to find the predecessor. */
  removeCurrent(): T | undefined {
    if (this.turn === null || this.tail === null) return undefined;
    let before = this.tail;
    while (before.next !== this.turn) before = before.next as ListNode<T>;
    return this.unlinkAfter(before, this.turn);
  }

  /**
   * Insert so the new value is the LAST to get a turn - i.e. immediately before
   * the turn pointer. O(1) without a predecessor search, using the classic
   * "insert after, then swap payloads" trick: a copy of the current holder is
   * placed after it, the old node takes the new value, and the turn moves on
   * to the copy. Used by round-robin so a newcomer waits one full lap.
   */
  insertBeforeCurrent(value: T): void {
    if (this.turn === null || this.tail === null) {
      this.insertAtTail(value);
      return;
    }
    const copy = new ListNode(this.turn.value);
    copy.next = this.turn.next;
    this.turn.next = copy;
    this.turn.value = value;
    if (this.turn === this.tail) this.tail = copy;
    this.turn = copy;
    this.count += 1;
  }

  /** Point the turn back at the head. */
  resetTurn(): void {
    this.turn = this.tail === null ? null : this.tail.next;
  }

  /**
   * Integrity check for a ring: walking `size` steps from the head must land
   * back on the head, and no earlier step may. O(n).
   */
  isProperlyCircular(): boolean {
    if (this.tail === null) return this.count === 0;
    const head = this.tail.next as ListNode<T>;
    let node: ListNode<T> | null = head;
    for (let i = 0; i < this.count; i += 1) {
      if (node === null) return false;
      if (i > 0 && node === head) return false;
      node = node.next;
    }
    return node === head;
  }

  /** Floyd also works on a ring: a non-empty circular list always "has a cycle". */
  hasCycle(): boolean {
    return hasCycleFrom(this.tail);
  }

  /** One lap, starting at the head. */
  toArray(): T[] {
    const out: T[] = [];
    if (this.tail === null) return out;
    let node = this.tail.next as ListNode<T>;
    for (let i = 0; i < this.count; i += 1) {
      out.push(node.value);
      node = node.next as ListNode<T>;
    }
    return out;
  }

  forEach(visit: (value: T, index: number) => void): void {
    this.toArray().forEach(visit);
  }

  clear(): void {
    if (this.tail !== null) this.tail.next = null; // break the ring for the GC
    this.tail = null;
    this.turn = null;
    this.count = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.toArray();
  }

  /**
   * The Josephus elimination, played on THIS ring (destructively): starting at
   * the turn pointer, count `k` people, the k-th is eliminated, counting
   * resumes from the next person. Returns the elimination order; the last value
   * in it is the survivor. O(n * k).
   */
  eliminateEvery(k: number): T[] {
    if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be a positive integer');
    const order: T[] = [];
    if (this.tail === null || this.turn === null) return order;

    // `before` trails the node being counted, so removal is O(1) per victim.
    let before = this.tail;
    while (before.next !== this.turn) before = before.next as ListNode<T>;

    while (this.count > 0) {
      for (let i = 1; i < k; i += 1) before = before.next as ListNode<T>;
      const victim = before.next as ListNode<T>;
      const wasLast = this.count === 1;
      order.push(this.unlinkAfter(before, victim));
      if (wasLast) break;
    }
    return order;
  }

  private nodeAt(position: number): ListNode<T> | null {
    if (this.tail === null || !Number.isInteger(position) || position < 0 || position >= this.count) {
      return null;
    }
    let node = this.tail.next as ListNode<T>;
    for (let i = 0; i < position; i += 1) node = node.next as ListNode<T>;
    return node;
  }

  /** Remove `node`, whose predecessor is `before`. O(1). */
  private unlinkAfter(before: ListNode<T>, node: ListNode<T>): T {
    if (this.count === 1) {
      this.tail = null;
      this.turn = null;
    } else {
      before.next = node.next;
      if (node === this.tail) this.tail = before;
      if (node === this.turn) this.turn = node.next;
    }
    node.next = null;
    this.count -= 1;
    return node.value;
  }
}

// ─── Josephus ───────────────────────────────────────────────────────────────

export interface JosephusResult<T> {
  /** Elimination order; the final element is the survivor. */
  order: T[];
  survivor: T | undefined;
}

/**
 * Josephus on a circular linked list: `people` stand in a ring, every k-th is
 * removed. Classic demo of why a ring needs no "wrap-around" special case.
 */
export function josephus<T>(people: readonly T[], k: number): JosephusResult<T> {
  const ring = CircularLinkedList.from(people);
  const order = ring.eliminateEvery(k);
  return { order, survivor: order[order.length - 1] };
}

/**
 * The closed recurrence J(1) = 0, J(n) = (J(n-1) + k) mod n, giving the
 * 0-based survivor position in O(n). Used to cross-check the list simulation.
 */
export function josephusSurvivorIndex(n: number, k: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
  let survivor = 0;
  for (let size = 2; size <= n; size += 1) survivor = (survivor + k) % size;
  return survivor;
}
