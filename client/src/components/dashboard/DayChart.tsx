/**
 * WattWay · Team Kothimbir 🌿
 * DayChart.tsx — today's occupancy (line, left axis %) and queue depth (bars,
 * right axis cars), hour by hour.
 */
import type { HourStat } from '../../services/dashboard';

const W = 600;
const H = 230;
const PAD = { l: 42, r: 40, t: 14, b: 34 };

export function DayChart({ stats }: { stats: HourStat[] }) {
  if (stats.length === 0) return null;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const step = iw / stats.length;
  const maxQ = Math.max(4, ...stats.map((s) => s.queueDepth));
  const x = (i: number) => PAD.l + step * i + step / 2;
  const yPct = (p: number) => PAD.t + ih - (p / 100) * ih;
  const yQ = (q: number) => PAD.t + ih - (q / maxQ) * ih;
  const line = stats.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${yPct(s.occupancyPct).toFixed(1)}`).join(' ');
  const peak = stats.reduce((a, b) => (b.occupancyPct > a.occupancyPct ? b : a));

  return (
    <figure className="db-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Occupancy peaks at ${peak.occupancyPct}% around ${peak.hour}:00`}>
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={yPct(p)} y2={yPct(p)} />
            <text x={PAD.l - 8} y={yPct(p) + 4} textAnchor="end">
              {p}%
            </text>
          </g>
        ))}
        {[0, Math.round(maxQ / 2), maxQ].map((q) => (
          <text key={q} x={W - PAD.r + 8} y={yQ(q) + 4} className="db-q-axis">
            {q}
          </text>
        ))}
        {stats.map((s, i) => (
          <rect
            key={s.hour}
            className="db-bar"
            x={x(i) - step * 0.3}
            width={step * 0.6}
            y={yQ(s.queueDepth)}
            height={PAD.t + ih - yQ(s.queueDepth)}
          >
            <title>{`${s.hour}:00 · ${s.occupancyPct}% busy · ${s.queueDepth} waiting`}</title>
          </rect>
        ))}
        <path className="db-line" d={line} />
        {stats.map((s, i) => (
          <circle key={s.hour} className="db-dot" cx={x(i)} cy={yPct(s.occupancyPct)} r={3}>
            <title>{`${s.hour}:00 · ${s.occupancyPct}% busy`}</title>
          </circle>
        ))}
        {stats.map((s, i) =>
          i % 2 === 0 ? (
            <text key={s.hour} x={x(i)} y={H - 12} textAnchor="middle">
              {s.hour}h
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="db-legend">
        <span>
          <span className="db-key line" /> Ports in use (%)
        </span>
        <span>
          <span className="db-key bar" /> Cars waiting
        </span>
      </figcaption>
    </figure>
  );
}
