/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * lab/evRoute.ts — battery-aware A*: the fastest route an EV can actually
 * finish, including where to stop and how long to charge.
 *
 * Plain A* answers "what is the shortest road?". An EV also needs "can I get
 * there on this battery?" — the shortest road may run the battery flat, and the
 * best answer may detour to a charger. So this search runs over STATES, not
 * nodes:
 *
 *     state = (node, battery level)      battery in buckets of `stepEnergy`
 *
 * and a state has two kinds of move:
 *
 *   · DRIVE an edge   cost = distance / speed      battery −= energy (regen may add)
 *   · CHARGE 1 bucket cost = stepEnergy / rate     battery += 1      (stations only)
 *
 * Charging one bucket at a time means the search itself decides how MUCH to
 * charge, not just where: partial top-ups fall out for free, with no
 * "always fill to 100 %" rule baked in.
 *
 * HEURISTIC: straight-line km to the goal ÷ speed. Roads are never shorter than
 * the straight line (graph.ts guarantees it) and charging only adds time, so h
 * never overestimates (admissible) and never drops by more than a move costs
 * (consistent). Every state is therefore settled at most once and the first
 * time the goal is popped the answer is optimal.
 *
 * Battery maths is CONSERVATIVE: energy used is rounded UP to a bucket, energy
 * regained is rounded DOWN. A plan this search accepts never needs more charge
 * than the car really has.
 *
 * Complexity: S = V·(B+1) states, each with deg+1 moves →
 *             O((S + E·(B+1)) log S) with the binary heap.
 * ---------------------------------------------------------------------------
 */

import { edgeEnergy, euclid, makeRng, nodeId } from './graph';
import { LabMinHeap } from './MinHeap';
import type { LabGraph } from './types';

export interface EvRouteOptions {
  start: number;
  end: number;
  /** Usable battery, in the Lab's energy units (1 unit ≈ 1 km on the flat). */
  capacity: number;
  /** Charge at departure, 0–1. */
  startCharge: number;
  /** Never plan below this share of capacity, 0–1. */
  reserve: number;
  /** Energy units added per minute while charging. */
  chargeRate: number;
  speedKmh: number;
  regen: number;
  /** Node indices with a charger. */
  stations: number[];
  /** Battery resolution. Smaller = more accurate, more states. */
  stepEnergy?: number;
}

export interface ChargeStop {
  station: string;
  arriveCharge: number;
  departCharge: number;
  minutes: number;
}

export interface EvRouteResult {
  reachable: boolean;
  path: string[];
  chargeStops: ChargeStop[];
  totalMinutes: number | null;
  driveMinutes: number | null;
  chargeMinutes: number | null;
  distanceKm: number | null;
  /** Battery share at arrival, 0–1. */
  arrivalCharge: number | null;
  /** (node, battery) states popped and settled. */
  statesExplored: number;
  /** Distinct road nodes those states covered — comparable to plain A*'s count. */
  nodesExplored: number;
  visitedOrder: string[];
  operations: number;
  notes: string[];
}

interface Arc {
  to: number;
  km: number;
  /** Buckets consumed; negative when regen recovers more than the road costs. */
  buckets: number;
}

const MAX_BUCKETS = 200;

export function evRoute(graph: LabGraph, options: EvRouteOptions): EvRouteResult {
  const { start, end, capacity, chargeRate, speedKmh, regen } = options;
  const n = graph.nodes.length;
  const notes: string[] = [];

  // Bucket size: as asked, but coarse enough to keep the state space bounded.
  const step = Math.max(options.stepEnergy ?? 1, capacity / MAX_BUCKETS);
  const full = Math.floor(capacity / step);
  const startLevel = Math.min(full, Math.floor((options.startCharge * capacity) / step));
  const floorLevel = Math.ceil((options.reserve * capacity) / step);
  const minutesPerKm = 60 / speedKmh;
  const minutesPerBucket = step / chargeRate;

  const isStation = new Uint8Array(n);
  for (const s of options.stations) isStation[s] = 1;

  const adjacency: Arc[][] = Array.from({ length: n }, () => []);
  for (const edge of graph.edges) {
    const energy = edgeEnergy(edge, regen);
    const buckets = energy >= 0 ? Math.ceil(energy / step - 1e-9) : -Math.floor(-energy / step + 1e-9);
    adjacency[edge.from].push({ to: edge.to, km: edge.distance, buckets });
  }

  const levels = full + 1;
  const stateOf = (node: number, level: number): number => node * levels + level;
  const total = n * levels;
  const best = new Float64Array(total).fill(Infinity);
  const previous = new Int32Array(total).fill(-1);
  const settled = new Uint8Array(total);
  const seenNode = new Uint8Array(n);
  const visitedOrder: string[] = [];
  const goal = graph.nodes[end];
  const h = (node: number): number => euclid(graph.nodes[node], goal) * minutesPerKm;
  const heap = new LabMinHeap<number>();
  let operations = 0;
  let statesExplored = 0;
  let found = -1;

  if (startLevel < floorLevel) {
    notes.push('Departure charge is already below the reserve; the car must charge before it can leave.');
  }

  const first = stateOf(start, startLevel);
  best[first] = 0;
  heap.push(h(start), first);

  const relax = (from: number, to: number, cost: number, node: number): void => {
    operations += 1;
    if (settled[to] || cost >= best[to] - 1e-9) return;
    best[to] = cost;
    previous[to] = from;
    heap.push(cost + h(node), to);
  };

  while (!heap.isEmpty()) {
    const state = heap.pop()!.value;
    if (settled[state]) continue; // stale entry from an earlier, worse push
    settled[state] = 1;
    statesExplored += 1;
    const node = Math.floor(state / levels);
    const level = state % levels;
    if (!seenNode[node]) {
      seenNode[node] = 1;
      visitedOrder.push(nodeId(node));
    }
    if (node === end) {
      found = state;
      break;
    }

    if (isStation[node] && level < full) {
      relax(state, state + 1, best[state] + minutesPerBucket, node);
    }
    if (level < floorLevel) continue; // below reserve: may only charge, not drive
    for (const arc of adjacency[node]) {
      const next = Math.min(full, level - arc.buckets);
      if (next < floorLevel) continue;
      relax(state, stateOf(arc.to, next), best[state] + arc.km * minutesPerKm, arc.to);
    }
  }

  const empty: EvRouteResult = {
    reachable: false,
    path: [],
    chargeStops: [],
    totalMinutes: null,
    driveMinutes: null,
    chargeMinutes: null,
    distanceKm: null,
    arrivalCharge: null,
    statesExplored,
    nodesExplored: visitedOrder.length,
    visitedOrder,
    operations,
    notes,
  };
  if (found === -1) {
    notes.push('No route keeps the battery above the reserve, even using every charger on the map.');
    return empty;
  }

  // Walk the state chain back, then fold consecutive charge moves into stops.
  const chain: number[] = [];
  for (let at = found; at !== -1; at = previous[at]) chain.push(at);
  chain.reverse();

  const path: string[] = [];
  const chargeStops: ChargeStop[] = [];
  let distanceKm = 0;
  let chargeMinutes = 0;
  for (let i = 0; i < chain.length; i += 1) {
    const node = Math.floor(chain[i] / levels);
    const level = chain[i] % levels;
    if (i === 0) {
      path.push(nodeId(node));
      continue;
    }
    const prevNode = Math.floor(chain[i - 1] / levels);
    const prevLevel = chain[i - 1] % levels;
    if (prevNode === node) {
      chargeMinutes += minutesPerBucket;
      const last = chargeStops[chargeStops.length - 1];
      const share = (level * step) / capacity;
      const prevWasCharge = i >= 2 && Math.floor(chain[i - 2] / levels) === prevNode;
      if (last && prevWasCharge) {
        last.departCharge = share;
        last.minutes += minutesPerBucket;
      } else {
        chargeStops.push({
          station: nodeId(node),
          arriveCharge: (prevLevel * step) / capacity,
          departCharge: share,
          minutes: minutesPerBucket,
        });
      }
    } else {
      path.push(nodeId(node));
      distanceKm += adjacency[prevNode].find((arc) => arc.to === node)?.km ?? 0;
    }
  }

  const finalLevel = found % levels;
  if (chargeStops.length === 0) notes.push('The battery covers the whole trip — no charging needed.');
  return {
    ...empty,
    reachable: true,
    path,
    chargeStops: chargeStops.map((stop) => ({
      ...stop,
      arriveCharge: round(stop.arriveCharge),
      departCharge: round(stop.departCharge),
      minutes: round(stop.minutes),
    })),
    totalMinutes: round(best[found]),
    driveMinutes: round(best[found] - chargeMinutes),
    chargeMinutes: round(chargeMinutes),
    distanceKm: round(distanceKm),
    arrivalCharge: round((finalLevel * step) / capacity),
  };
}

/** A reproducible set of charger nodes: roughly `share` of the map, never the start. */
export function pickStations(graph: LabGraph, seed: number, share = 0.2, exclude: number[] = []): number[] {
  const rng = makeRng((seed ^ 0x5eed) >>> 0);
  const skip = new Set(exclude);
  const stations: number[] = [];
  for (let i = 0; i < graph.nodes.length; i += 1) {
    if (rng() < share && !skip.has(i)) stations.push(i);
  }
  return stations;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
