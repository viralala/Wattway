/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * lab-server.ts — serve the Express app WITHOUT a database, for the Algorithm Lab.
 *
 * The Lab endpoints (/api/algorithms/*) are pure computation, so a demo of the
 * Lab shouldn't need a database. This script fills in placeholder env values,
 * skips connectDatabase(), and listens. Every database-backed route (stations,
 * auth, …) will fail here — use `npm run dev` with DATABASE_URL for those.
 *
 *   npm run dev:lab      → http://localhost:4000/api/algorithms/graph
 * ---------------------------------------------------------------------------
 */

process.env.DATABASE_URL ??= 'postgres://lab-mode-unused';
process.env.JWT_ACCESS_SECRET ??= 'lab-only-access-secret-not-for-real-use-0000';
process.env.JWT_REFRESH_SECRET ??= 'lab-only-refresh-secret-not-for-real-use-111';
process.env.CORS_ORIGIN ??= 'http://localhost:5273';

async function main(): Promise<void> {
  const { app } = await import('../src/app');
  const { env } = await import('../src/config/env');
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`WattWay Algorithm Lab (no database) → http://localhost:${env.PORT}/api/algorithms/graph`);
  });
}

void main();
