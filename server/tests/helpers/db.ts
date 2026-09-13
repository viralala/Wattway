/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * db.ts — an in-memory MongoDB for the integration tests.
 *
 * `mongodb-memory-server` spins up a real mongod against a temp directory, so
 * the tests exercise genuine indexes, genuine unique constraints and genuine
 * validation — none of which a mocked Mongoose would catch. Nothing touches a
 * developer's actual database.
 *
 * NOTE: the first run downloads a mongod binary (~100 MB) and caches it. If
 * you are offline, integration tests will fail to start while the unit tests
 * for the data structures keep working — that separation is deliberate, and it
 * is why PRD Section 11 asks for the structures to be testable on their own.
 * ---------------------------------------------------------------------------
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let server: MongoMemoryServer | null = null;

/** Boot the in-memory server and connect Mongoose to it. */
export async function startTestDatabase(): Promise<string> {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  await mongoose.connect(uri);
  return uri;
}

/** Wipe every collection between tests, keeping indexes intact. */
export async function clearTestDatabase(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
}

export async function stopTestDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
  if (server) {
    await server.stop();
    server = null;
  }
}

/**
 * Mongoose builds indexes lazily. The unique constraints matter to these tests
 * (duplicate email, duplicate station name), so force them to exist first.
 */
export async function syncIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
}
