/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * demo.ts — one command to show the dashboard with the real backend.
 *
 *   npm run demo
 *
 * Uses DATABASE_URL when it points at a real database; otherwise starts a
 * throwaway in-memory Postgres (PGlite, the same one the tests use), loads the
 * schema, seeds it, and boots the normal server. Nothing is written to disk.
 * ---------------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';

async function main(): Promise<void> {
  process.env.JWT_ACCESS_SECRET ??= 'demo-access-secret-not-for-production-0000000000';
  process.env.JWT_REFRESH_SECRET ??= 'demo-refresh-secret-not-for-production-000000000';

  // A live demo refreshes and clicks a lot; the production default (300 / 15 min) is too tight.
  process.env.RATE_LIMIT_MAX ??= '5000';

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'pglite://in-memory';
    const { PGlite } = await import('@electric-sql/pglite');
    const { citext } = await import('@electric-sql/pglite/contrib/citext');
    const { useDatabase } = await import('../src/config/db');
    const pg = new PGlite({ extensions: { citext } });
    await pg.exec(fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8'));
    useDatabase({
      query: (text, params) => pg.query(text, params) as never,
      tx: (fn) => pg.transaction((tx) => fn(tx as never)),
      close: () => pg.close(),
    });
    // eslint-disable-next-line no-console
    console.log('In-memory Postgres (PGlite) started');
  }

  const { connectDatabase } = await import('../src/config/db');
  const { seed } = await import('./seed');
  await connectDatabase();
  await seed({ disconnect: false });

  await import('../src/server');
  // eslint-disable-next-line no-console
  console.log('\nDashboard → http://localhost:' + (process.env.PORT ?? '4000') + '/live/\n');
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
