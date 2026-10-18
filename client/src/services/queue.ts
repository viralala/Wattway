/**
 * WattWay · Team Kothimbir 🌿
 * queue.ts — virtual queue data for the queue page.
 *
 * HARDCODED for now: the queue belongs to the Queue & Realtime module. When it
 * lands, swap these in:
 *
 *   getQueueSnapshot → request<QueueSnapshot>(`/api/queue/${stationId}`)
 *   join             → request(`/api/queue/${stationId}/join`, { method: 'POST' })
 *   leave            → request(`/api/queue/${stationId}/leave`, { method: 'DELETE' })
 *   live updates     → the Socket.IO room for the station
 *
 * Until then the page replays a labelled simulation (utils/queueSim.ts) that
 * starts from this snapshot.
 */
import { getStation, type Station } from './stations';

export interface QueueSnapshot {
  station: Station;
  /** Drivers ahead of a newcomer, front first. */
  waiting: number;
}

export async function getQueueSnapshot(stationId: string): Promise<QueueSnapshot | null> {
  const station = await getStation(stationId);
  return station ? { station, waiting: station.queueLength } : null;
}
