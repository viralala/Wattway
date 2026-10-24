/**
 * WattWay · Team Kothimbir 🌿
 * useStations.ts — the live station list for a page, plus whether it is the
 * offline sample set. Shares one cached request across pages.
 */
import { useEffect, useState } from 'react';
import { loadStations, type Station } from '../services/stations';

export interface UseStations {
  stations: Station[] | null;
  /** True when the API was unreachable and `stations` is the built-in sample. */
  offline: boolean;
  error: string | null;
}

export function useStations(): UseStations {
  const [state, setState] = useState<UseStations>({ stations: null, offline: false, error: null });
  useEffect(() => {
    let live = true;
    loadStations().then(
      (r) => live && setState({ stations: r.stations, offline: r.offline, error: null }),
      (e: Error) => live && setState({ stations: [], offline: false, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
