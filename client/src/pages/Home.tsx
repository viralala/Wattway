/**
 * WattWay · Team Kothimbir 🌿
 * Home.tsx — the landing page, following the hand-drawn travel-map design.
 */
import { LinkButton, Card, RouteDivider } from '../components/ui';
import { ScooterHero } from '../components/ScooterHero';
import mapBg from '../assets/images/map-bg.png';
import '../styles/home.css';

const PROBLEMS = [
  { icon: '📍', title: 'Closest isn’t best', body: 'The nearest charger may be pricey, broken-in, or already full. Distance is only one third of the story.' },
  { icon: '🔋', title: 'Your battery has opinions', body: 'At 18% you can’t detour twenty kilometres. WattWay plans around what your battery can actually reach.' },
  { icon: '🎲', title: 'Queues run on luck', body: 'Arrive, circle, hope. A live virtual queue tells you where you stand before you commit to the drive.' },
];

const FEATURES = [
  { icon: '🗺️', title: 'Live station map', body: 'Queue length, free ports, price and connector type for every nearby charger.', to: '/stations' },
  { icon: '⚡', title: 'Battery-aware routing', body: 'Pick the charging stop by weighing distance, wait time and price your way.', to: '/route' },
  { icon: '🎟️', title: 'Virtual queue', body: 'Join a line from your phone and watch your position tick down in real time.', to: '/queue' },
  { icon: '📊', title: 'Operator dashboard', body: 'Slot occupancy, queue depth and a precomputed station-to-station distance table.', to: '/dashboard' },
];

const STEPS = [
  { title: 'Tell us where', body: 'Enter a start, a destination and your battery level.' },
  { title: 'Set what matters', body: 'Slide between distance, wait time and price. The ranking updates as you drag.' },
  { title: 'Charge without the wait', body: 'Take the best stop, join its virtual queue and roll in when it’s your turn.' },
];

const DS = [
  { name: 'Binary search tree', use: 'Price & rating range filters', status: 'shipped' },
  { name: 'Trie', use: 'Search-box autocomplete', status: 'shipped' },
  { name: 'Array', use: 'Port-status board per station', status: 'shipped' },
  { name: 'Graph', use: 'Road + station network', status: 'in progress' },
  { name: 'Min-heap', use: 'Dijkstra frontier, top-N ranking', status: 'in progress' },
  { name: 'Queue & linked list', use: 'Waiting lines, O(1) mid-queue exit', status: 'in progress' },
  { name: 'Stack', use: 'Iterative DFS, undo last search', status: 'in progress' },
];

const STATS = [
  { n: '256', label: 'tests passing' },
  { n: '7', label: 'data structures' },
  { n: '5', label: 'algorithms compared' },
];

export default function Home() {
  return (
    <>
      <section className="hero" style={{ ['--map-bg' as string]: `url(${mapBg})` }}>
        <div className="container hero-inner">
          <h1 className="logo" aria-label="Wattway">
            <span className="logo-w" aria-hidden="true">W</span>
            <span className="logo-rest" aria-hidden="true">ATTWAY</span>
          </h1>
          <p className="tagline">
            Find the charger that’s actually the <span className="script">best</span>,
            <span className="line2">not just the closest</span>
          </p>
          <div className="hero-cta">
            <LinkButton to="/route">Plan a route</LinkButton>
            <LinkButton to="/stations" variant="secondary">Find stations near me</LinkButton>
          </div>
        </div>
        <ScooterHero />
      </section>

      <section className="section home-section">
        <div className="container">
          <div className="section-title">
            <span className="eyebrow">the trouble with</span>
            <h2>Every other charger finder</h2>
          </div>
          <div className="grid cols-3">
            {PROBLEMS.map((p) => (
              <div key={p.title} className="card problem-card">
                <div className="card-icon" aria-hidden="true">{p.icon}</div>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <RouteDivider />

      <section className="section home-section alt" id="features">
        <div className="container">
          <div className="section-title">
            <span className="eyebrow">what you get</span>
            <h2>Four tools, one trip</h2>
          </div>
          <div className="grid cols-4">
            {FEATURES.map((f) => (
              <Card key={f.title} icon={f.icon} title={f.title} to={f.to}>
                <p>{f.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="section home-section">
        <div className="container">
          <div className="section-title">
            <span className="eyebrow">how it works</span>
            <h2>Three steps to a better stop</h2>
          </div>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <RouteDivider flip />

      <section className="section home-section alt">
        <div className="container operators">
          <div>
            <span className="eyebrow">for operators</span>
            <h2>See your station the way drivers do</h2>
            <p>
              Watch slot occupancy and queue depth per station, and check a station-to-station
              distance table precomputed with Floyd–Warshall — so you know where to add capacity next.
            </p>
            <LinkButton to="/dashboard" variant="secondary">Open the operator dashboard</LinkButton>
          </div>
          <div className="mini-dash" aria-hidden="true">
            <div>Andheri Hub — 6/8 ports busy</div>
            <div className="bar"><span style={{ width: '75%' }} /></div>
            <div>Queue depth — 4 waiting</div>
            <div className="bar"><span style={{ width: '40%' }} /></div>
            <div>Bandra Fast Charge — 3/6 ports busy</div>
            <div className="bar"><span style={{ width: '50%' }} /></div>
          </div>
        </div>
      </section>

      <section className="section home-section">
        <div className="container">
          <div className="section-title">
            <span className="eyebrow">under the hood</span>
            <h2>Every structure earns its place</h2>
            <p className="muted">Hand-written, no libraries — each one powers a feature you can touch.</p>
          </div>
          <div className="grid cols-4">
            {DS.map((d) => (
              <Card key={d.name} title={d.name} to="/data-structures">
                <span className={`badge ${d.status === 'shipped' ? 'badge-ok' : 'badge-warn'}`}>{d.status}</span>
                <p className="ds-card">{d.use}</p>
              </Card>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <LinkButton to="/data-structures" variant="ghost">Read the full breakdown</LinkButton>
          </p>
        </div>
      </section>

      <section className="stats section" aria-label="Project stats">
        <div className="container stats-grid">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="stat-num">{s.n}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
