/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * db.ts — the Postgres connection (Supabase in production).
 *
 * Everything above this file talks to `db.query` / `db.tx` and never to a
 * driver directly, so the integration tests can swap in an in-memory Postgres
 * (PGlite, see tests/helpers/db.ts) and run the very same SQL.
 *
 * Production connects through Supabase's transaction pooler (port 6543), which
 * suits serverless: each function instance holds at most a couple of short
 * connections and the pooler multiplexes them.
 * ---------------------------------------------------------------------------
 */

import { Pool, types } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

// BIGINT counts (count(*)) arrive as strings by default; they always fit a JS number here.
types.setTypeParser(20, (value) => Number(value));
// NUMERIC (prices, ratings) likewise.
types.setTypeParser(1700, (value) => Number(value));

export interface QueryResult<T> {
  rows: T[];
}

/** The one capability the data layer needs: run a parameterised statement. */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

/** A database the app can use: queries plus transactions. */
export interface Database extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let current: Database | null = null;

function poolDatabase(url: string): Database {
  const pool = new Pool({
    connectionString: url,
    max: env.isProduction ? 3 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Supabase requires TLS; local Postgres usually has none.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  pool.on('error', (error) => logger.error('Postgres pool error', error));

  return {
    query: (text, params) => pool.query(text, params) as never,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client as unknown as Queryable);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Connect once; later calls reuse the same pool. */
export async function connectDatabase(url: string = env.DATABASE_URL): Promise<Database> {
  if (current) return current;
  const database = poolDatabase(url);
  await database.query('select 1');
  current = database;
  logger.info(`Postgres connected → ${redact(url)}`);
  return database;
}

/** Tests install their own database (PGlite) here. */
export function useDatabase(database: Database | null): void {
  current = database;
}

export async function disconnectDatabase(): Promise<void> {
  const database = current;
  current = null;
  if (database) {
    await database.close();
    logger.info('Postgres disconnected');
  }
}

function active(): Database {
  if (!current) throw new Error('Database not connected — call connectDatabase() first');
  return current;
}

/** The handle the repositories use. */
export const db: Database = {
  query: (text, params) => active().query(text, params),
  tx: (fn) => active().tx(fn),
  close: () => disconnectDatabase(),
};

export type DatabaseState = 'disconnected' | 'connected';

export function databaseState(): DatabaseState {
  return current ? 'connected' : 'disconnected';
}

/** Never log credentials, even in development. */
function redact(url: string): string {
  return url.replace(/\/\/([^:@/]+):([^@]+)@/, '//$1:***@');
}

export default connectDatabase;
