/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * lab/MinHeap.ts — a hand-written binary min-heap for the Algorithm Lab.
 *
 * Array-backed: the children of index i live at 2i+1 and 2i+2. No library.
 * Duplicate priorities are fine; Dijkstra and A* use "lazy deletion" (push a
 * fresh entry on every improvement and skip stale ones when popped), so there is
 * no decrease-key to support.
 *
 * push / pop are O(log n); peek / size are O(1).
 * ---------------------------------------------------------------------------
 */

export interface HeapEntry<T> {
  priority: number;
  value: T;
}

export class LabMinHeap<T> {
  private readonly items: HeapEntry<T>[] = [];

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  peek(): HeapEntry<T> | undefined {
    return this.items[0];
  }

  push(priority: number, value: T): void {
    this.items.push({ priority, value });
    this.siftUp(this.items.length - 1);
  }

  pop(): HeapEntry<T> | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top === undefined || last === undefined) return undefined;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.items[parent].priority <= this.items[child].priority) break;
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
      let smallest = parent;
      if (left < n && this.items[left].priority < this.items[smallest].priority) smallest = left;
      if (right < n && this.items[right].priority < this.items[smallest].priority) smallest = right;
      if (smallest === parent) return;
      this.swap(parent, smallest);
      parent = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = tmp;
  }
}
