/**
 * WattWay · Team Kothimbir 🌿
 * DistanceMatrix.tsx — the Floyd–Warshall all-pairs table as a heatmap.
 * Click any cell to see the actual shortest path behind the number.
 */
import { useState } from 'react';
import type { Station } from '../../services/stations';
import { pathBetween, type AllPairs } from '../../utils/floyd';

export const shortCode = (s: Station) => s.address.locality.slice(0, 3).toUpperCase();

export function DistanceMatrix({ table, highlight }: { table: AllPairs & { stations: Station[] }; highlight: Set<string> }) {
  const [cell, setCell] = useState<[number, number] | null>(null);
  const { stations, dist } = table;
  const max = Math.max(...dist.flat().filter(Number.isFinite));
  const path = cell ? pathBetween(table, cell[0], cell[1]) : [];

  return (
    <div className="db-matrix">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Shortest road distance between every pair of stations, in km">
        <table className="db-fw">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">From \ to</span>
              </th>
              {stations.map((s, j) => (
                <th
                  key={s.id}
                  scope="col"
                  title={s.name}
                  className={`${highlight.has(s.id) ? 'mine' : ''}${cell && cell[1] === j ? ' active' : ''}`}
                >
                  {shortCode(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stations.map((row, i) => (
              <tr key={row.id}>
                <th scope="row" title={row.name} className={`${highlight.has(row.id) ? 'mine' : ''}${cell && cell[0] === i ? ' active' : ''}`}>
                  {shortCode(row)}
                </th>
                {stations.map((col, j) => {
                  const d = dist[i][j];
                  const selected = cell !== null && cell[0] === i && cell[1] === j;
                  return (
                    <td
                      key={col.id}
                      className={i !== j && d / max > 0.6 ? 'dark' : undefined}
                      style={{ ['--heat' as string]: i === j ? 0 : (d / max).toFixed(3) }}
                    >
                      {i === j ? (
                        <span className="db-fw-self">·</span>
                      ) : (
                        <button
                          className={`db-fw-cell${selected ? ' selected' : ''}`}
                          aria-pressed={selected}
                          aria-label={`${row.name} to ${col.name}: ${d.toFixed(1)} km`}
                          onClick={() => setCell(selected ? null : [i, j])}
                        >
                          {Number.isFinite(d) ? d.toFixed(1) : '∞'}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="db-path" aria-live="polite">
        {cell === null ? (
          <span className="muted">Pick a cell to see the route behind it.</span>
        ) : (
          <>
            <strong>
              {stations[cell[0]].name} → {stations[cell[1]].name}: {dist[cell[0]][cell[1]].toFixed(1)} km
            </strong>
            <span className="db-hops">
              {path.map((k, n) => (
                <span key={k} className="db-hop">
                  {n > 0 && <span aria-hidden="true"> → </span>}
                  {shortCode(stations[k])}
                </span>
              ))}
              <span className="muted">
                {' '}
                ({path.length - 2 <= 0 ? 'direct road' : `via ${path.length - 2} ${path.length - 2 === 1 ? 'station' : 'stations'}`})
              </span>
            </span>
          </>
        )}
      </p>
    </div>
  );
}
