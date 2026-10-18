/**
 * WattWay · Team Kothimbir 🌿
 * DataStructures.tsx — each structure, the feature it powers, and where it lives.
 */
import { PageHead } from '../components/ui';
import { pending, shipped, type DataStructure } from '../services/structures';

function StructureCard({ s }: { s: DataStructure }) {
  const isShipped = s.status === 'shipped';
  const ops = Object.entries(s.complexity);
  return (
    <article className={`card ds-card${isShipped ? '' : ' pending'}`}>
      <div className="ds-card-top">
        <h3>{s.name}</h3>
        <span className={`badge ${isShipped ? 'badge-ok' : 'badge-warn'}`}>{isShipped ? 'Shipped' : 'Pending'}</span>
      </div>
      <div className="ds-meta">
        <div>
          <span className="label">{isShipped ? 'Powers:' : 'Planned for:'}</span> {s.usedBy}
        </div>
        <div>
          <span className="label">File:</span> <code>{s.file}</code>
        </div>
      </div>
      <p className="ds-why">{s.why}</p>
      {ops.length > 0 && (
        <table className="ds-complexity">
          <thead>
            <tr>
              <th scope="col">Operation</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {ops.map(([op, cost]) => (
              <tr key={op}>
                <td>{op}</td>
                <td className="mono">{cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

export default function DataStructures() {
  return (
    <div className="container">
      <PageHead eyebrow="under the hood" title="Data structures">
        Every structure is written from first principles, with no library standing in for it, and unit-tested without
        Express, Mongoose or a network. Here is what each one powers and where it lives.
      </PageHead>

      <section className="ds-section">
        <h2>Shipped</h2>
        <div className="ds-grid">
          {shipped.map((s) => (
            <StructureCard key={s.name} s={s} />
          ))}
        </div>
      </section>

      <section className="ds-section">
        <h2>The live index that ties them together</h2>
        <div className="card">
          <p>
            <code>server/src/services/stationIndex.ts</code> is one process-wide singleton that owns the price BST, the
            rating BST and the name Trie over the same station set. MongoDB is the source of truth; the index is a
            derived, eventually-consistent view.
          </p>
          <ul className="ds-list">
            <li>
              <strong>Consistency:</strong> station writes call <code>upsert()</code> or <code>remove()</code>{' '}
              synchronously, and a periodic rebuild catches writes made by anything else.
            </li>
            <li>
              <strong>Atomic swap:</strong> a rebuild builds new structures off to the side and swaps them in by
              reference, so a search never sees a half-built tree.
            </li>
            <li>
              <strong>The ghost-entry trap:</strong> <code>upsert()</code> removes before inserting, so a station whose
              price moves from ₹12 to ₹14 leaves the ₹12 bucket.
            </li>
          </ul>
        </div>
      </section>

      <section className="ds-section">
        <h2>Coming from the other modules</h2>
        <div className="ds-grid">
          {pending.map((s) => (
            <StructureCard key={s.name} s={s} />
          ))}
        </div>
      </section>
    </div>
  );
}
