/**
 * WattWay · Team Kothimbir 🌿
 * queue.ts — the virtual queue, from the live API.
 *
 *   GET    /api/queue/:stationId        → fetchLiveQueue   (public; personalised when signed in)
 *   POST   /api/queue/:stationId/join   → joinQueue        (signed in)
 *   DELETE /api/queue/:stationId/leave  → leaveQueue       (signed in)
 *
 * There are no sockets on the Vercel deployment, so the page polls. The
 * labelled simulation in utils/queueSim.ts remains as the offline fallback;
 * `getQueueSnapshot` is what seeds it.
 */
import { json, request } from './api';
import { getStation, type Station } from './stations';

export interface YouView {
  status: 'waiting' | 'charging';
  position?: number;
  carsAhead?: number;
  estimatedWaitMinutes?: number | null;
  urgent?: boolean;
  portIndex?: number;
}

export interface LiveQueue {
  stationId: string;
  stationName: string;
  totalPorts: number;
  freePorts: number;
  usablePorts: number;
  queueLength: number;
  charging: { portIndex: number; startedAt: string | null; expectedRemainingMinutes: number; you: boolean }[];
  waiting: { position: number; joinedAt: string; estimatedWaitMinutes: number | null; urgent: boolean; you: boolean }[];
  middle: { position: number; estimatedWaitMinutes: number | null } | null;
  you: YouView | null;
  updatedAt: string;
}

export interface JoinOptions {
  batteryPct?: number;
  emergency?: boolean;
  expectedChargeMinutes?: number;
}

/** Fill in anything the server left out so the UI can map over it safely. */
export function normaliseQueue(raw: Partial<LiveQueue> | null | undefined): LiveQueue {
  const q = raw ?? {};
  return {
    stationId: q.stationId ?? '',
    stationName: q.stationName ?? '',
    totalPorts: q.totalPorts ?? 0,
    freePorts: q.freePorts ?? 0,
    usablePorts: q.usablePorts ?? q.totalPorts ?? 0,
    queueLength: q.queueLength ?? q.waiting?.length ?? 0,
    charging: q.charging ?? [],
    waiting: q.waiting ?? [],
    middle: q.middle ?? null,
    you: q.you ?? null,
    updatedAt: q.updatedAt ?? new Date().toISOString(),
  };
}

const path = (stationId: string) => `/api/queue/${encodeURIComponent(stationId)}`;

export async function fetchLiveQueue(stationId: string): Promise<LiveQueue> {
  const data = await request<{ queue: Partial<LiveQueue> }>(path(stationId));
  return normaliseQueue(data.queue);
}

export async function joinQueue(stationId: string, options: JoinOptions = {}): Promise<LiveQueue> {
  const data = await request<{ queue: Partial<LiveQueue> }>(`${path(stationId)}/join`, json('POST', options));
  return normaliseQueue(data.queue);
}

export async function leaveQueue(stationId: string): Promise<LiveQueue> {
  const data = await request<{ queue: Partial<LiveQueue> }>(`${path(stationId)}/leave`, json('DELETE'));
  return normaliseQueue(data.queue);
}

// ─── Offline simulation seed ────────────────────────────────────────────────

export interface QueueSnapshot {
  station: Station;
  /** Drivers ahead of a newcomer, front first. */
  waiting: number;
}

export async function getQueueSnapshot(stationId: string): Promise<QueueSnapshot | null> {
  const station = await getStation(stationId);
  return station ? { station, waiting: station.queueLength } : null;
}
