/**
 * WattWay · Team Kothimbir 🌿
 * Layout.tsx — nav, footer and the page shell shared by every route.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import mapBg from '../assets/images/map-bg.png';
import { useAuth } from '../context/AuthContext';
import '../styles/account.css';

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/stations', label: 'Station map' },
  { to: '/route', label: 'Route planner' },
  { to: '/queue', label: 'Virtual queue' },
  { to: '/dashboard', label: 'Operators' },
  { to: '/lab', label: 'Algorithm lab' },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { user } = useAuth();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <nav className="nav" aria-label="Main">
      <div className="container nav-inner">
        <NavLink to="/" className="nav-brand" aria-label="WattWay home">
          <span className="script" aria-hidden="true">
            W
          </span>
          ATTWAY
        </NavLink>
        <button
          className="btn btn-secondary btn-sm nav-toggle"
          aria-expanded={open}
          aria-controls="nav-links"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Close' : 'Menu'}
        </button>
        <ul id="nav-links" className={`nav-links${open ? ' open' : ''}`}>
          {LINKS.map((l) => (
            <li key={l.to}>
              {/* `end`: without it "/" counts as active on every page */}
              <NavLink to={l.to} end={l.to === '/'}>
                {l.label}
              </NavLink>
            </li>
          ))}
          <li className="nav-account">
            <NavLink to="/account" className={user ? undefined : 'nav-signin'}>
              {user ? user.name.split(' ')[0] || 'Account' : 'Sign in'}
            </NavLink>
          </li>
        </ul>
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">WattWay</div>
    </footer>
  );
}

/** Inner-page shell: faded map backdrop, content on a readable panel. */
export function Layout({ backdrop = true }: { backdrop?: boolean }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main
        id="main"
        tabIndex={-1}
        className={backdrop ? 'page-backdrop' : undefined}
        style={{ ['--map-bg' as string]: `url(${mapBg})` }}
      >
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
