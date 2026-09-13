/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Indexing & Backend
 * ============================================================================
 *
 *  server.ts — process entry point.
 *
 *  Boot order is deliberate:
 *
 *    1. connect to MongoDB       — nothing below works without it
 *    2. build the station index  — BSTs + trie, from the database
 *    3. start listening          — only once we can actually serve a request
 *    4. attach Socket.IO         — shares the same HTTP server
 *
 *  Binding the port last means a health check never sees a server that is up
 *  but cannot answer a search, which is the failure mode that makes a deploy
 *  look healthy while every request 503s.
 * ============================================================================
 */

import http from 'node:http';
import { app } from './app';
import { env } from './config/env';
import { banner } from './config/brand';
import { connectDatabase, disconnectDatabase } from './config/db';
import { stationIndex } from './services/stationIndex';
import { createSocketServer, closeSocketServer } from './sockets';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  await connectDatabase();

  // Blocking on the first build is intentional — see the file header.
  await stationIndex.start();

  const server = http.createServer(app);
  createSocketServer(server);

  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(banner(env.PORT, env.NODE_ENV));
    logger.info(`Listening on http://localhost:${env.PORT}`);
    logger.info(`Station index holds ${stationIndex.size} stations`);
  });

  registerShutdownHandlers(server);
}

/**
 * Graceful shutdown. Render and Railway send SIGTERM on redeploy; without
 * this, in-flight requests are cut off mid-response and Mongo connections are
 * left for the server to time out.
 */
function registerShutdownHandlers(server: http.Server): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down gracefully`);

    stationIndex.stop();

    // Force an exit if something refuses to let go.
    const killTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 10s — forcing exit');
      process.exit(1);
    }, 10_000);
    killTimer.unref();

    try {
      await closeSocketServer();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await disconnectDatabase();
      logger.info('Shutdown complete 🌿');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A rejection nobody handled has left the process in an unknown state.
  // Log loudly and let the platform restart us rather than limp along.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    void shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  logger.error('Failed to start the WattWay server', error);
  process.exit(1);
});
