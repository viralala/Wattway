/* Routing & Graph Algorithms module: Graph, MinHeap, Dijkstra, BFS, route planner.
   Plain JS mirror of the TypeScript files in server/src (datastructures + algorithms). */

/* ---------- Graph (adjacency list built from a singly linked list of edges) ---------- */
class EdgeNode {
  constructor(edge, next = null) { this.edge = edge; this.next = next; }
}

class Graph {
  constructor() {
    this.nodes = new Map();
    this.heads = new Map();
    this.edgeCount = 0;
  }
  addNode(node) {
    if (this.nodes.has(node.id)) throw new Error('Duplicate node ' + node.id);
    this.nodes.set(node.id, node);
    this.heads.set(node.id, null);
  }
  addEdge(from, to, distanceKm, timeMin, bidirectional = true) {
    if (!this.nodes.has(from) || !this.nodes.has(to)) throw new Error('Unknown node');
    if (distanceKm < 0 || timeMin < 0) throw new Error('Negative weight not allowed');
    this.heads.set(from, new EdgeNode({ to, distanceKm, timeMin }, this.heads.get(from)));
    this.edgeCount++;
    if (bidirectional) this.addEdge(to, from, distanceKm, timeMin, false);
  }
  getNode(id) { return this.nodes.get(id); }
  hasNode(id) { return this.nodes.has(id); }
  get nodeCount() { return this.nodes.size; }
  nodeIds() { return this.nodes.keys(); }
  *neighbors(id) {
    let cur = this.heads.get(id) || null;
    while (cur) { yield cur.edge; cur = cur.next; }
  }
}

/* ---------- Min-Heap (array-backed binary heap) ---------- */
class MinHeap {
  constructor(compare) {
    this.data = [];
    this.compare = compare;
    this.pushes = 0;
    this.pops = 0;
  }
  get size() { return this.data.length; }
  isEmpty() { return this.data.length === 0; }
  peek() { return this.data[0]; }
  push(value) {
    this.pushes++;
    this.data.push(value);
    this._siftUp(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return undefined;
    this.pops++;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) { this.data[0] = last; this._siftDown(0); }
    return top;
  }
  _siftUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(this.data[i], this.data[p]) >= 0) break;
      [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
      i = p;
    }
  }
  _siftDown(i) {
    const n = this.data.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.compare(this.data[l], this.data[s]) < 0) s = l;
      if (r < n && this.compare(this.data[r], this.data[s]) < 0) s = r;
      if (s === i) break;
      [this.data[i], this.data[s]] = [this.data[s], this.data[i]];
      i = s;
    }
  }
}

/* ---------- Battery-aware Dijkstra ---------- */
function dijkstra(graph, source, opts = {}) {
  const maxKm = opts.maxDistanceKm === undefined ? Infinity : opts.maxDistanceKm;
  const timeMin = new Map([[source, 0]]);
  const distKm = new Map([[source, 0]]);
  const prev = new Map();
  const done = new Set();
  const popOrder = [];
  const heap = new MinHeap((a, b) => a.time - b.time);
  heap.push({ id: source, time: 0 });

  while (!heap.isEmpty()) {
    const { id, time } = heap.pop();
    if (done.has(id)) continue; // lazy deletion of stale entries
    done.add(id);
    popOrder.push({ id, time });
    for (const e of graph.neighbors(id)) {
      if (done.has(e.to)) continue;
      const newKm = distKm.get(id) + e.distanceKm;
      if (newKm > maxKm) continue; // battery-range pruning
      const newTime = time + e.timeMin;
      const known = timeMin.has(e.to) ? timeMin.get(e.to) : Infinity;
      if (newTime < known) {
        timeMin.set(e.to, newTime);
        distKm.set(e.to, newKm);
        prev.set(e.to, id);
        heap.push({ id: e.to, time: newTime });
      }
    }
  }
  return { source, timeMin, distKm, prev, popOrder, heapPushes: heap.pushes, heapPops: heap.pops };
}

function buildPath(r, target) {
  if (!r.timeMin.has(target)) return null;
  const path = [target];
  while (path[0] !== r.source) path.unshift(r.prev.get(path[0]));
  return path;
}

/* ---------- Range-limited BFS ---------- */
function reachableStations(graph, sourceId, rangeKm) {
  const best = new Map([[sourceId, 0]]);
  const queue = [sourceId];
  let head = 0;
  let visits = 0;
  while (head < queue.length) {
    const u = queue[head++];
    visits++;
    const du = best.get(u);
    for (const e of graph.neighbors(u)) {
      const nd = du + e.distanceKm;
      if (nd > rangeKm) continue;
      const known = best.has(e.to) ? best.get(e.to) : Infinity;
      if (nd < known) { best.set(e.to, nd); queue.push(e.to); }
    }
  }
  const stations = [...best.entries()]
    .filter(([id]) => graph.getNode(id).type === 'station')
    .map(([id, distKm]) => ({ id, name: graph.getNode(id).name, distKm }))
    .sort((a, b) => a.distKm - b.distKm);
  return { stations, visits, reachedIds: new Set(best.keys()) };
}

/* ---------- Route planner: direct route, or one charging stop ---------- */
function planRoute(graph, input, deps) {
  const reserve = input.reservePercent === undefined ? 10 : input.reservePercent;
  const priceWeight = input.priceWeight === undefined ? 0.5 : input.priceWeight;
  const chargeMin = input.chargeMinutes === undefined ? 30 : input.chargeMinutes;

  const usableNow = Math.max(0, ((input.batteryPercent - reserve) / 100) * input.fullRangeKm);
  const usableFull = ((100 - reserve) / 100) * input.fullRangeKm;

  const direct = dijkstra(graph, input.sourceId, { maxDistanceKm: usableNow });
  const directPath = buildPath(direct, input.destinationId);
  const stats = { usableNowKm: usableNow, usableFullKm: usableFull };

  if (directPath) {
    return {
      feasible: true, needsCharging: false, path: directPath,
      totalTimeMin: direct.timeMin.get(input.destinationId),
      totalDistanceKm: direct.distKm.get(input.destinationId),
      candidates: [], stats: { ...stats, heapPushes: direct.heapPushes, heapPops: direct.heapPops },
      popOrder: direct.popOrder
    };
  }

  const fromDest = dijkstra(graph, input.destinationId, { maxDistanceKm: usableFull });
  const heap = new MinHeap((a, b) => a.cost - b.cost);

  for (const [id, t1] of direct.timeMin) {
    const node = graph.getNode(id);
    if (!node || node.type !== 'station' || !fromDest.timeMin.has(id)) continue;
    const t2 = fromDest.timeMin.get(id);
    const wait = deps.getWaitMinutes(id);
    const cost = t1 + wait + chargeMin + t2 + priceWeight * (node.pricePerKwh || 0);
    heap.push({ id, cost, t1, t2, wait });
  }

  // Ranked candidate list (pop everything off the heap, best first)
  const candidates = [];
  while (!heap.isEmpty()) candidates.push(heap.pop());

  const statsAll = { ...stats, heapPushes: direct.heapPushes + fromDest.heapPushes + candidates.length,
                     heapPops: direct.heapPops + fromDest.heapPops + candidates.length };

  if (candidates.length === 0) {
    return { feasible: false, needsCharging: true, path: [], candidates: [], stats: statsAll,
      popOrder: direct.popOrder,
      message: 'No reachable charging station can get you to the destination.' };
  }

  const best = candidates[0];
  const leg1 = buildPath(direct, best.id);
  const leg2 = buildPath(fromDest, best.id).reverse();
  const station = graph.getNode(best.id);

  return {
    feasible: true, needsCharging: true,
    path: [...leg1, ...leg2.slice(1)],
    legSplitIndex: leg1.length - 1,
    totalTimeMin: best.t1 + best.wait + chargeMin + best.t2,
    totalDistanceKm: direct.distKm.get(best.id) + fromDest.distKm.get(best.id),
    chargingStop: { stationId: best.id, name: station.name, pricePerKwh: station.pricePerKwh,
                    waitMin: best.wait, chargeMin },
    candidates, stats: statsAll, popOrder: direct.popOrder
  };
}

if (typeof module !== 'undefined') {
  module.exports = { Graph, MinHeap, dijkstra, buildPath, reachableStations, planRoute };
}

/* Sample road + station network (Pune-style place names, coordinates are map units, not GPS). */
const SAMPLE_NODES = [
  { id: 'HJ', type: 'junction', name: 'Hinjewadi', x: 70, y: 300 },
  { id: 'WK', type: 'junction', name: 'Wakad', x: 210, y: 215 },
  { id: 'PM', type: 'junction', name: 'Pimpri', x: 230, y: 85 },
  { id: 'BN', type: 'junction', name: 'Baner', x: 340, y: 305 },
  { id: 'AU', type: 'junction', name: 'Aundh', x: 345, y: 170 },
  { id: 'KO', type: 'junction', name: 'Kothrud', x: 400, y: 440 },
  { id: 'SN', type: 'junction', name: 'Shivajinagar', x: 540, y: 255 },
  { id: 'SW', type: 'junction', name: 'Swargate', x: 590, y: 425 },
  { id: 'VN', type: 'junction', name: 'Viman Nagar', x: 730, y: 130 },
  { id: 'KH', type: 'junction', name: 'Kharadi', x: 860, y: 190 },
  { id: 'HD', type: 'junction', name: 'Hadapsar', x: 905, y: 395 },
  { id: 'KT', type: 'junction', name: 'Katraj', x: 620, y: 570 },
  { id: 'ST1', type: 'station', name: 'Wakad Fast Hub', x: 235, y: 320, pricePerKwh: 14 },
  { id: 'ST2', type: 'station', name: 'Baner Plug Point', x: 440, y: 225, pricePerKwh: 11 },
  { id: 'ST3', type: 'station', name: 'Kothrud Volt Stop', x: 490, y: 365, pricePerKwh: 9 },
  { id: 'ST4', type: 'station', name: 'Shivajinagar Charge Bay', x: 640, y: 195, pricePerKwh: 12 },
  { id: 'ST5', type: 'station', name: 'Kharadi Supercharge', x: 810, y: 290, pricePerKwh: 16 },
  { id: 'ST6', type: 'station', name: 'Swargate EV Hub', x: 750, y: 495, pricePerKwh: 10 }
];

/* [from, to, average speed km/h] */
const SAMPLE_EDGES = [
  ['HJ', 'WK', 40], ['HJ', 'ST1', 35], ['WK', 'PM', 45], ['WK', 'AU', 40], ['WK', 'ST1', 35],
  ['ST1', 'BN', 40], ['BN', 'AU', 35], ['BN', 'KO', 35], ['BN', 'ST2', 35], ['AU', 'ST2', 40],
  ['AU', 'PM', 30], ['ST2', 'SN', 45], ['AU', 'SN', 45], ['KO', 'ST3', 35], ['ST3', 'SN', 40],
  ['ST3', 'SW', 35], ['KO', 'SW', 30], ['SN', 'SW', 35], ['SN', 'ST4', 45], ['ST4', 'VN', 50],
  ['SN', 'VN', 45], ['VN', 'KH', 50], ['VN', 'ST5', 45], ['ST5', 'KH', 45], ['ST5', 'HD', 50],
  ['KH', 'HD', 45], ['SW', 'HD', 50], ['SW', 'ST6', 40], ['ST6', 'KT', 35], ['ST6', 'HD', 45],
  ['SW', 'KT', 35]
];

const KM_PER_UNIT = 0.06;   // map units to km
const ROAD_FACTOR = 1.2;    // roads are longer than the straight line

function buildSampleGraph() {
  const GraphClass = (typeof Graph !== 'undefined') ? Graph : require('./core.js').Graph;
  const g = new GraphClass();
  SAMPLE_NODES.forEach(n => g.addNode({ ...n }));
  SAMPLE_EDGES.forEach(([a, b, speed]) => {
    const na = g.getNode(a), nb = g.getNode(b);
    const straight = Math.hypot(na.x - nb.x, na.y - nb.y);
    const km = Math.round(straight * KM_PER_UNIT * ROAD_FACTOR * 10) / 10;
    const min = Math.round((km / speed) * 60 * 10) / 10;
    g.addEdge(a, b, km, min);
  });
  return g;
}

if (typeof module !== 'undefined') module.exports = { SAMPLE_NODES, SAMPLE_EDGES, buildSampleGraph };

/* Self-checks. Used by node (node tests.js) and by the in-page "Self-check" panel. */
function runSelfChecks(env) {
  const { Graph, MinHeap, dijkstra, buildPath, reachableStations, planRoute, buildSampleGraph } = env;
  const results = [];
  const check = (group, name, fn) => {
    try { const ok = fn(); results.push({ group, name, ok: ok === true }); }
    catch (e) { results.push({ group, name, ok: false, err: String(e) }); }
  };

  // MinHeap
  check('MinHeap', 'pops in ascending order', () => {
    const h = new MinHeap((a, b) => a - b);
    [5, 1, 9, 3, 7, 2].forEach(x => h.push(x));
    const out = []; while (!h.isEmpty()) out.push(h.pop());
    return JSON.stringify(out) === '[1,2,3,5,7,9]';
  });
  check('MinHeap', 'pop on empty returns undefined', () => new MinHeap((a, b) => a - b).pop() === undefined);
  check('MinHeap', 'handles duplicates', () => {
    const h = new MinHeap((a, b) => a - b);
    [4, 4, 1, 1, 4].forEach(x => h.push(x));
    const out = []; while (!h.isEmpty()) out.push(h.pop());
    return JSON.stringify(out) === '[1,1,4,4,4]';
  });

  // Graph
  const tiny = () => {
    const g = new Graph();
    ['A', 'B', 'C'].forEach(id => g.addNode({ id, type: 'junction', name: id }));
    g.addEdge('A', 'B', 2, 4);
    g.addEdge('B', 'C', 3, 6);
    return g;
  };
  check('Graph', 'bidirectional edge gives two neighbour entries', () => {
    const g = tiny();
    return [...g.neighbors('A')].length === 1 && [...g.neighbors('B')].length === 2;
  });
  check('Graph', 'unknown node throws', () => { try { tiny().addEdge('A', 'Z', 1, 1); return false; } catch { return true; } });
  check('Graph', 'negative weight throws', () => { try { tiny().addEdge('A', 'C', -1, 1); return false; } catch { return true; } });
  check('Graph', 'duplicate node throws', () => { try { tiny().addNode({ id: 'A', type: 'junction', name: 'A' }); return false; } catch { return true; } });

  // Dijkstra
  check('Dijkstra', 'finds the fastest path, not the shortest hop count', () => {
    const g = new Graph();
    ['A', 'B', 'C', 'D'].forEach(id => g.addNode({ id, type: 'junction', name: id }));
    g.addEdge('A', 'D', 10, 50);
    g.addEdge('A', 'B', 3, 10); g.addEdge('B', 'C', 3, 10); g.addEdge('C', 'D', 3, 10);
    const r = dijkstra(g, 'A');
    return JSON.stringify(buildPath(r, 'D')) === '["A","B","C","D"]' && r.timeMin.get('D') === 30;
  });
  check('Dijkstra', 'returns null for an unreachable node', () => {
    const g = tiny(); g.addNode({ id: 'X', type: 'junction', name: 'X' });
    return buildPath(dijkstra(g, 'A'), 'X') === null;
  });
  check('Dijkstra', 'battery limit prunes far nodes', () => {
    const r = dijkstra(tiny(), 'A', { maxDistanceKm: 4 });
    return r.timeMin.has('B') && !r.timeMin.has('C');
  });

  // BFS
  const sample = buildSampleGraph();
  check('BFS', 'small range returns only nearby stations, sorted', () => {
    const r = reachableStations(sample, 'HJ', 20).stations;
    return r.length > 0 && r.every((s, i) => i === 0 || r[i - 1].distKm <= s.distKm) && r.every(s => s.distKm <= 20);
  });
  check('BFS', 'zero range returns nothing', () => reachableStations(sample, 'HJ', 0).stations.length === 0);

  // Route planner on the sample network
  const noWait = { getWaitMinutes: () => 0 };
  const base = { sourceId: 'HJ', destinationId: 'HD', fullRangeKm: 200 };
  check('Planner', 'high battery: direct route, no stop', () => {
    const p = planRoute(sample, { ...base, batteryPercent: 90 }, noWait);
    return p.feasible && !p.needsCharging && p.path[0] === 'HJ' && p.path.at(-1) === 'HD';
  });
  check('Planner', 'low battery: route includes a charging stop', () => {
    const p = planRoute(sample, { ...base, batteryPercent: 35 }, noWait);
    return p.feasible && p.needsCharging && p.path.includes(p.chargingStop.stationId);
  });
  check('Planner', 'very low battery: no feasible route', () => {
    const p = planRoute(sample, { ...base, batteryPercent: 12 }, noWait);
    return !p.feasible;
  });
  check('Planner', 'a long queue at the best station changes the choice', () => {
    const a = planRoute(sample, { ...base, batteryPercent: 35 }, noWait);
    const busy = planRoute(sample, { ...base, batteryPercent: 35 },
      { getWaitMinutes: id => (id === a.chargingStop.stationId ? 120 : 0) });
    return busy.feasible && busy.chargingStop.stationId !== a.chargingStop.stationId;
  });
  check('Planner', 'total time = drive + wait + charge on a stop trip', () => {
    const p = planRoute(sample, { ...base, batteryPercent: 35 }, { getWaitMinutes: () => 7 });
    const c = p.candidates[0];
    return Math.abs(p.totalTimeMin - (c.t1 + c.wait + 30 + c.t2)) < 1e-9;
  });

  return results;
}

if (typeof module !== 'undefined') {
  module.exports = { runSelfChecks };
  if (require.main === module) {
    const core = require('./core.js');
    const data = require('./data.js');
    const res = runSelfChecks({ ...core, buildSampleGraph: data.buildSampleGraph });
    res.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.group + ': ' + r.name + (r.err ? '  ' + r.err : '')));
    const failed = res.filter(r => !r.ok).length;
    console.log('\n' + (res.length - failed) + '/' + res.length + ' passed');
    process.exit(failed ? 1 : 0);
  }
}
