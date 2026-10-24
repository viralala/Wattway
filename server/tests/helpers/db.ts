/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * db.ts — an in-memory Postgres for the integration tests.
 *
 * PGlite is real Postgres compiled to WebAssembly, running inside the Jest
 * process: the tests exercise genuine constraints, genuine unique indexes and
 * the exact SQL production runs, with no server to install and nothing
 * touching a developer's actual database. The schema is db/schema.sql, the
 * same DDL as the Supabase migration.
 * ---------------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { useDatabase, type Database, type Queryable } from '../../src/config/db';

let pg: PGlite | null = null;

const SCHEMA = fs.readFileSync(path.resolve(__dirname, '../../db/schema.sql'), 'utf8');

const TABLES = ['queue_entries', 'trips', 'station_ratings', 'station_operators', 'stations', 'users'];

/** Boot PGlite, load the schema, and make it the app's database. */
export async function startTestDatabase(): Promise<Database> {
  pg = new PGlite({ extensions: { citext } });
  await pg.exec(SCHEMA);
  const instance = pg;

  const database: Database = {
    query: (text, params) => instance.query(text, params) as never,
    // PGlite runs on one connection, so a transaction simply holds it.
    tx: (fn) => instance.transaction((tx) => fn(tx as unknown as Queryable)),
    close: async () => undefined,
  };
  useDatabase(database);
  return database;
}

/** Wipe every table between tests, keeping the schema. */
export async function clearTestDatabase(): Promise<void> {
  if (pg) await pg.exec(`truncate ${TABLES.join(', ')} cascade`);
}

export async function stopTestDatabase(): Promise<void> {
  useDatabase(null);
  if (pg) {
    await pg.close();
    pg = null;
  }
}

/** Kept for callers from the MongoDB era: constraints exist as soon as the schema loads. */
export async function syncIndexes(): Promise<void> {
  return undefined;
}
