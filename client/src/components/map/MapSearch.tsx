/**
 * WattWay · Team Kothimbir 🌿
 * MapSearch.tsx — search box over a map. Submitting looks the text up with
 * Nominatim; each result offers the caller's actions (e.g. "Start here").
 */
import { useRef, useState, type FormEvent } from 'react';
import { searchPlaces, type GeoResult } from '../../services/geocode';

export interface SearchAction {
  label: string;
  onPick: (place: GeoResult) => void;
}

export function MapSearch({ actions, placeholder = 'Search a place in Pune…' }: { actions: SearchAction[]; placeholder?: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const inflight = useRef<AbortController | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setStatus('loading');
    try {
      setResults(await searchPlaces(query, controller.signal));
      setStatus('idle');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setStatus('error');
    }
  };

  const pick = (action: SearchAction, place: GeoResult) => {
    action.onPick(place);
    setResults(null);
    setQuery(place.label);
  };

  return (
    <div className="ww-search">
      <form role="search" onSubmit={submit}>
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Search for a place"
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={!query.trim() || status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>
      {status === 'error' && <p className="ww-search-msg">Place search is unavailable right now. Try again in a moment.</p>}
      {results && results.length === 0 && <p className="ww-search-msg">No places found for “{query}”.</p>}
      {results && results.length > 0 && (
        <ul className="ww-search-results">
          {results.map((r) => (
            <li key={r.id}>
              <span className="ww-search-name">
                <strong>{r.label}</strong>
                {r.detail && <small>{r.detail}</small>}
              </span>
              <span className="ww-search-actions">
                {actions.map((a) => (
                  <button key={a.label} type="button" className="btn btn-secondary btn-sm" onClick={() => pick(a, r)}>
                    {a.label}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
