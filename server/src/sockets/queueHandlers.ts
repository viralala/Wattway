/**
 * ============================================================================
 *  WattWay - EV Charging Station: Route & Queue Optimizer
 *  Team Kothimbir 🌿  ·  Module: Queue & Realtime  ·  Owner: Shreenath
 * ============================================================================
 *
 *  queueHandlers.ts - the queue's realtime events.
 *
 *  PRD Section 11: "Queue-length updates should reach connected clients within
 *  2 seconds of a change (WebSocket push, not polling)." Every queue mutation
 *  pushes immediately - there is no timer anywhere in this file.
 *
 *  INBOUND (client -> server)
 *  --------------------------
 *    queue:watch     (stationId, ack?)  join the station room; ack gets a snapshot
 *    queue:unwatch   (stationId)        leave it
 *    queue:position  (stationId, ack)   your own place (signed-in sockets only)
 *
 *  Joining and leaving the line stay on REST (`POST /join`, `DELETE /leave`):
 *  they need validation, auth errors and status codes, which REST gives us for
 *  free. The socket is the push channel.
 *
 *  OUTBOUND (server -> client)
 *  ---------------------------
 *    queue:updated   -> room station:<id>   public snapshot (no user ids)
 *    ports:updated   -> room station:<id>   the port board after a change
 *    queue:position  -> room user:<id>      that driver's own place / status
 *
 *  Called from `registerHandlers()` in sockets/index.ts - the transport file
 *  stays transport-only.
 * ============================================================================
 */

import { emitToStation, emitToUser, getSocketServer, rooms, type WattWaySocket } from './index';
import { queueService, type QueueChange } from '../services/queueService';
import { isApiError } from '../utils/ApiError';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

type Ack = (response: { ok: true; data: unknown } | { ok: false; error: string }) => void;

const asAck = (value: unknown): Ack | null => (typeof value === 'function' ? (value as Ack) : null);

function failure(error: unknown): string {
  return isApiError(error) ? error.message : 'Something went wrong';
}

export function registerQueueHandlers(socket: WattWaySocket): void {
  socket.on('queue:watch', async (stationId: unknown, maybeAck?: unknown) => {
    const ack = asAck(maybeAck);
    if (typeof stationId !== 'string' || !OBJECT_ID.test(stationId)) {
      ack?.({ ok: false, error: 'stationId must be a 24-character id' });
      return;
    }
    await socket.join(rooms.station(stationId));
    if (!ack) return;
    try {
      ack({ ok: true, data: await queueService.snapshot(stationId, socket.user?.id) });
    } catch (error) {
      ack({ ok: false, error: failure(error) });
    }
  });

  socket.on('queue:unwatch', async (stationId: unknown) => {
    if (typeof stationId === 'string') await socket.leave(rooms.station(stationId));
  });

  socket.on('queue:position', async (stationId: unknown, maybeAck?: unknown) => {
    const ack = asAck(maybeAck);
    if (!ack) return;
    if (!socket.user) {
      ack({ ok: false, error: 'Sign in to see your position' });
      return;
    }
    if (typeof stationId !== 'string' || !OBJECT_ID.test(stationId)) {
      ack({ ok: false, error: 'stationId must be a 24-character id' });
      return;
    }
    try {
      ack({ ok: true, data: await queueService.position(stationId, socket.user.id) });
    } catch (error) {
      ack({ ok: false, error: failure(error) });
    }
  });
}

/**
 * Push one mutation to everyone who cares. A no-op when the socket server is
 * not running (integration tests, the database-free lab server).
 */
export function broadcastQueueChange(change: QueueChange): void {
  if (!getSocketServer()) return;
  emitToStation(change.stationId, 'queue:updated', change.snapshot);
  emitToStation(change.stationId, 'ports:updated', change.ports);
  for (const { userId, view } of change.personal) emitToUser(userId, 'queue:position', view);
}
