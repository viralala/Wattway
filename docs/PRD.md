# WattWay — EV Charging Station: Route & Queue Optimizer

**Product Requirements Document · Data Structures & Algorithms Course Project**

Built by **Team Kothimbir 🌿**

> This is a Markdown rendition of the source document
> `EV Charging Station Route & Queue Optimizer - PRD.docx`, kept in the repo so
> the requirements are diffable, linkable and readable without Word. The .docx
> remains the authoritative original.

---

## 1. Overview

WattWay is a full-stack web application that helps electric vehicle drivers
find the best nearby charging station and plan a route to it, while accounting
for real-time queue length at each station. The project is built explicitly to
demonstrate mastery of core data structures — arrays, linked lists, stacks,
queues, trees, heaps, and graphs — by using each one where it is the natural
fit, rather than bolting them on artificially.

## 2. Problem Statement

EV adoption is growing faster than charging infrastructure, and this creates two
linked problems:

1. **Drivers cannot easily tell which nearby charging station is actually the
   best choice.** Distance alone is misleading — a closer station with a ten-car
   queue is worse than a slightly farther one that is free. Drivers also need
   routes that respect their vehicle's remaining battery range, which ordinary
   shortest-path routing (e.g. plain Google Maps directions) does not account
   for.

2. **Station operators have no lightweight way to manage a first-come-first-served
   queue digitally**, which leads to double-parking, disputes over turn order,
   and idle chargers while cars wait outside instead of being notified.

The result is wasted driver time, uneven load across stations, and poor
utilization of existing charging infrastructure.

## 3. Proposed Solution

A web application, usable on desktop and mobile browsers, that:

- Displays nearby EV charging stations on a map, each annotated with live queue
  length, number of free ports, price, and connector type.
- Computes a battery-aware shortest route from the driver's location to their
  destination, inserting a charging stop only when needed and choosing which
  station to stop at using a weighted score of distance, wait time, and price —
  not distance alone.
- Lets a driver join a station's virtual queue remotely and see a live estimated
  wait time, instead of queuing physically.
- Gives station operators a simple dashboard to see and manage who is charging,
  who is waiting, and how long each slot has been occupied.

Every one of the required data structures maps onto a real, load-bearing part of
this system — the mapping is laid out in Section 5.

## 4. Goals & Objectives

- Route a driver to a destination with at most one recommended charging stop,
  chosen to minimize total trip time (driving + waiting + charging), not just
  distance.
- Reduce apparent wait time by letting drivers queue virtually rather than in
  person.
- Give operators real-time visibility into slot occupancy and queue depth.
- Implement every required data structure (array, linked list, stack, queue,
  tree, heap, graph) from first principles in the codebase, each backing a real
  feature, and document that mapping clearly for evaluation.
- Ship a working, demoable prototype within a single academic term.

## 5. Data Structures Map

This table is the core deliverable of the DSA brief: each structure is tied to a
concrete feature and a reason it was chosen over the alternatives.

| Data Structure | Where it's used | Why this structure |
| --- | --- | --- |
| **Array** | Slot-status board per station (fixed-size array of port states: free / occupied / faulted); adjacency matrix option for small dense sub-graphs used in distance pre-computation | Fixed, small, known size; O(1) random access to check/flip a specific port's status |
| **Linked List** | Adjacency list representation of the road/station graph (each node holds a linked list of its neighboring edges); each station's waiting line, stored as a doubly linked list so a car that leaves early can be removed in O(1) once located | Graphs are sparse — a linked adjacency list avoids the wasted space of a full matrix; mid-queue removal needs O(1) unlink, which arrays can't give without shifting |
| **Stack** | Iterative DFS for reachability checks and alternate-route exploration; "undo last search" / back-navigation through recently viewed stations on the frontend | LIFO exploration order is exactly what DFS needs; undo is naturally last-action-first |
| **Queue** | Each station's live FIFO waiting line for vehicles (the user-facing structure — front of queue is next to charge); BFS for "all stations reachable within remaining battery range" | FIFO matches real-world queueing fairness; BFS needs strict level-order expansion |
| **Tree (BST)** | Index of stations keyed by price-per-kWh (and a second BST keyed by average rating) to answer range queries like "stations between ₹8–₹12/kWh near me" | O(log n) range and nearest-value queries beat a linear scan once station count grows |
| **Trie** | Autocomplete for station-name / locality search box | O(L) prefix lookup regardless of dataset size, and naturally ranks by shared prefix |
| **Heap (Min-Heap / Priority Queue)** | Priority queue inside Dijkstra's algorithm (frontier ordered by tentative distance); top-N station recommendation ranked by a composite score of distance + wait + price | Dijkstra's correctness and O((V+E) log V) bound depend on a min-heap frontier; a heap also gives O(log n) top-N maintenance instead of re-sorting |
| **Graph (weighted, directed)** | The road network plus charging stations as nodes; edge weight = travel time/distance, with a battery-range constraint pruning edges the vehicle cannot reach | This is the natural model for "how do I get from A to B, possibly via a charging stop" |

## 6. System Architecture

Three tiers: a React/Next.js client, a Node.js API and algorithms server, and a
persistence + real-time layer.

```
┌─────────────────────────────┐
│           CLIENT            │
│  React / Next.js + Leaflet  │
│  map view · search · queue  │
│  status · booking flow      │
└───────────────┬─────────────┘
                │ REST + WebSocket
┌───────────────▼─────────────┐
│         API SERVER          │
│   Node.js + Express (TS)    │
│  ┌────────────────────────┐ │
│  │   datastructures/      │ │
│  │  Graph · MinHeap ·     │ │
│  │  LinkedList · Stack ·  │ │
│  │  Queue · BST · Trie    │ │
│  └────────────────────────┘ │
│  ┌────────────────────────┐ │
│  │   algorithms/          │ │
│  │  dijkstra · bfs · dfs ·│ │
│  │  rangeQuery ·          │ │
│  │  autocomplete          │ │
│  └────────────────────────┘ │
└───────┬───────────────┬─────┘
        │               │
┌───────▼──────┐ ┌──────▼───────┐
│   MongoDB    │ │    Redis     │
│ stations,    │ │ live queue   │
│ users, trips │ │ state, cache │
└──────────────┘ └──────────────┘
```

The custom data structures live in their own module so they are implemented from
scratch (not via a library) and can be unit-tested and demonstrated
independently of the web app around them.

## 7. Tech Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | React (or Next.js) + TypeScript | Next.js if server-rendering/SEO matters; plain React + Vite is lighter for a course project |
| Styling | Tailwind CSS | Fast to build a clean, responsive UI |
| Maps | Leaflet.js + OpenStreetMap | Free, no billing setup required (Google Maps API is a drop-in alternative) |
| State management | Zustand or React Context | Lightweight; Redux is unnecessary at this scale |
| Realtime | Socket.IO | Pushes live queue-length and slot updates to connected clients |
| Backend | Node.js + Express (TypeScript) | Same language as frontend; keeps the custom DS/algorithms code in one place |
| Database | MongoDB (or PostgreSQL + PostGIS if geospatial queries are preferred) | Stores users, stations, trips, bookings |
| Cache / live state | Redis | Backing store for each station's live queue and socket fan-out |
| Auth | JWT (jsonwebtoken + bcrypt) | Simple stateless auth |
| Testing | Jest + Supertest | Unit tests for each custom data structure and integration tests for API routes |
| Deployment | Vercel (frontend), Render/Railway (backend), MongoDB Atlas | Free-tier friendly for an academic demo |

## 8. Folder Structure

```
wattway/
├── client/                        # React / Next.js frontend
│   ├── public/
│   └── src/
│       ├── components/            # MapView, StationCard, QueuePanel, etc.
│       ├── pages/                 # Home, StationDetails, Dashboard
│       ├── hooks/                 # useGeolocation, useSocket
│       ├── services/              # axios/fetch API clients
│       ├── context/               # auth/user context
│       └── utils/
│
├── server/                        # Node.js + Express backend
│   ├── src/
│   │   ├── datastructures/        # custom DS, built from scratch
│   │   │   ├── Graph.ts
│   │   │   ├── MinHeap.ts
│   │   │   ├── LinkedList.ts
│   │   │   ├── Stack.ts
│   │   │   ├── Queue.ts
│   │   │   ├── BST.ts
│   │   │   └── Trie.ts
│   │   ├── algorithms/
│   │   │   ├── dijkstra.ts        # battery-aware shortest path
│   │   │   ├── bfs.ts             # range-limited reachability
│   │   │   ├── dfs.ts             # alternate-route exploration
│   │   │   └── rank.ts            # heap-based top-N recommendation
│   │   ├── models/                # Mongoose/Prisma schemas
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── sockets/               # Socket.IO event handlers
│   │   └── app.ts
│   └── tests/                     # Jest unit + integration tests
│
├── docs/
│   ├── PRD.md
│   ├── architecture-diagram.png
│   └── er-diagram.png
│
└── README.md
```

> **Implementation note.** The shipped repository adds a small number of
> sub-folders under `server/src/` that the PRD sketch did not enumerate —
> `config/`, `middleware/`, `services/`, `types/` and `utils/` — plus
> `server/scripts/` for the seed script. These are additive and conventional;
> nothing in the PRD structure was moved or renamed. See `followthis.md` for the
> full rationale and the rules for adding more.

## 9. Key Algorithms & Complexity

| Algorithm | Purpose | Complexity |
| --- | --- | --- |
| Dijkstra's (min-heap) | Battery-aware shortest route, possibly via one charging stop | O((V + E) log V) |
| BFS | All stations reachable within remaining range | O(V + E) |
| DFS (stack-based) | Alternate-route / reachability exploration | O(V + E) |
| BST search/insert | Price or rating range queries over stations | O(log n) average |
| Trie prefix search | Station/locality autocomplete | O(L), L = query length |
| Heap top-N | Ranking recommended stations by composite score | O(log n) per update |
| Queue enqueue/dequeue | Joining/leaving a station's waiting line | O(1) |

## 10. Functional Requirements

1. User sign-up/login (JWT-based). ✅ *shipped*
2. Map view of nearby charging stations with live free-slot count and queue length. ⏳ *client*
3. Search bar with autocomplete (Trie-backed) for station names and localities. ✅ *shipped*
4. Filter/sort stations by price or rating within a range (BST-backed). ✅ *shipped*
5. Route planner: input destination + current battery %, receive a route with zero or one recommended charging stop. ⏳ *routing module*
6. Join a station's virtual queue and see live position + estimated wait (Queue-backed, pushed via WebSocket). ⏳ *queue module*
7. Trip history per user (Linked-list-backed, most-recent-first). ⏳ *queue module*
8. "Back to last search" undo action (Stack-backed). ⏳ *client*
9. Operator dashboard: view current occupants, queue, and mark a slot free/occupied. ⏳ *partly shipped — the port-board API exists*

## 11. Non-Functional Requirements

- Route computation should return in under 2 seconds for a metro-sized station
  graph (a few hundred nodes).
- Queue-length updates should reach connected clients within 2 seconds of a
  change (WebSocket push, not polling).
- The app should be usable on a phone-width screen, since drivers will check it
  in the car.
- Passwords hashed (bcrypt); JWT-protected routes for anything user- or
  operator-specific.
- Each custom data structure ships with unit tests demonstrating correctness
  independent of the web app.

## 12. Milestones

| Phase | Deliverable |
| --- | --- |
| Week 1–2 | Requirements finalized; graph data model and sample station dataset prepared |
| Week 3–4 | Custom data structures library implemented and unit-tested (Graph, Heap, LinkedList, Stack, Queue, BST, Trie) |
| Week 5–6 | Core algorithms (Dijkstra, BFS, DFS, ranking) built on top of the DS library |
| Week 7–8 | Backend API + database wired to the algorithms |
| Week 9–10 | Frontend: map view, search, route planner, queue UI |
| Week 11 | Real-time layer (Socket.IO), operator dashboard |
| Week 12 | Testing, polish, and demo/report preparation |

## 13. Evaluation Criteria Mapping

Since this is coursework, each required topic should be traceable to a specific,
working piece of the system for the demo:

| Course requirement | Demonstrated by |
| --- | --- |
| Array | Fixed-size port-status board per station |
| Linked List | Graph's adjacency-list representation; per-station waiting line with O(1) mid-queue removal |
| Stack | Iterative DFS; frontend "undo last search" |
| Queue | Live virtual queue per station; BFS traversal |
| Tree | BST index for price/rating range queries; Trie for autocomplete |
| Heap | Dijkstra's priority queue; top-N station ranking |
| Graph | Full road-and-station network, weighted by travel time with battery-range pruning |

## 14. Related Work

A short review of five papers relevant to this project's core problem —
battery-constrained EV routing and charging-station queue/demand management —
situates the design choices made in Sections 5–9.

1. **The Shortest Path Problem Revisited: Optimal Routing for Electric Vehicles**
   (Artmeier et al., 2010). Shows that plain Dijkstra breaks down for EV routing
   once regenerative braking introduces negative edge weights, and proposes a
   label-correcting shortest-path variant that treats battery capacity as a hard
   constraint. This is the direct academic ancestor of the battery-aware
   Dijkstra used in Section 9.

2. **An EV Charging Management System Concerning Drivers' Trip Duration and
   Mobility Uncertainty** (Cao et al., 2016). Frames station selection as a
   decision problem that must weigh a station's current reservation load and
   parking duration, not just distance, updating the plan as arrival time
   drifts. This validates the project's premise that a queue/wait signal belongs
   inside station choice, matching the composite-score heap ranking in
   Section 5.

3. **Coordinated Charging Scheduling of Electric Vehicles: A Mixed-Variable
   Differential Evolution Approach** (Liu et al., 2019). Shows joint
   station-selection-plus-charging-scheduling is NP-hard even in simplified
   form, and solves it with a differential-evolution metaheuristic rather than
   an exact algorithm — useful context for why this project deliberately keeps
   its own formulation lightweight (greedy heap ranking plus constrained
   Dijkstra) rather than attempting a globally optimal joint solve.

4. **Multistep Electric Vehicle Charging Station Occupancy Prediction Using
   Hybrid LSTM Neural Networks** (Ma & Faye, 2022). Forecasts future station
   occupancy from historical logs using an LSTM, with high short-horizon
   accuracy. This is the predictive alternative to this project's approach:
   rather than forecasting demand, the project tracks the actual live queue per
   station via a FIFO structure pushed over WebSocket — simpler to build and
   exact in the present, at the cost of not anticipating spikes the way a
   trained model could.

5. **The Electric Vehicle Routing Problem and Its Variations: A Literature
   Review** (Küçükoğlu et al., 2021). Surveys the broader E-VRP literature and
   its variants (time windows, partial recharging, heterogeneous fleets), and
   confirms that most published work targets fleet/logistics routing with exact
   or metaheuristic solvers — a consumer-facing, queue-aware, single-vehicle
   routing tool sits in a comparatively less crowded corner of the field.

**Synthesis.** The literature splits into two strands usually solved
independently — energy-constrained shortest-path routing (papers 1 and 3) and
charging-demand/queue estimation (papers 2 and 4) — with few systems combining
both into one interactive, real-time, driver-facing tool. That gap is where this
project sits.

## 15. Future Scope

- Real-time traffic data integration to adjust edge weights dynamically.
- Predictive queue-length modeling using historical occupancy data.
- Multi-stop trip planning for long-distance travel requiring several charging
  stops.
- Payment integration for slot reservation and charging fees.
- Native mobile app (React Native) sharing the same backend.

---

<sub>WattWay · Team Kothimbir 🌿</sub>
