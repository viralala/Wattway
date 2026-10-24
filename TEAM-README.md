# WattWay — Team Guide 🌿

**For Team Kothimbir members.** Start here before you change anything. This page covers what exists, who owns
what, how to run it, what is left, and how to get your work merged.

> The project overview is in [`README.md`](README.md). The full rulebook is in [`followthis.md`](followthis.md).
> Read both once. This page is the short version.

---

## 1. What WattWay is

WattWay is an EV charging route and queue optimizer, built as our **Data Structures & Algorithms course project**.
A driver searches for stations, filters them by price and rating, plans a route their battery can finish, and joins
a virtual queue at a charger.

Because it is a DSA project, **every core data structure is written by us from scratch**. Do not use npm packages for
heaps, tries, graphs, queues or lists. That is the whole point of the grade.

---

## 2. Who owns what

| Module | Owner | Data structures | Status |
| --- | --- | --- | --- |
| Indexing & Backend | **Viral** | BST, Trie | ✅ done |
| Queue & Realtime | **Shreenath** | Queue, Linked Lists, Binary / Leftist / Binomial heaps | ✅ done |
| Algorithm Lab (routing) | — | Graph, Min-Heap | ✅ done: Dijkstra, A*, Bellman-Ford, Floyd-Warshall, TSP, battery-aware A* |
| Routing & Pathfinding (real stations) | _unassigned_ | Graph, Min-Heap, Stack | ⏳ `POST /api/routes/plan` still returns 501 |
| Client (website) | _unassigned_ | Stack, Array | 🟡 pages built; Stack not written yet |

**Stay in your own module.** If you need something changed in another module (a model field, a response shape),
ask its owner or say so in your PR. Don't just edit their files.

---

## 3. Every data structure and where it is used

| Structure | File | What it does in WattWay |
| --- | --- | --- |
| **BST** | `server/src/datastructures/BST.ts` | Station index by price and by rating. Range search like "₹8–12/kWh" in O(log n + k). |
| **Trie** | `server/src/datastructures/Trie.ts` | Search-box autocomplete. O(L) per keystroke, where L is how much you've typed, ranked by score. |
| **Queue** (circular array + linked) | `server/src/datastructures/Queue.ts` | Each station's waiting line; job scheduling. |
| **Linked lists** (singly / doubly / circular) | `server/src/datastructures/LinkedList.ts` | Trip history (singly), live waiting line with O(1) leave-from-middle (doubly), charger turn-taking (circular). |
| **Binary heap / priority queues** | `server/src/datastructures/PriorityQueue.ts` | Urgent-charge queue (low battery first); min-max heap so the operator sees the most and least urgent driver. |
| **Leftist heap** | `server/src/datastructures/LeftistHeap.ts` | Merging two stations' lines in O(log n) when one station faults. |
| **Binomial heap** | `server/src/datastructures/BinomialHeap.ts` | Heap comparison for the course write-up. |
| **Graph** (adjacency list) | `server/src/algorithms/lab/graph.ts` | Seeded road map with elevation. Downhill regen can make an edge negative. |
| **Min-heap** | `server/src/algorithms/lab/MinHeap.ts` | The "next to explore" list for Dijkstra and both A* versions. |
| **Stack** | _not written yet_ | Planned: depth-first alternate routes, "undo last search" in the client. |

### Algorithms

| Algorithm | Where | Complexity |
| --- | --- | --- |
| BST range query + index planner | `server/src/algorithms/rangeQuery.ts` | O(log n + k) |
| Trie autocomplete + ranking | `server/src/algorithms/autocomplete.ts` | O(L + results) |
| Slot scheduler (FIFO, priority, round-robin) | `server/src/algorithms/scheduler.ts` | O(n log n) |
| Dijkstra | `server/src/algorithms/lab/pathfinding.ts` | O((V+E) log V) |
| A* and weighted A* | `server/src/algorithms/lab/pathfinding.ts` | same, far fewer nodes explored |
| Bellman-Ford (negative edges) | `server/src/algorithms/lab/pathfinding.ts` | O(V·E) |
| Floyd-Warshall (all pairs) | `server/src/algorithms/lab/pathfinding.ts` | O(V³) |
| TSP: Held-Karp exact, nearest-neighbour greedy | `server/src/algorithms/lab/tsp.ts` | O(k²·2ᵏ) / O(k²) |
| **Battery-aware A\*** (plans charging stops) | `server/src/algorithms/lab/evRoute.ts` | O((S + E·B) log S) |

The detailed explanation of each one, with the reasons to give in a viva, is in
[`docs/DATA-STRUCTURES.md`](docs/DATA-STRUCTURES.md).

---

## 4. Run it on your laptop

You need **Node 18.18 or newer**. MongoDB is optional at first.

### Option A: no database (fastest)

The Algorithm Lab and the website run without MongoDB.

```bash
cd server
npm install
npm run dev:lab
```

In a second terminal:

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5273. The Algorithm Lab works. Stations, login and queue need Option B.

### Option B: full stack with MongoDB

Use a local MongoDB or a free MongoDB Atlas cluster.

```bash
cd server
cp .env.example .env
```

In `.env`, set `MONGO_URI` and two different `JWT_*_SECRET` values (at least 32 characters each). You can generate a
secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then seed the database and start the server:

```bash
npm run seed
npm run dev
```

The API runs on http://localhost:4000. `http://localhost:4000/api/meta` lists every endpoint and which data structure
backs it. Seeded logins are `admin@`, `operator@` and `driver@wattway.dev`, all with password `kothimbir123` (local
only).

---

## 5. Try the algorithms

With the server running:

```bash
curl "http://localhost:4000/api/search/autocomplete?q=andh"
```

```bash
curl "http://localhost:4000/api/search/range?minPrice=9&maxPrice=14&explain=true"
```

```bash
curl -X POST http://localhost:4000/api/algorithms/compare -H "Content-Type: application/json" -d "{\"start\":\"n0\",\"end\":\"n39\"}"
```

```bash
curl -X POST http://localhost:4000/api/algorithms/ev-route -H "Content-Type: application/json" -d "{\"start\":\"n0\",\"end\":\"n39\",\"capacity\":15}"
```

The last one returns the route, where to charge and for how long, and the battery left on arrival.

---

## 6. How to contribute

1. **Pull first.** `git checkout main && git pull`
2. **Branch.** `git checkout -b feat/<your-module>-<thing>`
3. **Build in the right layer.** Code flows downward: `routes → controllers → services → algorithms → datastructures`.
   - `datastructures/` imports nothing from the app (no Express, no Mongoose).
   - `algorithms/` are pure functions: data in, result out.
   - Controllers never hold algorithm logic.
4. **Write tests.** Unit tests go next to the others in `server/tests/`, with no database. Endpoint tests go in
   `server/tests/integration/`.
5. **Run everything before you push.** Run this in `server/`:

   ```bash
   npm run typecheck && npm test
   ```

   Run this in `client/`:

   ```bash
   npm run build && npm test
   ```

6. **Open a PR to `main`.** Say what you added, which data structure it uses, and its complexity.

### House rules (short form)

- Send responses with `ok(res, data)` / `created(res, data)` from `utils/respond.ts`. Never call `res.json()`.
- Throw `ApiError.notFound(...)` and similar. Never hand-build an error response.
- Wrap every async route in `asyncHandler(...)`.
- Validate input with Zod in the route file.
- **After any station write, call `stationIndex.upsert(...)`**, or the BST and Trie serve stale data.

---

## 7. What is left to do

| Task | Module | Notes |
| --- | --- | --- |
| `Stack.ts` + tests | Routing / Client | The only required structure still missing. Use it for depth-first alternate routes and "undo last search". |
| `POST /api/routes/plan` on real stations | Routing | Swap the 501 placeholder in `server/src/routes/index.ts`. `evRoute.ts` already does the battery-aware part on the Lab graph. |
| BFS reachability ("stations within my range") | Routing | Use `LinkedQueue` from `Queue.ts` as the frontier. |
| Top-N station ranking | Routing | Use a heap over the composite score. |
| Production MongoDB | Viral | Set `MONGO_URI` + JWT secrets in Vercel. Until then the live site runs in Lab mode (no login or stations). |
| Realtime queue online | Queue | Vercel functions can't hold Socket.IO connections. Host the server elsewhere (Render / Railway) or fall back to polling. |
| Update `client/README.md` | Client | Still says "placeholder" though the pages are built. |

---

## 8. Deployment

The website and the API deploy together as the **`wattway`** project on Vercel (root directory `client/`):

- `client/vercel.json` sends `/api/*` to `client/api/index.ts`, which runs the Express server as one serverless
  function.
- Without `MONGO_URI` it runs in Lab mode: the Algorithm Lab works, database routes don't.
- Production domain: https://wattway-nu.vercel.app

Ask Viral before changing Vercel settings or environment variables.

---

<sub>WattWay · Team Kothimbir 🌿</sub>
