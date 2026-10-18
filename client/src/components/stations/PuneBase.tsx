/**
 * WattWay · Team Kothimbir 🌿
 * PuneBase.tsx — the shared hand-drawn Pune backdrop (rivers + highways) used by
 * the station map and the route planner. No tile server: rough polylines over
 * real coordinates keep the pages offline-friendly and on-theme.
 */
import { useMemo } from 'react';
import type { LatLng } from '../../services/stations';
import type { Projection } from '../../utils/stations';

export const pt = (lat: number, lng: number): LatLng => ({ lat, lng });

/** Extra northern point to fit, leaving headroom for pins (they stand above their coordinate). */
export const HEADROOM = pt(18.612, 73.85);

const RIVERS: LatLng[][] = [
  // Mutha, from Khadakwasla towards the Sangam
  [pt(18.452, 73.75), pt(18.478, 73.784), pt(18.5, 73.812), pt(18.515, 73.838), pt(18.528, 73.856), pt(18.531, 73.866)],
  // Mula, from the north-west past Aundh
  [pt(18.612, 73.735), pt(18.585, 73.784), pt(18.563, 73.812), pt(18.546, 73.84), pt(18.531, 73.866)],
  // Mula–Mutha, east past Koregaon Park and Kharadi
  [pt(18.531, 73.866), pt(18.538, 73.888), pt(18.548, 73.912), pt(18.552, 73.935), pt(18.565, 73.962)],
];

const ROADS: LatLng[][] = [
  // Mumbai–Bengaluru bypass
  [pt(18.612, 73.742), pt(18.573, 73.778), pt(18.54, 73.795), pt(18.5, 73.808), pt(18.468, 73.83), pt(18.445, 73.852)],
  // Pune–Solapur road
  [pt(18.51, 73.86), pt(18.507, 73.895), pt(18.5, 73.94), pt(18.495, 73.965)],
  // Pune–Satara road
  [pt(18.51, 73.86), pt(18.48, 73.858), pt(18.445, 73.856)],
  // Nagar road
  [pt(18.531, 73.866), pt(18.548, 73.9), pt(18.56, 73.93), pt(18.565, 73.962)],
];

/** Catmull-Rom through the points, as cubic Béziers. */
export function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

/** Teardrop pin with its tip at (0, 0). */
export const PIN = 'M0 0 C-1.4 -1.8 -2.2 -2.7 -2.2 -3.8 A2.2 2.2 0 1 1 2.2 -3.8 C2.2 -2.7 1.4 -1.8 0 0 Z';

export function PuneBase({ proj }: { proj: Projection }) {
  const rivers = useMemo(() => RIVERS.map((r) => smoothPath(r.map(proj.project))), [proj]);
  const roads = useMemo(() => ROADS.map((r) => smoothPath(r.map(proj.project))), [proj]);
  return (
    <>
      <rect className="st-map-bg" width={proj.width} height={proj.height} />
      {rivers.map((d, i) => (
        <path key={`r${i}`} className="st-river" d={d} />
      ))}
      {roads.map((d, i) => (
        <path key={`d${i}`} className="st-road" d={d} />
      ))}
    </>
  );
}
