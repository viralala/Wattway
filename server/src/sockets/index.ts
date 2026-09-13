/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿
 * ============================================================================
 *
 *  sockets/index.ts — Socket.IO bootstrap.
 *
 *  OWNERSHIP: the *transport* below (server creation, CORS, JWT handshake
 *  authentication, room joining) belongs to the Indexing & Backend module,
 *  because it is infrastructure every module shares.
 *
 *  The *events* belong to the Queue & Realtime module. This file deliberately
 *  registers none of them beyond a connection log — see `registerHandlers()`
 *  at the bottom, which is the hook to fill in.
 *
 *  PRD Section 11: "Queue-length updates should reach connected clients within
 *  2 seconds of a change (WebSocket push, not polling)."
 *
 *  AUTHENTICATION ON THE HANDSHAKE
 *  -------------------------------
 *  A socket is authenticated once, when it connects, using the same access
 *  token the REST API uses. The client sends it as `auth.token`. Unlike HTTP,
 *  a socket is long-lived, so this check happens once and the identity is
 *  pinned to the connection for its lifetime.
 *
 *  Anonymous sockets are allowed — a signed-out visitor still watches live
 *  queue lengths on the map. They simply do not get a user room, so nothing
 *  addressed to a specific driver can reach them.
 * ============================================================================
 */

import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { verifyAccessToken } from '../services/tokenService';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { AuthUser } from '../types';

/** Socket.IO's socket, plus whatever the handshake resolved. */
export interface WattWaySocket extends Socket {
  user?: AuthUser;
}

/** Room naming, centralised so two modules cannot disagree on a string. */
export const rooms = {
  /** Everyone watching one station's live queue and port board. */
  station: (stationId: string): string => `station:${stationId}`,
  /** One signed-in driver, across all their open tabs. */
  user: (userId: string): string => `user:${userId}`,
  /** Operators watching their own station's dashboard. */
  operators: (stationId: string): string => `operators:${stationId}`,
};

let io: SocketServer | null = null;

export function createSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.corsOrigins,
      credentials: true,
    },
    // Long enough to survive a phone switching from wifi to mobile data, which
    // is a normal event for a driver, not a disconnect.
    pingTimeout: 30_000,
  });

  // Handshake auth. Never throw for a missing token — reject only a bad one.
  io.use((socket: WattWaySocket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next();
      return;
    }
    try {
      const claims = verifyAccessToken(token);
      socket.user = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        name: claims.name,
        tokenVersion: claims.tv,
      };
      next();
    } catch {
      next(new Error('Socket authentication failed: token is invalid or expired'));
    }
  });

  io.on('connection', (socket: WattWaySocket) => {
    if (socket.user) socket.join(rooms.user(socket.user.id));

    logger.debug(
      `Socket connected: ${socket.id}${socket.user ? ` (${socket.user.email})` : ' (anonymous)'}`,
    );

    // Watching a station is open to anyone — it is public map data.
    socket.on('station:watch', (stationId: unknown) => {
      if (typeof stationId === 'string' && stationId.length === 24) {
        socket.join(rooms.station(stationId));
      }
    });

    socket.on('station:unwatch', (stationId: unknown) => {
      if (typeof stationId === 'string') socket.leave(rooms.station(stationId));
    });

    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${socket.id} (${reason})`);
    });

    registerHandlers(socket);
  });

  logger.info('Socket.IO ready');
  return io;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  QUEUE & REALTIME MODULE — YOUR HOOK IS HERE                             │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │  Register your per-socket listeners in this function, or better, import  │
 * │  a `registerQueueHandlers(socket)` from `sockets/queueHandlers.ts` and   │
 * │  call it from here, so this file stays transport-only.                   │
 * │                                                                          │
 * │  Suggested event names (agree them with the client before you build):    │
 * │    inbound   queue:join { stationId }                                    │
 * │              queue:leave { stationId }                                   │
 * │    outbound  queue:updated { stationId, length, positions }              │
 * │              ports:updated { stationId, freePorts, ports }               │
 * │                                                                          │
 * │  Use `emitToStation()` below rather than reaching for `io` yourself.     │
 * │  And when a port or queue length changes, remember to call               │
 * │  `stationIndex.upsert()` too — the recommendation score reads both.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function registerHandlers(_socket: WattWaySocket): void {
  // Intentionally empty — see the box above.
}

/** Broadcast to everyone watching a station. Safe to call before init. */
export function emitToStation(stationId: string, event: string, payload: unknown): void {
  if (!io) {
    logger.warn(`emitToStation('${event}') called before the socket server was created`);
    return;
  }
  io.to(rooms.station(stationId)).emit(event, payload);
}

/** Broadcast to one user's open tabs. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!io) {
    logger.warn(`emitToUser('${event}') called before the socket server was created`);
    return;
  }
  io.to(rooms.user(userId)).emit(event, payload);
}

export function getSocketServer(): SocketServer | null {
  return io;
}

export async function closeSocketServer(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
}
