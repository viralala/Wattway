/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * demo.ts — one command to show the dashboard with the real backend.
 *
 *   npm run demo
 *
 * Uses MONGO_URI when it points at a real database; otherwise starts a
 * throwaway in-memory MongoDB (the same one the tests use), seeds it, and boots
 * the normal server. Nothing is written outside the temp directory.
 * ---------------------------------------------------------------------------
 */

import { MongoMemoryServer } from 'mongodb-memory-server';

async function main(): Promise<void> {
  process.env.JWT_ACCESS_SECRET ??= 'demo-access-secret-not-for-production-0000000000';
  process.env.JWT_REFRESH_SECRET ??= 'demo-refresh-secret-not-for-production-000000000';

  // A live demo refreshes and clicks a lot; the production default (300 / 15 min) is too tight.
  process.env.RATE_LIMIT_MAX ??= '5000';

  if (!process.env.MONGO_URI) {
    const mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri('wattway-demo');
    // eslint-disable-next-line no-console
    console.log(`In-memory MongoDB started: ${process.env.MONGO_URI}`);
    const stop = (): void => {
      void mongod.stop().finally(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }

  const { connectDatabase } = await import('../src/config/db');
  const { seed } = await import('./seed');
  await connectDatabase();
  await seed({ disconnect: false });

  await import('../src/server');
  // eslint-disable-next-line no-console
  console.log('\nDashboard → http://localhost:' + (process.env.PORT ?? '4000') + '/dashboard/\n');
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
