/**
 * WattWay · Team Kothimbir 🌿
 * roadLinks.ts — a plausible road network between live stations.
 *
 * The API has no road graph yet, so the distance table needs links to run
 * Floyd–Warshall over. Each station is joined to its nearest few neighbours,
 * then any disconnected clusters are bridged by their closest pair, so every
 * station can reach every other.
 */
import type { Station } from '../services/stations';
import type { Edge } from './floyd';
import { roadKm } from './route';

export function buildRoadLinks(stations: Station[], neighbours = 3): Edge[] {
  const n = stations.length;
  const km = (i: number, j: number) => Math.round(roadKm(stations[i].location, stations[j].location) * 10) / 10;
  const seen = new Set<string>();
  const edges: Edge[] = [];
  const add = (i: number, j: number) => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (i === j || seen.has(key)) return;
    seen.add(key);
    edges.push({ a: stations[i].id, b: stations[j].id, km: km(i, j) });
  };

  for (let i = 0; i < n; i += 1) {
    const order = [...Array(n).keys()].filter((j) => j !== i).sort((x, y) => km(i, x) - km(i, y));
    order.slice(0, neighbours).forEach((j) => add(i, j));
  }

  // Union-find to bridge clusters.
  const parent = [...Array(n).keys()];
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const index = new Map(stations.map((s, i) => [s.id, i]));
  for (const e of edges) parent[find(index.get(e.a) as number)] = find(index.get(e.b) as number);

  for (;;) {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < n; i += 1)
      for (let j = i + 1; j < n; j += 1) {
        if (find(i) === find(j)) continue;
        const d = km(i, j);
        if (!best || d < best[0]) best = [d, i, j];
      }
    if (!best) break;
    add(best[1], best[2]);
    parent[find(best[1])] = find(best[2]);
  }
  return edges;
}
