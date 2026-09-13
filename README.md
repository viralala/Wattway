<div align="center">

# ⚡ WattWay 🌿

### EV Charging Station: Route & Queue Optimizer

**Find the charger that is actually best — not just the closest.**

Built by **Team Kothimbir 🌿**

[![Server CI](https://github.com/viralala/wattway/actions/workflows/server-ci.yml/badge.svg)](https://github.com/viralala/wattway/actions/workflows/server-ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A518.18-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.19-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-8.6-47A248?logo=mongodb&logoColor=white)
![Tests](https://img.shields.io/badge/tests-201%20passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## The problem

EV adoption is outrunning charging infrastructure, and that creates two linked
problems.

**Drivers cannot tell which nearby station is actually the best choice.**
Distance alone is misleading — a charger 2 km away with ten cars queued is worse
than one 5 km away that is free. And ordinary shortest-path routing has no idea
your battery will not make it.

**Operators have no lightweight way to run a queue digitally**, so drivers
double-park and argue about turn order while chargers sit idle.

## What WattWay does

- Shows nearby stations on a map with **live queue length**, free ports, price
  and connector type.
- Plans a **battery-aware route** with at most one charging stop, choosing the
  stop by a weighted score of distance, wait and price — not distance alone.
- Lets drivers **queue virtually** and watch their position update live.
- Gives operators a dashboard over slot occupancy and queue depth.

## Why it exists

This is a Data Structures & Algorithms course project. Every required
structure — array, linked list, stack, queue, tree, heap, graph — backs a real,
load-bearing feature here, chosen because it is the right tool rather than
bolted on to tick a box. See [`docs/DATA-STRUCTURES.md`](docs/DATA-STRUCTURES.md)
for the full trace from course requirement to source file.

---

## Data structures map

| Structure | Where it works | Why | Status |
| --- | --- | --- | --- |
| **Array** | Fixed-size port-status board per station | Known small size; O(1) to flip one port | ✅ |
| **Tree (BST)** | Price-per-kWh and rating indexes for range queries | O(log n) range + point updates as tariffs change | ✅ |
| **Trie** | Station / locality autocomplete | O(L) per keystroke, independent of dataset size | ✅ |
| **Linked List** | Graph adjacency lists; waiting line with O(1) mid-queue removal | Sparse graphs; arrays cannot unlink without shifting | ⏳ |
| **Stack** | Iterative DFS; frontend undo-last-search | LIFO is exactly DFS; undo is last-action-first | ⏳ |
| **Queue** | Per-station FIFO waiting line; BFS by battery range | FIFO is the fairness model people expect | ⏳ |
| **Heap** | Dijkstra's frontier; top-N recommendations | Dijkstra's O((V+E) log V) bound depends on it | ⏳ |
| **Graph** | Weighted road + station network, battery-pruned | The natural model for "A to B, maybe via a charger" | ⏳ |

Every ✅ is written from first principles — no library stands in for a required
structure — and unit-tested with no database and no web framework.

---

## Architecture

```
┌─────────────────────────────┐
│           CLIENT            │
│  React / Next.js + Leaflet  │
│  map · search · queue · route│
└───────────────┬─────────────┘
                │ REST + WebSocket
┌───────────────▼─────────────┐
│         API SERVER          │
│   Node.js + Express (TS)    │
│  ┌────────────────────────┐ │
│  │   datastructures/      │ │
│  │  BST · Trie ·          │ │
│  │  Graph · MinHeap ·     │ │
│  │  LinkedList · Stack ·  │ │
│  │  Queue                 │ │
│  └────────────────────────┘ │
│  ┌────────────────────────┐ │
│  │   algorithms/          │ │
│  │  rangeQuery ·          │ │
│  │  autocomplete ·        │ │
│  │  dijkstra · bfs · dfs  │ │
│  └────────────────────────┘ │
└───────┬───────────────┬─────┘
        │               │
┌───────▼──────┐ ┌──────▼───────┐
│   MongoDB    │ │    Redis     │
│ stations,    │ │ live queue   │
│ users, trips │ │ state, cache │
└──────────────┘ └──────────────┘
```

Layering is strict and one-directional:

```
routes/ → controllers/ → services/ → algorithms/ → datastructures/
                  ↘  models/  ↗
```

`datastructures/` imports nothing from the rest of the codebase, so each
structure can be demonstrated and tested entirely on its own.

---

## Quick start

**Prerequisites:** Node ≥ 18.18 and MongoDB (local, or a free MongoDB Atlas
cluster).

```bash
git clone https://github.com/viralala/wattway.git
cd wattway/server

npm install
cp .env.example .env          # then set MONGO_URI and the two JWT secrets
npm run seed                  # 19 stations across Mumbai, Pune, Bengaluru, Delhi NCR
npm run dev                   # http://localhost:4000
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Try it immediately

```bash
# Trie autocomplete — answers from memory on every keystroke
curl "http://localhost:4000/api/search/autocomplete?q=andh"

# BST range query, with the index planner's reasoning attached
curl "http://localhost:4000/api/search/range?minPrice=9&maxPrice=14&explain=true"

# Look inside the live data structures
curl "http://localhost:4000/api/index/stats"
```

That last one prints something like:

```jsonc
"priceIndex":  { "values": 19, "keys": 12, "height": 4, "idealHeight": 4, "balanced": true },
"ratingIndex": { "values": 19, "keys": 15, "height": 4, "idealHeight": 4, "balanced": true },
"nameIndex":   { "terms": 172, "entries": 250, "nodes": 1367, "maxDepth": 53 }
```

### Seeded accounts

| Role | Email | Password |
| --- | --- | --- |
| admin | `admin@wattway.dev` | `kothimbir123` |
| operator | `operator@wattway.dev` | `kothimbir123` |
| driver | `driver@wattway.dev` | `kothimbir123` |

*Demo credentials for a local seed database — never deploy them.*

---

## Scripts

Run from `server/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build |
| `npm run seed` | Seed stations + demo accounts (`-- --fresh` to wipe first) |
| `npm test` | Full Jest suite (201 tests) |
| `npm run test:ds` | Data-structure unit tests only — **no database needed** |
| `npm run test:coverage` | Coverage report |
| `npm run typecheck` | `tsc --noEmit` |

---

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | |
| `PORT` | `4000` | |
| `CORS_ORIGIN` | `http://localhost:3000,http://localhost:5173` | comma-separated |
| `MONGO_URI` | — | **required** |
| `REDIS_URL` | — | optional; for the realtime module |
| `JWT_ACCESS_SECRET` | — | **required**, ≥ 32 chars |
| `JWT_REFRESH_SECRET` | — | **required**, ≥ 32 chars, must differ from the access secret |
| `JWT_ACCESS_TTL` | `15m` | |
| `JWT_REFRESH_TTL` | `30d` | |
| `BCRYPT_ROUNDS` | `10` | |
| `INDEX_REFRESH_MS` | `300000` | index rebuild cadence; `0` disables |
| `RATE_LIMIT_WINDOW_MS` | `900000` | |
| `RATE_LIMIT_MAX` | `300` | |

Configuration is validated at boot by `src/config/env.ts`. A missing or weak
secret fails loudly at startup rather than silently signing forgeable tokens.

---

## API

Full reference: [`docs/API.md`](docs/API.md). Live self-description:
`GET /api/meta`.

| Area | Endpoints |
| --- | --- |
| **Auth** | `POST /api/auth/register` · `login` · `refresh` · `logout` · `change-password`; `GET`/`PATCH /api/auth/me` |
| **Stations** | `GET /api/stations` · `GET /:id` · `POST` · `PATCH /:id` · `DELETE /:id` · `PATCH /:id/ports/:portIndex` · `POST /:id/rating` |
| **Search** | `GET /api/search/autocomplete` *(Trie)* · `range` *(BST)* · `nearest-price` *(BST)* · `price-bounds` *(BST)* |
| **Index** | `GET /api/index/stats` · `POST /api/index/rebuild` · `POST /api/index/rebalance` |
| **Meta** | `GET /api/health` · `GET /api/meta` |

Every response uses one envelope:

```jsonc
{ "success": true,  "data": { … }, "meta": { "team": "Team Kothimbir 🌿" } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…" }, "meta": { … } }
```

### Two things worth a closer look

**The range query has a miniature planner.** When a request bounds both price
and rating, the server probes both BSTs with an O(log n) `countInRange` and
drives the scan with whichever is more selective, applying the other as a
residual filter. Add `?explain=true` and it tells you what it chose:

```jsonc
"explain": {
  "drivingIndex": "rating",
  "reason": "Both bounds supplied. The rating bound is more selective (1 candidate vs 19), so it drives the scan and price is applied as a residual filter.",
  "candidatesScanned": 1, "matched": 1, "sortedByIndexScan": false, "tookMs": 0
}
```

**Autocomplete scores in two stages.** A station's intrinsic quality
(confidence-weighted rating, free ports, queue penalty) is baked into the trie
at index time, because it changes only when the station does. Query-dependent
signals — did the prefix match the real name, was the term typed in full, how
far away is it — are applied at request time over an over-fetched candidate set.

---

## Testing

```bash
cd server
npm run test:ds     # 63 data-structure assertions, no database
npm test            # 201 tests including full API integration
```

| Suite | Covers |
| --- | --- |
| `tests/datastructures/` | BST and Trie in isolation — empty, single, duplicates, removal, rebalancing, plus property tests against brute force |
| `tests/algorithms/` | Range query planner, filters, ordering, pagination; autocomplete ranking and scoring |
| `tests/integration/` | Auth flow, station CRUD, the port board, search endpoints, **and index coherence on every write path** |

Integration tests run against a real in-memory `mongod`, so unique indexes,
geospatial queries and schema validation are genuinely exercised. The first run
downloads and caches a mongod binary.

---

## Project status

| Module | Owner | Structures | Status |
| --- | --- | --- | --- |
| **Indexing & Backend** | Viral | Tree (BST), Trie | ✅ shipped |
| **Routing & Pathfinding** | _unassigned_ | Graph, Min-Heap | ⏳ pending |
| **Queue & Realtime** | _unassigned_ | Queue, Linked List | ⏳ pending |
| **Client** | _unassigned_ | Stack, Array | ⏳ pending |

Endpoints for pending modules are already mounted and answer `501` naming the
module that owes them, so the client can be written against the final URLs
today.

---

## Contributing

**Read [`followthis.md`](followthis.md) first.** It covers the folder structure,
the layering rules, the response and error conventions, the testing bar, and the
one rule that will bite you (every station write must keep the in-memory index
in step with MongoDB).

The short version: the architecture is already decided — fill in your module
inside it rather than redesigning it, and never let a library stand in for a
required data structure.

---

## Repository layout

```
wattway/
├── client/                     # React frontend            ⏳ placeholder
├── server/
│   ├── src/
│   │   ├── datastructures/     # BST.ts, Trie.ts — from scratch
│   │   ├── algorithms/         # rangeQuery.ts, autocomplete.ts
│   │   ├── models/             # User, Station, Trip, QueueEntry
│   │   ├── controllers/        # auth, station, search, index, meta
│   │   ├── routes/             # routers + Zod schemas
│   │   ├── middleware/         # auth, validate, error, rateLimit, brand
│   │   ├── services/           # stationIndex (the live BST + Trie), tokenService
│   │   ├── sockets/            # Socket.IO transport + auth
│   │   ├── config/             # env, db, brand
│   │   ├── types/ · utils/
│   │   ├── app.ts              # Express app (no listener — tests import this)
│   │   └── server.ts           # process entry point
│   ├── scripts/seed.ts
│   └── tests/
├── docs/
│   ├── PRD.md                  # the requirements, in Markdown
│   ├── API.md                  # full endpoint reference
│   └── DATA-STRUCTURES.md      # course requirement → source file
├── followthis.md               # rules for contributors — read before coding
└── README.md
```

---

## Tech stack

**Backend** Node.js · Express 4 · TypeScript 5.5 · MongoDB + Mongoose 8 ·
Socket.IO · JWT (jsonwebtoken + bcryptjs) · Zod · Helmet · Jest + Supertest ·
mongodb-memory-server

**Frontend** *(planned)* React + TypeScript · Tailwind CSS · Leaflet + OpenStreetMap ·
Zustand · Socket.IO client

**Deployment** *(planned)* Vercel (client) · Render / Railway (server) ·
MongoDB Atlas

---

## Team

<div align="center">

### Team Kothimbir 🌿

| Member | Role | Data structures |
| --- | --- | --- |
| **Viral** | Indexing & Backend Lead | Tree (BST), Trie |
| — | Routing & Pathfinding | Graph, Min-Heap |
| — | Queue & Realtime | Queue, Linked List |
| — | Client | Stack, Array |

</div>

---

## License

MIT — see [`LICENSE`](LICENSE).

<div align="center">
<sub>Built with 🌿 by <b>Team Kothimbir</b></sub>
</div>
