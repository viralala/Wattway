/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * LinkedList.test.ts — singly, doubly and circular lists (Lab 3), fast/slow
 * pointers and Josephus. No database, no Express.
 * ---------------------------------------------------------------------------
 */

import {
  CircularLinkedList,
  DoublyLinkedList,
  ListNode,
  SinglyLinkedList,
  hasCycleFrom,
  josephus,
  josephusSurvivorIndex,
  middleFrom,
} from '../../src/datastructures/LinkedList';

/** Deterministic PRNG so property tests are reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('SinglyLinkedList — Lab 3 operations', () => {
  it('starts empty', () => {
    const list = new SinglyLinkedList<number>();
    expect(list.size).toBe(0);
    expect(list.isEmpty).toBe(true);
    expect(list.toArray()).toEqual([]);
    expect(list.removeHead()).toBeUndefined();
    expect(list.removeTail()).toBeUndefined();
    expect(list.middle()).toBeUndefined();
    expect(list.hasCycle()).toBe(false);
  });

  it('inserts at head, tail and position', () => {
    const list = new SinglyLinkedList<string>();
    list.insertAtTail('b');
    list.insertAtHead('a');
    list.insertAtTail('d');
    list.insertAt(2, 'c');
    list.insertAt(0, 'start');
    list.insertAt(list.size, 'end');
    expect(list.toArray()).toEqual(['start', 'a', 'b', 'c', 'd', 'end']);
    expect(list.peekHead()).toBe('start');
    expect(list.peekTail()).toBe('end');
    expect(() => list.insertAt(99, 'x')).toThrow(RangeError);
  });

  it('deletes from head, tail, position and by value — keeping the tail pointer right', () => {
    const list = SinglyLinkedList.from([1, 2, 3, 4, 5]);
    expect(list.removeHead()).toBe(1);
    expect(list.removeTail()).toBe(5);
    expect(list.removeAt(1)).toBe(3);
    expect(list.toArray()).toEqual([2, 4]);
    expect(list.remove((v) => v === 4)).toBe(4);
    expect(list.peekTail()).toBe(2);
    list.insertAtTail(9); // would break if tail were stale
    expect(list.toArray()).toEqual([2, 9]);
    expect(list.remove((v) => v === 42)).toBeUndefined();
  });

  it('handles the single-element case at every removal', () => {
    for (const remove of [
      (l: SinglyLinkedList<number>) => l.removeHead(),
      (l: SinglyLinkedList<number>) => l.removeTail(),
      (l: SinglyLinkedList<number>) => l.removeAt(0),
      (l: SinglyLinkedList<number>) => l.remove(() => true),
    ]) {
      const list = SinglyLinkedList.from([7]);
      expect(remove(list)).toBe(7);
      expect(list.isEmpty).toBe(true);
      list.insertAtTail(8);
      expect(list.toArray()).toEqual([8]);
    }
  });

  it('searches and traverses', () => {
    const list = SinglyLinkedList.from(['x', 'y', 'y', 'z']);
    expect(list.find((v) => v === 'y')).toBe('y');
    expect(list.indexOf((v) => v === 'y')).toBe(1); // first of the duplicates
    expect(list.indexOf((v) => v === 'q')).toBe(-1);
    expect(list.get(3)).toBe('z');
    expect(list.get(4)).toBeUndefined();
    const seen: string[] = [];
    list.forEach((v, i) => seen.push(`${i}:${v}`));
    expect(seen).toEqual(['0:x', '1:y', '2:y', '3:z']);
    expect([...list]).toEqual(['x', 'y', 'y', 'z']);
  });

  it('reverses in place', () => {
    const list = SinglyLinkedList.from([1, 2, 3]);
    list.reverse();
    expect(list.toArray()).toEqual([3, 2, 1]);
    list.insertAtTail(0);
    expect(list.toArray()).toEqual([3, 2, 1, 0]);
  });

  it('matches an array under random operations (property test)', () => {
    const random = rng(42);
    const list = new SinglyLinkedList<number>();
    const model: number[] = [];
    for (let step = 0; step < 2000; step += 1) {
      const op = Math.floor(random() * 5);
      const value = Math.floor(random() * 100);
      if (op === 0) {
        list.insertAtHead(value);
        model.unshift(value);
      } else if (op === 1) {
        list.insertAtTail(value);
        model.push(value);
      } else if (op === 2) {
        const at = Math.floor(random() * (model.length + 1));
        list.insertAt(at, value);
        model.splice(at, 0, value);
      } else if (op === 3 && model.length) {
        const at = Math.floor(random() * model.length);
        expect(list.removeAt(at)).toBe(model.splice(at, 1)[0]);
      } else if (op === 4) {
        expect(list.remove((v) => v === value)).toBe(model.includes(value) ? value : undefined);
        const i = model.indexOf(value);
        if (i !== -1) model.splice(i, 1);
      }
      expect(list.size).toBe(model.length);
    }
    expect(list.toArray()).toEqual(model);
  });
});

describe('Fast & slow pointers', () => {
  it('finds the middle (first middle for even lengths)', () => {
    expect(SinglyLinkedList.from([1]).middle()).toBe(1);
    expect(SinglyLinkedList.from([1, 2]).middle()).toBe(1);
    expect(SinglyLinkedList.from([1, 2, 3]).middle()).toBe(2);
    expect(SinglyLinkedList.from([1, 2, 3, 4]).middle()).toBe(2);
    expect(SinglyLinkedList.from([1, 2, 3, 4, 5]).middle()).toBe(3);
    for (let n = 1; n < 60; n += 1) {
      const values = Array.from({ length: n }, (_, i) => i);
      expect(DoublyLinkedList.from(values).middle()).toBe(Math.floor((n - 1) / 2));
    }
  });

  it('detects a cycle with Floyd, and reports none on healthy lists', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => new ListNode(i));
    nodes.forEach((node, i) => {
      node.next = nodes[i + 1] ?? null;
    });
    expect(hasCycleFrom(nodes[0])).toBe(false);
    expect(middleFrom(nodes[0])?.value).toBe(2);

    nodes[5].next = nodes[2]; // corrupt: tail points back into the list
    expect(hasCycleFrom(nodes[0])).toBe(true);

    const self = new ListNode('loop');
    self.next = self;
    expect(hasCycleFrom(self)).toBe(true);
    expect(hasCycleFrom(null)).toBe(false);

    expect(SinglyLinkedList.from([1, 2, 3]).hasCycle()).toBe(false);
    expect(DoublyLinkedList.from([1, 2, 3]).hasCycle()).toBe(false);
  });
});

describe('DoublyLinkedList — the live waiting line', () => {
  it('pushes and pops at both ends in O(1)', () => {
    const line = new DoublyLinkedList<string>();
    line.pushBack('b');
    line.pushFront('a');
    line.pushBack('c');
    expect(line.toArray()).toEqual(['a', 'b', 'c']);
    expect(line.toArrayReversed()).toEqual(['c', 'b', 'a']);
    expect(line.popFront()).toBe('a');
    expect(line.popBack()).toBe('c');
    expect(line.popBack()).toBe('b');
    expect(line.popFront()).toBeUndefined();
    expect(line.isConsistent()).toBe(true);
  });

  it('unlinks a node from the middle without touching anything else', () => {
    const line = new DoublyLinkedList<string>();
    line.pushBack('ana');
    const bilal = line.pushBack('bilal');
    line.pushBack('chitra');
    expect(line.unlink(bilal)).toBe('bilal');
    expect(line.toArray()).toEqual(['ana', 'chitra']);
    expect(line.toArrayReversed()).toEqual(['chitra', 'ana']);
    expect(line.isConsistent()).toBe(true);
  });

  it('refuses to unlink a stale or foreign node', () => {
    const a = new DoublyLinkedList<number>();
    const b = new DoublyLinkedList<number>();
    const node = a.pushBack(1);
    expect(() => b.unlink(node)).toThrow(/does not belong/);
    a.unlink(node);
    expect(() => a.unlink(node)).toThrow(/does not belong/);
    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
  });

  it('inserts relative to a node and at a position', () => {
    const line = DoublyLinkedList.from([1, 3, 5]);
    const three = line.findNode((v) => v === 3);
    if (!three) throw new Error('missing node');
    line.insertBefore(three, 2);
    line.insertAfter(three, 4);
    line.insertAt(0, 0);
    line.insertAt(line.size, 6);
    expect(line.toArray()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(line.positionOf(three)).toBe(3);
    expect(line.get(5)).toBe(5); // walks from the tail side
    expect(line.removeAt(0)).toBe(0);
    expect(line.remove((v) => v === 6)).toBe(6);
    expect(line.find((v) => v > 3)).toBe(4);
    expect(line.isConsistent()).toBe(true);
  });

  it('matches an array under random inserts and O(1) unlinks (property test)', () => {
    const random = rng(7);
    const line = new DoublyLinkedList<number>();
    const handles = new Map<number, ReturnType<typeof line.pushBack>>();
    const model: number[] = [];
    let next = 0;
    for (let step = 0; step < 3000; step += 1) {
      const op = random();
      if (op < 0.4 || model.length === 0) {
        const id = next++;
        handles.set(id, random() < 0.5 ? line.pushBack(id) : line.pushFront(id));
        if (line.peekBack() === id) model.push(id);
        else model.unshift(id);
      } else if (op < 0.8) {
        const victim = model[Math.floor(random() * model.length)];
        line.unlink(handles.get(victim) as ReturnType<typeof line.pushBack>);
        handles.delete(victim);
        model.splice(model.indexOf(victim), 1);
      } else {
        expect(line.popFront()).toBe(model.shift());
      }
      if (step % 250 === 0) expect(line.isConsistent()).toBe(true);
    }
    expect(line.toArray()).toEqual(model);
    expect(line.toArrayReversed()).toEqual([...model].reverse());
    expect(line.isConsistent()).toBe(true);
  });

  it('clears and stays reusable', () => {
    const line = DoublyLinkedList.from([1, 2, 3]);
    const node = line.first;
    line.clear();
    expect(line.size).toBe(0);
    expect(node?.owner).toBeNull();
    line.pushBack(4);
    expect(line.toArray()).toEqual([4]);
  });
});

describe('CircularLinkedList — round-robin ring', () => {
  it('inserts, deletes, searches and traverses one lap', () => {
    const ring = new CircularLinkedList<string>();
    expect(ring.isProperlyCircular()).toBe(true);
    ring.insertAtTail('b');
    ring.insertAtHead('a');
    ring.insertAtTail('d');
    ring.insertAt(2, 'c');
    expect(ring.toArray()).toEqual(['a', 'b', 'c', 'd']);
    expect(ring.peekHead()).toBe('a');
    expect(ring.peekTail()).toBe('d');
    expect(ring.isProperlyCircular()).toBe(true);
    expect(ring.hasCycle()).toBe(true); // a ring always loops

    expect(ring.removeHead()).toBe('a');
    expect(ring.removeAt(2)).toBe('d'); // the tail
    expect(ring.peekTail()).toBe('c');
    expect(ring.remove((v) => v === 'b')).toBe('b');
    expect(ring.find((v) => v === 'c')).toBe('c');
    expect(ring.toArray()).toEqual(['c']);
    expect(ring.removeHead()).toBe('c');
    expect(ring.isEmpty).toBe(true);
    expect(ring.hasCycle()).toBe(false);
  });

  it('moves the turn pointer around forever', () => {
    const ring = CircularLinkedList.from(['p0', 'p1', 'p2']);
    expect(ring.current()).toBe('p0');
    const turns = Array.from({ length: 7 }, () => ring.advance());
    expect(turns).toEqual(['p1', 'p2', 'p0', 'p1', 'p2', 'p0', 'p1']);
    expect(ring.removeCurrent()).toBe('p1');
    expect(ring.current()).toBe('p2');
    ring.insertBeforeCurrent('new');
    // The newcomer is last in turn order: p2, p0, new.
    expect([ring.current(), ring.advance(), ring.advance(), ring.advance()]).toEqual(['p2', 'p0', 'new', 'p2']);
    expect(ring.isProperlyCircular()).toBe(true);
  });

  it('keeps the tail right when inserting before a turn that sits on the tail', () => {
    const ring = CircularLinkedList.from([1, 2, 3]);
    ring.advance(2); // turn on 3 (the tail)
    ring.insertBeforeCurrent(99);
    expect(ring.toArray()).toEqual([1, 2, 99, 3]);
    expect(ring.peekTail()).toBe(3);
    ring.insertAtTail(4);
    expect(ring.toArray()).toEqual([1, 2, 99, 3, 4]);
  });
});

describe('Josephus', () => {
  /** Brute force on a plain array with index arithmetic. */
  function bruteForce(n: number, k: number): number[] {
    const people = Array.from({ length: n }, (_, i) => i + 1);
    const order: number[] = [];
    let index = 0;
    while (people.length) {
      index = (index + k - 1) % people.length;
      order.push(people.splice(index, 1)[0]);
    }
    return order;
  }

  it('solves the textbook case n = 7, k = 3', () => {
    const { order, survivor } = josephus([1, 2, 3, 4, 5, 6, 7], 3);
    expect(order).toEqual([3, 6, 2, 7, 5, 1, 4]);
    expect(survivor).toBe(4);
  });

  it('agrees with brute force and the recurrence for every n, k up to 25', () => {
    for (let n = 1; n <= 25; n += 1) {
      for (let k = 1; k <= 25; k += 1) {
        const people = Array.from({ length: n }, (_, i) => i + 1);
        const { order, survivor } = josephus(people, k);
        expect(order).toEqual(bruteForce(n, k));
        expect(survivor).toBe(josephusSurvivorIndex(n, k) + 1);
      }
    }
  });

  it('handles the empty ring and rejects a bad k', () => {
    expect(josephus([], 3)).toEqual({ order: [], survivor: undefined });
    expect(() => josephus([1, 2], 0)).toThrow(RangeError);
  });
});
