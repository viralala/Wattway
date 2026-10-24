/**
 * WattWay · Team Kothimbir 🌿
 * BenchmarkChart.tsx — runtime vs graph size, one line per algorithm, on a log
 * axis (exact TSP and the greedy tour differ by orders of magnitude, so a linear
 * axis would flatten everything but the slowest line).
 */
import type { AlgorithmId, BenchmarkRow } from '../../services/algorithms';
import { ALGORITHM_META, ALL_ALGORITHMS, formatMs, logTicks } from '../../utils/lab';

const W = 760;
const H = 360;
const M = { top: 16, right: 20, bottom: 44, left: 64 };
const FLOOR_MS = 0.001; // readings below a microsecond are timer noise

export function BenchmarkChart({ rows, visible }: { rows: BenchmarkRow[]; visible: Set<AlgorithmId> }) {
  if (rows.length === 0) return null;
  const sizes = rows.map((r) => r.size);
  const xMin = Math.min(...sizes);
  const xMax = Math.max(...sizes);
  const active = ALL_ALGORITHMS.filter((id) => visible.has(id));
  const values = rows.flatMap((r) => active.map((id) => Math.max(FLOOR_MS, r.runtimeMs[id])));
  const ticks = logTicks(Math.min(...values, 1), Math.max(...values, 1));
  const yLo = Math.log10(ticks[0]);
  const yHi = Math.log10(ticks[ticks.length - 1]);

  const x = (size: number): number =>
    M.left + (xMax === xMin ? 0.5 : (size - xMin) / (xMax - xMin)) * (W - M.left - M.right);
  const y = (ms: number): number =>
    M.top + (1 - (Math.log10(Math.max(FLOOR_MS, ms)) - yLo) / (yHi - yLo || 1)) * (H - M.top - M.bottom);

  return (
    <svg className="lab-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Runtime in milliseconds against graph size, log scale">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="grid" />
          <text x={M.left - 8} y={y(t) + 4} textAnchor="end">
            {formatMs(t).replace('<', '')}
          </text>
        </g>
      ))}
      {rows.map((r) => (
        <text key={r.size} x={x(r.size)} y={H - M.bottom + 20} textAnchor="middle">
          {r.size}
        </text>
      ))}
      <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" className="axis-title">
        graph size (nodes)
      </text>
      <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} className="axis" />
      <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} className="axis" />

      {active.map((id) => {
        const meta = ALGORITHM_META[id];
        const points = rows.map((r) => `${x(r.size)},${y(r.runtimeMs[id])}`).join(' ');
        return (
          <g key={id} style={{ stroke: meta.color, fill: meta.color }}>
            <polyline points={points} fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeDasharray={meta.dashed ? '6 4' : undefined} />
            {rows.map((r) => (
              <circle key={r.size} cx={x(r.size)} cy={y(r.runtimeMs[id])} r={4} stroke="none">
                <title>{`${meta.label} · ${r.size} nodes · ${formatMs(r.runtimeMs[id])}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
