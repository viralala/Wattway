/**
 * WattWay · Team Kothimbir 🌿
 * GraphCanvas.tsx — the Lab's road map: roads, the nodes each algorithm has
 * explored so far, each algorithm's final path in its own colour, and the
 * start / end / tour-stop markers. Click a node to pick it.
 */
import { useMemo, useRef } from 'react';
import type { AlgorithmId, AlgorithmResult, CostMode, LabGraphData, LabNode } from '../../services/algorithms';
import { ALGORITHM_META, nearestNode, offsetPolyline, revealedCount } from '../../utils/lab';

interface Props {
  graph: LabGraphData;
  results: AlgorithmResult[];
  visible: Set<AlgorithmId>;
  /** Algorithms whose explored nodes are drawn. */
  explore: Set<AlgorithmId>;
  /** How many explored nodes to show per algorithm right now (Infinity = all). */
  progress: number;
  mode: CostMode;
  startId: string;
  endId: string;
  stops: string[];
  showStops: boolean;
  pickLabel: 'start' | 'end';
  onPick: (node: LabNode) => void;
}

const PAD = 1.5;
const SIZE = 30 + PAD * 2;

/** Low ground is green, high ground tan — a hint of terrain under the roads. */
function terrainColor(elevation: number): string {
  const t = Math.min(1, Math.max(0, elevation / 330));
  return `hsl(${95 - t * 55}, ${42 - t * 8}%, ${74 - t * 16}%)`;
}

export function GraphCanvas({
  graph,
  results,
  visible,
  explore,
  progress,
  mode,
  startId,
  endId,
  stops,
  showStops,
  pickLabel,
  onPick,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const nodeR = Math.max(0.16, 0.5 - graph.nodes.length / 700);

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const hit = nearestNode(graph.nodes, point.x, point.y, 2.2);
    if (hit) onPick(hit);
  };

  const exploring = results.filter((r) => visible.has(r.algorithm) && explore.has(r.algorithm));
  const drawable = results.filter((r) => visible.has(r.algorithm) && r.path.length > 1);
  const pathReady = (r: AlgorithmResult): boolean =>
    !explore.has(r.algorithm) || revealedCount(r.visitedOrder.length, progress) >= r.visitedOrder.length;

  // Tours underneath; shortest-path algorithms on top, nudged apart so identical routes stay visible.
  const tourPaths = drawable.filter((r) => ALGORITHM_META[r.algorithm].dashed);
  const roadPaths = drawable.filter((r) => !ALGORITHM_META[r.algorithm].dashed);

  const line = (ids: string[], offset = 0): string =>
    offsetPolyline(
      ids.map((id) => byId.get(id)).filter((n): n is LabNode => Boolean(n)),
      offset,
    )
      .map((n) => `${n.x},${n.y}`)
      .join(' ');

  return (
    <svg
      ref={svgRef}
      className="lab-map"
      viewBox={`${-PAD} ${-PAD} ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Road graph with ${graph.nodes.length} nodes. Click a node to set the ${pickLabel}.`}
      onClick={handleClick}
    >
      <rect x={-PAD} y={-PAD} width={SIZE} height={SIZE} className="lab-map-bg" />

      {/* roads */}
      <g strokeLinecap="round">
        {graph.roads.map((road) => {
          const a = byId.get(road.a)!;
          const b = byId.get(road.b)!;
          const regen = mode === 'energy' && Math.min(road.energyAB, road.energyBA) < 0;
          return (
            <line
              key={`${road.a}-${road.b}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={regen ? 'lab-road regen' : 'lab-road'}
            />
          );
        })}
      </g>

      {/* explored nodes — biggest ring first so smaller ones stay visible on top */}
      {[...exploring]
          .sort((p, q) => q.visitedOrder.length - p.visitedOrder.length)
          .map((r, layer) => {
            const count = revealedCount(r.visitedOrder.length, progress);
            const meta = ALGORITHM_META[r.algorithm];
            return (
              <g key={`explore-${r.algorithm}`} style={{ fill: meta.color, stroke: meta.color }} fillOpacity={0.28} strokeOpacity={0.7} strokeWidth={0.1}>
                {r.visitedOrder.slice(0, count).map((id) => {
                  const n = byId.get(id);
                  return n ? <circle key={id} cx={n.x} cy={n.y} r={nodeR * (2.6 - layer * 0.45)} /> : null;
                })}
              </g>
            );
          })}

      {/* nodes */}
      <g>
        {graph.nodes.map((n) => (
          <circle key={n.id} cx={n.x} cy={n.y} r={nodeR} fill={terrainColor(n.elevation)} className="lab-node" />
        ))}
      </g>

      {/* final paths */}
      {tourPaths.map((r) => (
        <polyline
          key={`path-${r.algorithm}`}
          points={line(r.path, r.algorithm === 'tspExact' ? -0.12 : 0.12)}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={0.2}
          strokeDasharray="0.6 0.5"
          style={{ stroke: ALGORITHM_META[r.algorithm].color }}
          opacity={0.75}
        />
      ))}
      {roadPaths.map((r, i) =>
        pathReady(r) ? (
          <polyline
            key={`path-${r.algorithm}`}
            points={line(r.path, (i - (roadPaths.length - 1) / 2) * 0.2)}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={0.17}
            style={{ stroke: ALGORITHM_META[r.algorithm].color }}
            opacity={0.95}
          />
        ) : null,
      )}

      {/* tour stops */}
      {showStops &&
        stops.map((id, i) => {
          const n = byId.get(id);
          return n ? (
            <g key={`stop-${id}`} className="lab-stop">
              <circle cx={n.x} cy={n.y} r={0.78} />
              <text x={n.x} y={n.y + 0.34} textAnchor="middle">
                {i + 1}
              </text>
            </g>
          ) : null;
        })}

      {/* start / end */}
      {[
        { id: startId, label: 'S', cls: 'start' },
        { id: endId, label: 'E', cls: 'end' },
      ].map(({ id, label, cls }) => {
        const n = byId.get(id);
        return n ? (
          <g key={cls} className={`lab-pin ${cls}`}>
            <circle cx={n.x} cy={n.y} r={0.95} />
            <text x={n.x} y={n.y + 0.42} textAnchor="middle">
              {label}
            </text>
          </g>
        ) : null;
      })}
    </svg>
  );
}
