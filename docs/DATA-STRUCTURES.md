# Data Structures in WattWay 🌿

**Team Kothimbir 🌿** · the examiner's map from PRD Section 13 to actual files

PRD Section 13 asks that every course requirement be "traceable to a specific,
working piece of the system for the demo". This document is that trace.

---

## Status at a glance

| Requirement | Where it lives | Status |
| --- | --- | --- |
| **Array** | `server/src/models/Station.ts` — fixed-size port board | ✅ shipped |
| **Tree (BST)** | `server/src/datastructures/BST.ts` — price + rating index | ✅ shipped |
| **Trie** | `server/src/datastructures/Trie.ts` — search autocomplete | ✅ shipped |
| **Linked List** | `server/src/datastructures/LinkedList.ts` — waiting line, trip history, round-robin | ✅ shipped |
| **Stack** | `server/src/datastructures/Stack.ts` | ⏳ pending |
| **Queue** | `server/src/datastructures/Queue.ts` — circular + linked queues, slot scheduler | ✅ shipped |
| **Heap (priority queues)** | `server/src/datastructures/PriorityQueue.ts`, `LeftistHeap.ts`, `BinomialHeap.ts` — urgent queue, DEPQ, heapsort, line merge | ✅ shipped |
| **Heap (Dijkstra)** | `server/src/datastructures/MinHeap.ts` | ⏳ pending |
| **Graph** | `server/src/datastructures/Graph.ts` | ⏳ pending |

Everything marked shipped is implemented from first principles — no library, no
`npm install` standing in for the structure — and unit-tested with no Express,
no Mongoose and no network, exactly as PRD Section 11 requires.

```bash
cd server && npm run test:ds     # 63 assertions, no database needed
```

---

## Tree — Binary Search Tree

**File:** `server/src/datastructures/BST.ts`
**Used by:** `algorithms/rangeQuery.ts` → `GET /api/search/range`
**PRD Section 5:** *"Index of stations keyed by price-per-kWh (and a second BST
keyed by average rating) to answer range queries like 'stations between ₹8–₹12/kWh
near me'."*

### Why a BST and not a sorted array

A sorted array also gives O(log n) binary search, but every insert or delete
costs O(n) because elements shift. Station prices and ratings change while the
server is live — an operator edits a tariff, a driver leaves a review — so the
index needs cheap point updates *and* fast range scans. A balanced BST gives
O(log n) for both.

### Three design decisions worth defending in a viva

**1. Duplicate keys live in buckets.** Many stations share a price (₹12.00/kWh
is common), so a node stores a *list* of stations rather than one. This keeps
the tree shallow — 19 seeded stations occupy only 12 distinct prices — and makes
"every station at exactly ₹12" a single O(log n) hit.

**2. Every node caches its subtree size.** That is what makes `countInRange()`
O(log n) *without touching the values*, which is how the API reports a total
result count for pagination without paying for the whole scan. It is the same
trick an order-statistic tree uses.

**3. Balance is handled honestly, not hidden.** A textbook BST degenerates into
a linked list when keys arrive sorted — precisely what happens streaming
stations out of MongoDB with `.sort({ pricePerKwh: 1 })`. Rather than quietly
substituting an AVL or red-black tree (at which point it is no longer the BST
the PRD asked for), the degenerate case is left visible and two remedies are
exposed:

- `BST.fromSorted()` builds a perfectly balanced tree in O(n) by divide and
  conquer, and is what `StationIndex` uses on every rebuild;
- `rebalance()` restores balance after heavy incremental churn.

There is a test that demonstrates the degeneration and the fix:

```ts
for (let i = 0; i < 64; i += 1) tree.insert(i, station(i));
expect(tree.height).toBe(64);      // a linked list
tree.rebalance();
expect(tree.height).toBe(7);       // floor(log2 64) + 1
```

`GET /api/index/stats` reports `height` alongside `idealHeight` live, so the
same point can be made on a projector without opening an editor.

### The range scan

`rangeEntries()` is an explicit-stack in-order walk with two prunes:

- descending, a node already below the lower bound lets us skip its whole left
  subtree;
- collecting, the first key past the upper bound ends the walk, because in-order
  emits keys ascending.

That is what makes it O(h + k) rather than O(n). The stack is a local array
rather than the shared `Stack` structure, so the index layer stays
dependency-free and independently testable.

### A miniature query planner

When a query bounds **both** price and rating, only one tree can drive the scan.
Choosing badly is expensive: `rating >= 4.5 AND price <= ₹50` should be driven by
the rating tree, since nearly every station passes the price test.

`algorithms/rangeQuery.ts` probes both trees with `countInRange()` — O(log n),
no values materialised — and drives with the more selective one, applying the
other as a residual filter. `?explain=true` reports the decision:

```jsonc
"explain": {
  "drivingIndex": "rating",
  "reason": "Both bounds supplied. The rating bound is more selective (1 candidate vs 19), so it drives the scan and price is applied as a residual filter.",
  "candidatesScanned": 1, "matched": 1, "sortedByIndexScan": false, "tookMs": 0
}
```

It also skips the sort entirely when the driving scan already emitted the
requested order — `sortedByIndexScan` says when that happened.

### Complexity

| Operation | Cost |
| --- | --- |
| `insert` / `search` / `remove` / `floorKey` / `ceilKey` / `nearest` | O(h) |
| `rangeQuery` | O(h + k) |
| `countInRange` / `rankLess` / `rankLessOrEqual` | O(h) |
| `inorder` / `toSortedValues` | O(n) |
| `rebalance` / `BST.fromSorted` | O(n) |

h = log n on a balanced tree, n in the degenerate case.

---

## Trie — prefix tree

**File:** `server/src/datastructures/Trie.ts`
**Used by:** `algorithms/autocomplete.ts` → `GET /api/search/autocomplete`
**PRD Section 5:** *"Autocomplete for station-name / locality search box … O(L)
prefix lookup regardless of dataset size."*

### Why a trie and not a database query

`db.stations.find({ name: /^andh/i })` is O(n) per keystroke and crosses the
network. The trie answers from memory in O(L), where L is the length of what has
been typed — independent of how many stations exist. For a box that fires on
every keypress, that difference *is* the feature.

### Design decisions

**1. Ranked, not merely matching.** Raw prefix matching returns insertion order,
which is useless in a dropdown. Every terminal node carries a score and every
node caches `bestScore` — the maximum anywhere in its subtree. Collecting the
top K is then a best-first descent that prunes any subtree whose ceiling cannot
beat the worst result held so far. In practice that visits a tiny fraction of
the subtree.

**2. Many terms, one station.** "Tata Power Andheri West" is indexed as the full
phrase *and* each token, so typing "andheri" finds it. Results de-duplicate by
station id, keeping the best-scoring term, so the dropdown never shows the same
station four times. The seeded 19 stations produce 172 terms over 1367 nodes.

**3. Removable in O(L).** An id → terms reverse map makes "drop this station"
proportional to that station's terms rather than a full tree walk. That is what
lets the index update incrementally when an operator renames a station, instead
of rebuilding.

**4. Normalisation at the boundary.** Reads and writes both pass through
`normalise()` — NFD, strip combining marks, lowercase, punctuation to spaces —
so "Andhèri", "ANDHERI" and "andheri" are one key and a query can never disagree
with an indexed term about what "the same string" means.

### Two-stage scoring

The score baked into the trie is a property of the **station**: a
confidence-weighted rating, current availability, and a saturating queue
penalty. A Bayesian prior damps a five-star rating backed by one review — the
failure mode that makes autocomplete feel broken.

The score used for ordering adds properties of the **query**, in
`autocomplete.ts`: whether the prefix matched the station's actual name rather
than an incidental word, whether the term was typed in full, how short the
matched term is, and how far away the station is. The algorithm over-fetches
`limit × 4` from the trie before re-ranking, so a result the trie ranked 11th can
still surface.

Splitting it this way matters: the station score changes only when the station
does, so it can be precomputed at index time; the query score changes on every
keystroke and cannot.

### Complexity

| Operation | Cost |
| --- | --- |
| `insert` | O(L) |
| `search` (exact) / `hasPrefix` / `countWithPrefix` | O(L) |
| `suggest` (top-K) | O(L + P log A + K log K), P = pruned subtree actually visited |
| `remove` / `removeById` | O(L) per term |

---

## Array — the port-status board

**File:** `server/src/models/Station.ts`
**Used by:** `PATCH /api/stations/:id/ports/:portIndex`
**PRD Section 5:** *"Slot-status board per station (fixed-size array of port
states: free / occupied / faulted) … O(1) random access to check/flip a specific
port's status."*

Each station carries a fixed array of 1–32 ports. A port's `index` **is** its
array position, assigned once at creation, so flipping port 3 to `occupied` is a
direct index, not a search:

```ts
const port = this.ports[index];   // O(1)
port.status = status;
port.occupiedSince = status === 'occupied' ? new Date() : null;
```

`setPortStatus()` keeps a defensive fallback scan in case the array ever drifts
out of index order, and throws `RangeError` for a port that does not exist —
surfaced by the API as a 404 rather than silently ignored.

Free-port count feeds the recommendation score, so every port change also calls
`stationIndex.upsert()`.

---

## The live index that ties them together

**File:** `server/src/services/stationIndex.ts`

One process-wide singleton owns all three structures over the same station set.

```
priceIndex   BST<IndexedStation>   keyed by pricePerKwh
ratingIndex  BST<IndexedStation>   keyed by rating.average
nameIndex    Trie<IndexedStation>  keyed by name / locality / city / operator
```

**Consistency model.** MongoDB is the source of truth; the index is a derived,
eventually-consistent view.

- Writes through the station controller call `upsert()` / `remove()`
  synchronously, so the index is correct immediately for anything this server
  did. Integration tests assert this for every write path — create, reprice,
  rename, rate, deactivate, port change.
- A periodic `rebuildFromDatabase()` catches writes made by another process, a
  second instance, or a direct database edit during a demo.

**Atomic swap.** A rebuild constructs new structures off to the side and swaps
them in by reference assignment, so a search running concurrently never observes
a half-built tree — it finishes against a consistent, slightly stale snapshot.

**The ghost-entry trap.** `upsert()` removes before inserting, and that is
required for correctness rather than tidiness: a station whose price moves from
₹12 to ₹14 must leave the ₹12 bucket, and only the previously indexed copy knows
where that bucket was. There is a regression test named after exactly this.

---

## Queue & Realtime module (Shreenath)

Three syllabus topics, each tied to a real job in the queue:

| Topic | File | Real use in WattWay | Lab |
| --- | --- | --- | --- |
| Queues + job scheduling | `datastructures/Queue.ts`, `algorithms/scheduler.ts` | Charger-slot scheduler; BFS frontier for routing | Lab 6 |
| Linked lists + fast/slow pointers | `datastructures/LinkedList.ts` | Waiting line, trip history, round-robin ports, Josephus | Lab 3 |
| Priority queues & heaps | `datastructures/PriorityQueue.ts`, `LeftistHeap.ts`, `BinomialHeap.ts` | Urgent queue, operator report, merging a faulted station's line | Units 3 & 5 |

```bash
cd server && npm run test:ds     # includes LinkedList / Queue / PriorityQueue / LeftistHeap suites
```

### Queue — circular array vs linked

**Why circular?** A plain array queue only ever moves `front` and `rear`
rightwards. After `capacity` enqueues the rear hits the end, and the queue reports
"full" even though every slot left of `front` has been dequeued — dead space.
Shifting elements left on dequeue fixes it at O(n) per dequeue. The circular
queue wraps both indices with `(i + 1) % capacity`, so freed slots are reused and
both operations stay O(1). We keep an explicit `count` instead of sacrificing a
slot to tell full from empty.

| | `CircularQueue` | `LinkedQueue` |
| --- | --- | --- |
| enqueue / dequeue / peek | O(1) (amortised O(1) when `growable`) | O(1) |
| memory | O(capacity), contiguous | O(n), one node per item |
| capacity | fixed (throws `QueueOverflowError`) or doubling | unbounded |

### Job scheduling — `GET /api/queue/:stationId/simulate`

A station's k ports are k processors; every driver is a job with an arrival
time, a charge time (burst) and a priority (`urgencyScore`). The same input runs
under three policies and the endpoint returns each timeline plus average wait:

| Policy | Structure | Behaviour |
| --- | --- | --- |
| `fifo` (non-preemptive) | `LinkedQueue` | First come, first served; whoever is charging finishes. |
| `priority` (preemptive) | `MaxPriorityQueue` | An arrival with strictly higher priority than the least urgent car on a port pauses that session (ambulance, battery < 5 %). The paused car re-queues with its remaining time. |
| `round-robin` | `CircularLinkedList` | Ports are time-sliced by `quantum`; the turn pointer walks the ring; newcomers are inserted just before the turn so nobody starves. |

`waiting = finish − arrival − duration`. On the built-in demo input, urgent cars
wait far less under `priority` while ordinary cars wait slightly more — exactly
the trade-off to discuss in the viva. Unit tests check FIFO against a brute-force
earliest-free-port simulation, hand-worked priority and round-robin examples, and
invariants on random input (each job served exactly its duration, no port
double-booked, no car on two ports).

### Linked lists

| Variant | Used for | Key operation |
| --- | --- | --- |
| **Doubly** | the live waiting line (`services/queueService.ts`) | `unlink(node)` in **O(1)** — a `userId → node` index finds the node, and the two neighbours are re-pointed at each other. An array would shift every car behind the leaver: O(n). |
| **Singly** | trip history (`services/tripService.ts`) | `Trip.previousTrip` *is* the `next` pointer. New trip = insert at head; delete = re-point the newer neighbour past the victim. |
| **Circular** | round-robin port rotation; Josephus | the turn pointer never meets a null. `insertBeforeCurrent` is O(1) using the insert-after-and-swap-payloads trick. |

**Fast & slow pointers.** `middle()` (slow +1, fast +2) is shown to drivers and
operators as "half the line is served in ~N minutes". `hasCycle()` (Floyd) is an
integrity check — the operator report returns `linkedListConsistent`, `noCycle`
and `indexMatchesList`.

**Josephus.** `GET /api/queue/demo/josephus?n=7&k=3` plays the elimination on the
circular list and cross-checks the survivor against the recurrence
`J(n) = (J(n−1) + k) mod n`. Unit tests compare against a brute-force array
simulation for every n, k ≤ 25.

| Operation | Singly | Doubly | Circular |
| --- | --- | --- | --- |
| insert head / tail | O(1) / O(1)\* | O(1) / O(1) | O(1) / O(1) |
| insert at position | O(pos) | O(min(pos, n−pos)) | O(pos) |
| delete head / tail | O(1) / O(n) | O(1) / O(1) | O(1) / O(n) |
| delete a held node | — | **O(1)** | — |
| search / traverse | O(n) | O(n) | O(n) |
| middle / hasCycle | O(n) time, O(1) space | same | same |

\* a tail pointer is kept.

### The live waiting line

```
waiting        DoublyLinkedList<LiveDriver>   front = next to charge
waitingByUser  userId -> list node            O(1) leave from anywhere
charging       userId -> LiveDriver           ≤ 32, one per port
lastUrgent     node                           O(1) urgent insert
```

Urgent drivers (emergency, or battery < 5 %) are inserted directly behind the
urgent drivers already waiting, so they always form a prefix of the line.
Wait estimates use a **min-heap of port-free times** — the next driver takes the
earliest-free port, which then frees again after their charge: O(n log k).

**Index coherence.** Every join / leave / allocation / merge writes
`Station.queueLength` and the port board, then calls `stationIndex.upsert()` in
the same request — `queueLength` and free ports feed the search score. The
integration suite has an *index coherence* group asserting that MongoDB, the
`QueueEntry` rows and the in-memory index agree after every write, and that a
long queue lowers a station in autocomplete ranking immediately.

`QueueEntry` in MongoDB is the write-behind log: positions are persisted so a
restart rehydrates the same order. (Battery % and the emergency flag are kept in
memory only, because `QueueEntry` has no fields for them.)

### Priority queues and heaps

| Structure | Where | Why this one |
| --- | --- | --- |
| `BinaryHeap<T>` | everything below; wait estimates | array-backed, comparator-driven; a max-heap is a min-heap with the comparator reversed. Bottom-up `heapify` is O(n). |
| `MaxPriorityQueue<T>` | urgent-charge queue; preemptive scheduler; operator top-N | highest urgency first; a sequence number makes equal priorities FIFO (a bare heap is not stable). |
| `DoubleEndedPriorityQueue<T>` (min-max heap) | operator report: most *and* least urgent driver | both ends O(1), either removal O(log n), one array. Two heaps with cross-links would need double the memory and paired deletes. |
| `heapSort()` | operator report "drivers sorted by wait time" | in place, O(n log n), O(1) extra space. **Not stable** — merge sort is the stable alternative. Passes are recorded for the visualiser. |
| `LeftistHeap<T>` | `POST /api/queue/:stationId/merge` | when a station's ports fault, its line is melded into the nearest station's line by (urgent, join time). Merge walks only the right spines, which the leftist property keeps ≤ log₂(n+1) long. |
| `BinomialHeap<T>` | comparison / optional | union is binary addition of root lists. |

**Why a leftist heap for the merge.** A binary heap has no structural merge:
concatenate and re-heapify, O(n + m). A leftist heap merges in O(log n + log m).
In the live service the lines are doubly linked lists, so building the two
heaps is O(n + m) — the asymptotic win is what you get if lines are *kept* as
leftist heaps, and the endpoint reports the right-spine lengths to show the
bound.

### Binomial vs Fibonacci heaps (written comparison)

| Operation | Binary heap | Leftist heap | Binomial heap | Fibonacci heap |
| --- | --- | --- | --- | --- |
| insert | O(log n) | O(log n) | O(1) amortised, O(log n) worst | **O(1)** |
| find-min | O(1) | O(1) | O(log n) (O(1) with a min pointer) | **O(1)** |
| delete-min | O(log n) | O(log n) | O(log n) | O(log n) amortised |
| decrease-key | O(log n) | O(log n) | O(log n) | **O(1) amortised** |
| merge | O(n) | O(log n) | O(log n) | **O(1)** |

A Fibonacci heap is a lazy binomial heap: inserts and merges just splice root
lists, and the consolidation is paid for during delete-min; decrease-key cuts the
node out and uses "cascading cuts" (marked nodes) to keep trees bushy.

**Why it would speed up Dijkstra (Harshali's module).** Dijkstra does V
delete-mins and up to E decrease-keys. With a binary heap that is
O((V + E) log V). With a Fibonacci heap the E decrease-keys are O(1) amortised,
giving **O(E + V log V)** — a real gain on dense graphs (E ≈ V²). On a sparse
road network (E ≈ V) the two bounds are close and the binary heap's small
constants usually win in practice, which is why the routing module uses a binary
min-heap with lazy deletion.

### Endpoints and events

See [`API.md`](API.md#queue--apiqueue) for request and response shapes.

---

## Reserved for the other modules

The barrels in `server/src/datastructures/index.ts` and
`server/src/algorithms/index.ts` list the expected files with commented export
lines. Uncomment yours next to your file.

| Structure | Expected use (PRD Section 5) |
| --- | --- |
| **Linked List** | ✅ shipped by Queue & Realtime — import `LinkedList` (singly) for graph adjacency lists |
| **Stack** | Iterative DFS for alternate-route exploration; frontend undo-last-search |
| **Queue** | ✅ shipped by Queue & Realtime — import `LinkedQueue` as the BFS frontier |
| **Min-Heap** | Dijkstra's frontier; top-N station ranking by composite score |
| **Graph** | Weighted directed road + station network with battery-range edge pruning |

Two things already exist for you:

- `Station.graphNodeId` — a stable handle to tie a station to a graph vertex
  without matching on coordinates.
- `stationIndex.structures` — read-only access to the live BSTs and Trie, so
  top-N ranking can pull candidates straight out of the price tree instead of
  round-tripping through HTTP.

Read `followthis.md` before you start.

---

<sub>WattWay · Team Kothimbir 🌿</sub>
