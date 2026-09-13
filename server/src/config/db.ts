/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * db.ts — MongoDB connection lifecycle.
 *
 * Integration tests swap MONGO_URI for an in-memory server (see
 * tests/helpers/db.ts), so nothing here may assume a real cluster.
 * ---------------------------------------------------------------------------
 */

import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

mongoose.set('strictQuery', true);

let connecting: Promise<typeof mongoose> | null = null;

/** Connect once; concurrent callers share the same in-flight promise. */
export async function connectDatabase(uri: string = env.MONGO_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (connecting) return connecting;

  connecting = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      autoIndex: !env.isProduction, // in production, build indexes deliberately
    })
    .then((instance) => {
      logger.info(`MongoDB connected → ${redact(uri)}`);
      return instance;
    })
    .catch((error: unknown) => {
      connecting = null;
      throw error;
    });

  return connecting;
}

export async function disconnectDatabase(): Promise<void> {
  connecting = null;
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}

export type DatabaseState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

export function databaseState(): DatabaseState {
  // mongoose exposes readyState as a plain number, so map it explicitly
  // rather than indexing a tuple TypeScript cannot prove is in range.
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'disconnected';
  }
}

/** Never log credentials, even in development. */
function redact(uri: string): string {
  return uri.replace(/\/\/([^:@/]+):([^@]+)@/, '//$1:***@');
}

export default connectDatabase;
