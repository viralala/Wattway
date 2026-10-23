/**
 * WattWay · Team Kothimbir 🌿
 * GraphCanvas.tsx — the Lab's road map: roads, each search's growing search
 * tree (shaded roads), each spanning tree, each algorithm's final route in its
 * own colour, and the start / end / tour-stop markers. Click a node to pick it.
 */
import { useMemo, useRef } from 'react';
import type { AlgorithmId, AlgorithmResult, CostMode, LabGraphData, LabNode } from '../../services/algorithms';
import { ALGORITHM_META, nearestNode, offsetPolyline, revealedCount } from '../../utils/lab';

interface Props {
  graph: LabGraphData;
  results: AlgorithmResult[];
  visible: Set<AlgorithmId>;
  /** Algorithms whose tree is drawn growing (searches) or animated (spanning trees). */
  animate: Set<AlgorithmId>;
  /** How many tree roads to show per algorithm right now (Infinity = all). */
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
  animate,
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

  const shown = (r: AlgorithmResult): number =>
    animate.has(r.algorithm) ? revealedCount(r.treeEdges.length, progress) : r.treeEdges.length;
  const searching = results.filter(
    (r) => visible.has(r.algorithm) && animate.has(r.algorithm) && ALGORITHM_META[r.algorithm].kind === 'search',
  );
  const spanning = results.filter((r) => visible.has(r.algorithm) && ALGORITHM_META[r.algorithm].kind === 'mst');
  const drawable = results.filter((r) => visible.has(r.algorithm) && r.path.length > 1);
  const pathReady = (r: AlgorithmResult): boolean => shown(r) >= r.treeEdges.length;

  // Tours underneath; shortest-path algorithms on top, nudged apart so identical routes stay visible.
  const tourPaths = drawable.filter((r) => ALGORITHM_META[r.algorithm].kind === 'tour');
  const roadPaths = drawable.filter((r) => ALGORITHM_META[r.algorithm].kind === 'search');

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

      {/* search trees: the roads each search has travelled so far, as a soft shaded band —
          the bigger search underneath so the narrower one stays readable on top */}
      {[...searching]
        .sort((p, q) => q.treeEdges.length - p.treeEdges.length)
        .map((r) => (
          <g key={`search-${r.algorithm}`} className="lab-search" style={{ stroke: ALGORITHM_META[r.algorithm].color }}>
            {r.treeEdges.slice(0, shown(r)).map(([from, to]) => (
              <polyline key={`${from}-${to}`} points={line([from, to])} />
            ))}
          </g>
        ))}

      {/* spanning trees: thin lines, nudged apart because Kruskal and Prim find the same tree */}
      {spanning.map((r) => (
        <g key={`mst-${r.algorithm}`} className="lab-mst" style={{ stroke: ALGORITHM_META[r.algorithm].color }}>
          {r.treeEdges.slice(0, shown(r)).map(([from, to]) => (
            <polyline key={`${from}-${to}`} points={line([from, to], r.algorithm === 'kruskal' ? -0.11 : 0.11)} />
          ))}
        </g>
      ))}

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
