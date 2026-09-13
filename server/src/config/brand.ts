/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * brand.ts — the single source of truth for who built this.
 *
 * Imported by the boot banner, the `X-Powered-By` header, `GET /api/meta` and
 * the OpenAPI-ish service descriptor. Change it here, it changes everywhere.
 * ---------------------------------------------------------------------------
 */

export const BRAND = Object.freeze({
  product: 'WattWay',
  tagline: 'EV Charging Station: Route & Queue Optimizer',
  team: 'Team Kothimbir 🌿',
  teamSlug: 'team-kothimbir',
  emoji: '🌿',
  repository: 'https://github.com/viralala/wattway',
  /**
   * HTTP header values must be latin-1 (RFC 7230), so anything that ends up in
   * a header has to stay ASCII. The emoji lives in JSON bodies and the boot
   * banner, which are UTF-8 and can carry it safely.
   */
  poweredBy: 'WattWay - Team Kothimbir',
  teamAscii: 'Team Kothimbir',
  modules: Object.freeze([
    Object.freeze({
      name: 'Indexing & Backend',
      owner: 'Viral',
      dataStructures: ['Tree (BST)', 'Trie'],
      summary:
        'Price/rating range index, search autocomplete, Express API, database models and JWT auth.',
      status: 'shipped',
    }),
    Object.freeze({
      name: 'Routing & Pathfinding',
      owner: 'unassigned',
      dataStructures: ['Graph', 'Heap (Min-Heap)'],
      summary: 'Battery-aware Dijkstra, top-N station ranking.',
      status: 'pending',
    }),
    Object.freeze({
      name: 'Queue & Realtime',
      owner: 'unassigned',
      dataStructures: ['Queue', 'Linked List'],
      summary: 'Per-station virtual waiting line, Socket.IO fan-out, operator dashboard.',
      status: 'pending',
    }),
    Object.freeze({
      name: 'Client',
      owner: 'unassigned',
      dataStructures: ['Stack', 'Array'],
      summary: 'React map view, search box, route planner, undo-last-search.',
      status: 'pending',
    }),
  ]),
});

/** Printed once at boot. Cosmetic, and worth it. */
export function banner(port: number, env: string): string {
  const line = '─'.repeat(62);
  return [
    '',
    `┌${line}┐`,
    `│  ${BRAND.emoji}  ${BRAND.product} API  —  ${BRAND.tagline.padEnd(38)}│`,
    `│     built by ${BRAND.team.padEnd(47)}│`,
    `├${line}┤`,
    `│     env    ${env.padEnd(49)}│`,
    `│     port   ${String(port).padEnd(49)}│`,
    `│     docs   GET /api/meta${' '.repeat(36)}│`,
    `└${line}┘`,
    '',
  ].join('\n');
}

export default BRAND;
