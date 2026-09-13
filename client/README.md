# WattWay — Client 🌿

**Team Kothimbir 🌿** · React / Next.js frontend

> **This folder is a placeholder.** The client module has not been built yet.
> The directory tree below is reserved so that whoever picks it up drops files
> into the structure the PRD specifies (Section 8) rather than inventing a new
> one. **Read `../followthis.md` before you write a line of code.**

---

## Owner

| Field | Value |
| --- | --- |
| Module | Client |
| Owner | _unassigned_ |
| Data structures | Stack (undo-last-search), Array (port-status board rendering) |
| Backend it plugs into | `../server` — already built and running |

---

## Reserved structure

```
client/
├── public/
└── src/
    ├── components/     MapView, StationCard, QueuePanel, SearchBox, RoutePlanner
    ├── pages/          Home, StationDetails, Dashboard
    ├── hooks/          useGeolocation, useSocket, useAutocomplete
    ├── services/       axios/fetch API clients (one file per API area)
    ├── context/        auth/user context
    └── utils/
```

## The backend is ready for you

The API is live and documented. Start here:

```bash
cd ../server
npm install
npm run seed          # 19 stations across Mumbai, Pune, Bengaluru and Delhi NCR
npm run dev           # http://localhost:4000
```

Then open `http://localhost:4000/api/meta` — it lists every endpoint, which
module owns it, and which data structure backs it.

### The two endpoints built specifically for this client

**Search box autocomplete** — Trie-backed, answers from memory, safe to call on
every keystroke:

```
GET /api/search/autocomplete?q=andh&limit=8&lat=19.076&lng=72.8777
```

**Price / rating filter** — BST-backed range query:

```
GET /api/search/range?minPrice=9&maxPrice=14&minRating=4&sort=price_asc
```

Add `&explain=true` to either one and the response `meta` tells you which
structure answered, how many candidates it scanned and how long it took. That
is worth wiring to a debug panel for the demo.

### Response shape

Every response, success or failure, has the same envelope:

```jsonc
// success
{ "success": true, "data": { ... }, "meta": { "team": "Team Kothimbir 🌿" } }

// failure
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." }, "meta": { ... } }
```

So your API client can branch on `success` once, in one place.

### Auth

`POST /api/auth/login` returns `{ accessToken, refreshToken, expiresIn }`. Send
the access token as `Authorization: Bearer <token>`. When a request comes back
`401` with `error.code === "TOKEN_EXPIRED"`, call `POST /api/auth/refresh` with
the refresh token and retry — do not bounce the user to the login screen.

### Realtime

Socket.IO is mounted on the same origin. Pass the access token on the
handshake:

```js
io('http://localhost:4000', { auth: { token: accessToken } });
```

Anonymous sockets are allowed; they just do not get a private user room.

---

## Suggested stack

Per PRD Section 7: React + TypeScript, Tailwind CSS, Leaflet.js + OpenStreetMap
for the map, Zustand or Context for state, Socket.IO client for realtime.

Set `VITE_API_URL` (or `NEXT_PUBLIC_API_URL`) to the backend origin and add it
to the server's `CORS_ORIGIN` list.

---

<sub>WattWay · Team Kothimbir 🌿</sub>
