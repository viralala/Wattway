# WattWay API Reference 🌿

**Team Kothimbir 🌿** · base URL `http://localhost:4000`

Every endpoint below is implemented and covered by tests. Endpoints owned by
modules that have not landed yet are listed at the bottom with the shape they
will take, and currently answer `501 NOT_IMPLEMENTED` naming the owing module.

A live version of this list is served by the API itself:

```bash
curl http://localhost:4000/api/meta
```

---

## Conventions

### Response envelope

Every response, success or failure, uses the same two shapes.

```jsonc
// 2xx
{
  "success": true,
  "data":   { /* endpoint-specific */ },
  "meta":   { "team": "Team Kothimbir 🌿", "pagination": { ... }, "tookMs": 0 }
}

// 4xx / 5xx
{
  "success": false,
  "error":  { "code": "NOT_FOUND", "message": "Station not found", "details": [ ... ] },
  "meta":   { "team": "Team Kothimbir 🌿" }
}
```

### Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Well-formed request the server cannot act on |
| `UNAUTHORIZED` | 401 | No token supplied |
| `INVALID_CREDENTIALS` | 401 | Email or password wrong |
| `TOKEN_EXPIRED` | 401 | Access token aged out — **refresh and retry**, do not sign the user out |
| `TOKEN_INVALID` | 401 | Signature bad, wrong token type, or session revoked |
| `FORBIDDEN` | 403 | Authenticated, but not allowed |
| `NOT_FOUND` | 404 | No such resource or route |
| `CONFLICT` | 409 | Duplicate email or duplicate station name in a city |
| `VALIDATION_FAILED` | 422 | Body/query failed schema validation; `details` lists each issue |
| `RATE_LIMITED` | 429 | Too many requests |
| `INDEX_UNAVAILABLE` | 503 | The in-memory index is still building |
| `NOT_IMPLEMENTED` | 501 | A module that has not landed yet |

### Headers

Every response carries `X-Request-Id` (echoed from the request if you sent one),
`X-Powered-By: WattWay - Team Kothimbir` and `X-WattWay-Team`.

### Authentication

```
Authorization: Bearer <accessToken>
```

Access tokens last 15 minutes, refresh tokens 30 days.

---

## Meta

### `GET /`
Service greeting.

### `GET /api/health`
`200` when the database is connected and the index is built, `503` otherwise.

```jsonc
{ "status": "ok", "database": "connected", "index": { "ready": true, "stations": 19 }, "uptimeSeconds": 412 }
```

### `GET /api/meta`
Self-description: modules, owners, data-structure mapping and every endpoint.

---

## Auth — `/api/auth`

### `POST /api/auth/register`

```jsonc
{
  "name": "Demo Driver",
  "email": "driver@wattway.dev",
  "password": "kothimbir123",     // >= 8 chars, at least one letter and one digit
  "role": "driver",               // optional: "driver" (default) or "operator"
  "vehicle": {                    // optional
    "make": "Tata", "model": "Nexon EV Max",
    "batteryCapacityKwh": 40.5, "rangeKm": 437, "connectorType": "CCS2"
  }
}
```

`201` → `{ user, accessToken, refreshToken, tokenType, expiresIn }`.
`409` if the email is taken. `role: "admin"` is rejected — admins are seeded.

### `POST /api/auth/login`

```jsonc
{ "email": "driver@wattway.dev", "password": "kothimbir123" }
```

`200` → same payload as register. A wrong password and an unknown account return
**byte-identical** 401s, so the endpoint cannot be used to discover which emails
are registered.

### `POST /api/auth/refresh`

```jsonc
{ "refreshToken": "<token>" }
```

`200` → a fresh token pair. `401` if the token is an access token, belongs to a
deleted account, or was issued before a logout/password change.

### `POST /api/auth/logout` 🔒
Revokes every refresh token for the account by bumping its token version.
Existing access tokens stay valid until they expire (≤ 15 min) — see
`server/src/middleware/auth.ts` for why.

### `GET /api/auth/me` 🔒
### `PATCH /api/auth/me` 🔒 — `{ name?, vehicle? }`
### `POST /api/auth/change-password` 🔒 — `{ currentPassword, newPassword }`
Signs out every other session and returns a fresh token pair for the caller.

---

## Stations — `/api/stations`

### `GET /api/stations`
Public. Plain paginated listing. *Range filtering by price/rating lives at
`/api/search/range` — that is the BST's job.*

| Query | Type | Notes |
| --- | --- | --- |
| `page`, `limit` | int | default 1, 20 (max 100) |
| `city`, `operator` | string | exact match, case-insensitive |
| `connectorType` | enum | `CCS2` `CHAdeMO` `Type2` `GB/T` `Bharat-AC-001` `Bharat-DC-001` |
| `lat`, `lng` | number | must be supplied together; adds `distanceKm` and sorts by it |
| `radiusKm` | number | requires `lat`/`lng` |

### `GET /api/stations/:id`
Public. `404` if unknown or deactivated.

### `POST /api/stations` 🔒 operator · admin

```jsonc
{
  "name": "Andheri Metro Charge Hub",
  "operator": "Tata Power",
  "address": { "line1": "...", "locality": "Andheri East", "city": "Mumbai",
               "state": "Maharashtra", "pincode": "400059" },
  "location": { "lat": 19.1136, "lng": 72.8697 },
  "pricePerKwh": 14.5,
  "ports": [ { "connectorType": "CCS2", "powerKw": 60 } ],   // 1-32
  "amenities": ["restroom", "cafe"],
  "graphNodeId": "node-mumbai-01"                            // optional
}
```

Ports are numbered `0..n-1` on creation; that index is the array position every
later O(1) port update uses. Creating a station indexes it immediately.

### `PATCH /api/stations/:id` 🔒 managing operator · admin
### `DELETE /api/stations/:id` 🔒 managing operator · admin
Soft delete — the row survives for trip and queue history, and the station drops
out of the search index.

### `PATCH /api/stations/:id/ports/:portIndex` 🔒 managing operator · admin

```jsonc
{ "status": "occupied" }   // "free" | "occupied" | "faulted"
```

**This is the Array data structure endpoint** — O(1) addressing into the
fixed-size slot board. `occupiedSince` is stamped on occupy and cleared on
release. Returns the updated port plus the recomputed free/total counts.

### `POST /api/stations/:id/rating` 🔒 any signed-in user

```jsonc
{ "rating": 5 }   // 1-5
```

Updates a running mean in O(1) and moves the station in the rating BST.

---

## Search — `/api/search`

All four are public and answer entirely from memory. None touch the database.

### `GET /api/search/autocomplete` — **Trie**

| Query | Notes |
| --- | --- |
| `q` | **required.** Fewer than 2 characters returns an empty list |
| `limit` | default 8, max 25 |
| `lat`, `lng` | optional, together; adds a proximity term to the ranking |
| `explain` | `true` to include the explain block |

```bash
curl "http://localhost:4000/api/search/autocomplete?q=andh&limit=5"
```

```jsonc
{
  "success": true,
  "data": {
    "query": "andh",
    "suggestions": [{
      "id": "...", "name": "Andheri Metro Charge Hub",
      "locality": "Andheri East", "city": "Mumbai",
      "matchedTerm": "andheri east", "score": 1.257,
      "location": { "lat": 19.1136, "lng": 72.8697 },
      "pricePerKwh": 14.5, "rating": 4.6
    }]
  },
  "meta": { "dataStructure": "Trie", "tookMs": 0, "team": "Team Kothimbir 🌿" }
}
```

Stations are indexed under their name, locality, city, state and operator, so
any of those will find them. Matching is case- and punctuation-insensitive and
folds diacritics.

### `GET /api/search/range` — **BST**

| Query | Notes |
| --- | --- |
| `minPrice`, `maxPrice` | ₹/kWh, 0–500 |
| `minRating`, `maxRating` | 0–5 |
| `connectorType`, `city` | residual filters |
| `lat`, `lng` | together; adds `distanceKm` |
| `radiusKm` | requires a position |
| `onlyWithFreePorts` | `true`/`false` — the string `"false"` is correctly false |
| `sort` | `price_asc` (default) `price_desc` `rating_desc` `distance_asc` `free_ports_desc` |
| `page`, `limit` | default 1, 20 (max 100) |
| `explain` | `true` to see which index drove the scan |

```bash
curl "http://localhost:4000/api/search/range?minPrice=9&maxPrice=14&explain=true"
```

```jsonc
"meta": {
  "dataStructure": "BST",
  "explain": {
    "drivingIndex": "price",
    "reason": "Only a price bound was supplied, so the price BST drives the scan.",
    "candidatesScanned": 8,
    "matched": 8,
    "sortedByIndexScan": true,
    "tookMs": 1
  }
}
```

When **both** a price and a rating bound are given, the server probes both trees
with an O(log n) `countInRange` and drives the scan with whichever is more
selective, applying the other as a residual filter. `explain.reason` says which
it chose and why.

`sort=distance_asc` or `radiusKm` without `lat`/`lng` returns `400`. An inverted
band (`minPrice > maxPrice`) returns `422` naming the field.

### `GET /api/search/nearest-price` — **BST nearest key**

```bash
curl "http://localhost:4000/api/search/nearest-price?price=13"
```

"Nothing in my budget — what is closest to it?" Ties break toward the cheaper
price. Returns `{ requestedPrice, nearestPrice, difference, stations }`.

### `GET /api/search/price-bounds` — **BST min/max**

The ends of both indexes, for rendering a range slider. O(h) per tree, no scan.

---

## Index — `/api/index`

### `GET /api/index/stats`
Public. The demo surface for the data structures: node counts, actual tree
height against the theoretical minimum, trie depth, last build time.

```jsonc
{
  "ready": true, "stations": 19, "lastBuildMs": 5, "buildCount": 1,
  "priceIndex":  { "values": 19, "keys": 12, "height": 4, "idealHeight": 4, "balanced": true, "minKey": 8.25, "maxKey": 21.5 },
  "ratingIndex": { "values": 19, "keys": 15, "height": 4, "idealHeight": 4, "balanced": true, "minKey": 3.2, "maxKey": 4.9 },
  "nameIndex":   { "terms": 172, "entries": 250, "nodes": 1367, "maxDepth": 53 },
  "interpretation": { "priceIndex": "Binary search tree over price-per-kWh. ..." }
}
```

### `POST /api/index/rebuild` 🔒 admin
Re-reads every active station from Postgres and rebuilds all three structures.
The escape hatch for out-of-band database edits during a demo.

### `POST /api/index/rebalance` 🔒 admin
Rebalances the BSTs in place without re-reading the database. A teaching
endpoint: hammer the index with writes, watch `height` drift above
`idealHeight`, call this, watch it snap back.

---

## Queue — `/api/queue`

Owned by the Queue & Realtime module (Shreenath). The live line is a doubly
linked list per station with a `userId → node` index; Postgres `queue_entries` rows
are its write-behind log. Every write updates `Station.queueLength` / the port
board and calls `stationIndex.upsert()`, then pushes socket events.

### `GET /api/queue/:stationId` — public (personalised when signed in)

```json
{
  "queue": {
    "stationId": "…", "stationName": "…",
    "totalPorts": 2, "freePorts": 0, "usablePorts": 2, "queueLength": 3,
    "charging": [{ "portIndex": 0, "startedAt": "…", "expectedRemainingMinutes": 22, "you": false }],
    "waiting":  [{ "position": 1, "joinedAt": "…", "estimatedWaitMinutes": 12, "urgent": true, "you": false }],
    "middle": { "position": 2, "estimatedWaitMinutes": 30 },
    "you": { "stationId": "…", "status": "waiting", "position": 3, "carsAhead": 2, "estimatedWaitMinutes": 42, "urgent": false },
    "updatedAt": "…"
  }
}
```

The public payload carries no user ids. `middle` comes from the fast/slow
pointer walk; estimates from a min-heap of port-free times.

### `GET /api/queue/:stationId/position` 🔒

`{ you }` — `404` if you are not in this station's line.

### `POST /api/queue/:stationId/join` 🔒 — `{ batteryPct?, emergency?, expectedChargeMinutes? }`

| Field | Rule |
| --- | --- |
| `batteryPct` | 0–100. Under 5 counts as **urgent**. |
| `emergency` | boolean. Emergency vehicles are **urgent**. |
| `expectedChargeMinutes` | integer 5–240, default 30. Feeds wait estimates. |

Urgent drivers are placed behind earlier urgent drivers and ahead of everyone
else. If a port is free and nobody is ahead, the driver is assigned it at once.

`201` → `{ entryId, startedCharging, you, queue }`. `409` if already in this line
or every port is faulted. `422` on a bad body.

### `DELETE /api/queue/:stationId/leave` 🔒

Leaves the line (entry → `cancelled`, **O(1) unlink**), or, if charging, ends the
session (entry → `completed`, port freed and handed to the head of the line).
`200` → `{ left: "waiting" | "charging", queue }`. `404` if not in line.

### `GET /api/queue/:stationId/simulate` — job scheduling (Lab 6)

| Query | Default | Meaning |
| --- | --- | --- |
| `policy` | `compare` | `fifo` · `priority` · `round-robin` · `compare` (all three) |
| `source` | `auto` | `live` line, `demo` set, or `auto` (demo when the line is empty) |
| `quantum` | 15 | round-robin slice, minutes |
| `ports` | station's usable ports (2 for demo) | override |

Single policy → `{ source, ports, result: { timeline[], jobs[], averageWait, averageTurnaround, maxWait, makespan, interruptions } }`.
`compare` → `{ source, ports, results: { fifo, priority, round-robin }, lowestAverageWait, urgentAverageWait }`.

### `GET /api/queue/:stationId/report` 🔒 managing operator · admin — `?top=5`

```json
{
  "report": {
    "waiting": 4,
    "sortedByWait": [ /* heapsort, longest wait first */ ],
    "heapsort": { "passes": 4, "trace": [[…], …] },
    "urgentQueue": [ /* max-heap top N */ ],
    "depq": { "mostUrgent": { … }, "leastUrgent": { … } },
    "middle": { "position": 2, "estimatedWaitMinutes": 30 },
    "integrity": { "linkedListConsistent": true, "noCycle": true, "indexMatchesList": true }
  }
}
```

Each driver row: `{ id, userId, name, joinedAt, waitedMinutes, batteryPct, emergency, urgency }`.

### `POST /api/queue/:stationId/allocate` 🔒 managing operator · admin

Hands any free ports to the front of the line — use after freeing a port with
`PATCH /api/stations/:id/ports/:portIndex`. → `{ started, queue }`.

### `POST /api/queue/:stationId/merge` 🔒 managing operator · admin — `{ targetStationId?, faultPorts? }`

The station's ports have faulted: its waiting line is merged into
`targetStationId` (or the **nearest active station** when omitted) with a
**leftist heap**, keeping urgency first and then join time. Drivers already in
the target's line have their source entry cancelled. `faultPorts: true` also
marks the source's free ports `faulted`. The operator must manage the target
too (admins always can).

→ `{ moved, skippedDuplicates, targetDistanceKm, leftistHeap: { targetSize, incomingSize, rightSpineTarget, rightSpineIncoming, rightSpineMerged }, source, target }`

### `GET /api/queue/demo/josephus?n=7&k=3`

→ `{ n, k, eliminationOrder: [3,6,2,7,5,1,4], survivor: 4, recurrenceSurvivor: 4 }` — played on the circular linked list.

---

## Trips — `/api/trips` 🔒

A driver's history as a **most-recent-first singly linked list**:
`Trip.previousTrip` is the `next` pointer. Only the owner can see a trip.

### `GET /api/trips?limit=20&before=<tripId>`

→ `{ trips, total, nextCursor, chainIntact, middleTripId }`. Pass `nextCursor`
as `before` for the next page. `chainIntact: false` means some trip was not
reachable by pointer (it is still returned, spliced in by date).

### `POST /api/trips` — insert at head

```json
{
  "origin": { "lat": 18.52, "lng": 73.85 }, "originLabel": "Kothrud",
  "destination": { "lat": 19.07, "lng": 72.87 }, "destinationLabel": "Andheri",
  "batteryStartPct": 80,
  "chargingStop": { "stationId": "…", "estimatedWaitMinutes": 10 },
  "route": {}, "distanceKm": 150, "estimatedDurationMinutes": 200, "status": "planned"
}
```

`201` → `{ trip }` with `previousTrip` set to your previous newest trip. The
routing module can call `recordTrip()` in `services/tripService.ts` directly.

### `GET /api/trips/:id` · `DELETE /api/trips/:id`

Delete unlinks the node: the newer trip that pointed at it is re-pointed at the
deleted trip's own `previousTrip`.

---

## Realtime

Socket.IO on the same origin. Authenticate on the handshake:

```js
const socket = io('http://localhost:4000', { auth: { token: accessToken } });
socket.emit('station:watch', stationId);
```

Anonymous sockets are allowed — a signed-out visitor still sees live queue
lengths — they just do not get a private user room.

Queue events (Queue & Realtime module, `server/src/sockets/queueHandlers.ts`):

| Direction | Event | Payload | Room |
| --- | --- | --- | --- |
| in | `queue:watch` | `(stationId, ack?)` → ack `{ ok, data: snapshot }` | joins `station:<id>` |
| in | `queue:unwatch` | `(stationId)` | leaves it |
| in | `queue:position` | `(stationId, ack)` → ack `{ ok, data: you }` (signed in only) | — |
| out | `queue:updated` | the public queue snapshot | `station:<id>` |
| out | `ports:updated` | `{ stationId, totalPorts, freePorts, ports[] }` | `station:<id>` |
| out | `queue:position` | your `you` view, or `{ status: "left", reason }` | `user:<id>` |

Every join / leave / allocate / merge pushes these immediately — no polling.

---

## Not built yet

These answer `501` with `error.details.module` naming the owner.

| Endpoint | Module | Structures |
| --- | --- | --- |
| `POST /api/routes/plan` | Routing & Pathfinding | Graph, Min-Heap |

---

<sub>WattWay · Team Kothimbir 🌿</sub>
