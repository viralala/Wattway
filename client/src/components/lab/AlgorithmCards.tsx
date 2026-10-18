/**
 * WattWay · Team Kothimbir 🌿
 * AlgorithmCards.tsx — one short card per algorithm: what it does, its time
 * complexity, and why WattWay uses it.
 */
import type { AlgorithmId } from '../../services/algorithms';
import { ALGORITHM_META } from '../../utils/lab';

const CARDS: Array<{ id: AlgorithmId; does: string; time: string; why: string }> = [
  {
    id: 'dijkstra',
    does: 'Always expands the cheapest unsettled node next, so it spreads outward from the start in a circle until it reaches the goal.',
    time: 'O((V + E) log V) with a binary heap',
    why: 'The dependable baseline for “shortest drive to a charger” — as long as no road has a negative cost.',
  },
  {
    id: 'astar',
    does: 'Dijkstra plus a straight-line guess of the distance left, so it leans toward the goal and searches a narrow cone instead of a circle.',
    time: 'O(E) in the best case, O(b^d) worst case; never worse than Dijkstra with a good heuristic',
    why: 'Most trips have an obvious direction. A* uses it to answer faster, and the weight slider shows the speed-vs-optimality trade.',
  },
  {
    id: 'bellmanFord',
    does: 'Relaxes every road, over and over, until nothing improves. Slow, but it copes with negative costs and detects impossible loops.',
    time: 'O(V · E)',
    why: 'Regenerative braking makes some downhill roads cost negative energy. Bellman-Ford is the only one here that stays correct.',
  },
  {
    id: 'floydWarshall',
    does: 'Computes the best route between every pair of nodes at once by trying each node as a stepping stone.',
    time: 'O(V³) time, O(V²) space',
    why: 'Run once, it gives the operator dashboard an instant station-to-station distance table, and feeds the TSP solvers.',
  },
  {
    id: 'tspExact',
    does: 'Held-Karp dynamic programming: finds the genuinely shortest tour through all stops by remembering the best way to visit every subset.',
    time: 'O(k² · 2ᵏ)',
    why: 'For a handful of charging stops it returns the true optimum — and the yardstick the heuristic is judged against.',
  },
  {
    id: 'tspNearestNeighbour',
    does: 'Greedy: always drives to the closest stop not yet visited, then heads home. No look-ahead.',
    time: 'O(k²)',
    why: 'Instant at any size. When exact is too slow, it gives a decent tour — usually a bit longer than optimal.',
  },
];

export function AlgorithmCards() {
  return (
    <div className="grid cols-3">
      {CARDS.map((c) => {
        const meta = ALGORITHM_META[c.id];
        return (
          <article key={c.id} className="card algo-card" style={{ borderTop: `6px solid ${meta.color}` }}>
            <h3>{meta.label}</h3>
            <p>{c.does}</p>
            <p className="algo-line">
              <strong>Time:</strong> <span className="mono">{c.time}</span>
            </p>
            <p className="algo-line">
              <strong>Why WattWay:</strong> {c.why}
            </p>
          </article>
        );
      })}
    </div>
  );
}
