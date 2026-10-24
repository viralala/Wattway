/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * api/index.ts — the Express server as one Vercel serverless function.
 *
 * vercel.json rewrites every /api/* request here, so the client and the API
 * share one origin and need no CORS. With MONGO_URI set, the first request
 * connects to MongoDB and builds the station index; without it the function
 * runs like `npm run dev:lab` — the Algorithm Lab works, database routes fail.
 * Socket.IO needs a long-lived server, so realtime events are not served here.
 * ---------------------------------------------------------------------------
 */

import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';

// The server is CommonJS, compiled by its own tsconfig into server/dist during
// the install step (see vercel.json); load it with require, not import.
const require = createRequire(import.meta.url);

const hasDatabase = Boolean(process.env.MONGO_URI);
if (!hasDatabase) {
  process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/wattway-lab-unused';
  process.env.JWT_ACCESS_SECRET ??= 'lab-only-access-secret-not-for-real-use-0000';
  process.env.JWT_REFRESH_SECRET ??= 'lab-only-refresh-secret-not-for-real-use-111';
}
process.env.INDEX_REFRESH_MS ??= '0'; // no background timers in a serverless function

let ready: Promise<(req: IncomingMessage, res: ServerResponse) => void> | null = null;

async function boot(): Promise<(req: IncomingMessage, res: ServerResponse) => void> {
  const { app } = require('../../server/dist/app.js');
  if (hasDatabase) {
    const { connectDatabase } = require('../../server/dist/config/db.js');
    const { stationIndex } = require('../../server/dist/services/stationIndex.js');
    await connectDatabase();
    await stationIndex.start();
  }
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  ready ??= boot().catch((error: unknown) => {
    ready = null; // let the next request retry a failed connection
    throw error;
  });
  const app = await ready;
  app(req, res);
}
