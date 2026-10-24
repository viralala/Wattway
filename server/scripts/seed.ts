/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿
 * ============================================================================
 *
 *  seed.ts — a demo dataset.
 *
 *  Run with:  npm run seed          (adds anything missing)
 *             npm run seed -- --fresh   (wipes stations and users first)
 *
 *  PRD Section 12, Week 1-2: "graph data model and sample station dataset
 *  prepared."
 *
 *  The data is deliberately spread across four cities and a wide price band, so
 *  that a range query returns something interesting and the BST has more than a
 *  handful of distinct keys to build over. Ratings are varied on purpose too —
 *  a dataset where every station is 4.5 stars makes the rating index look
 *  pointless in a demo.
 *
 *  Coordinates are approximate real locations; prices are plausible Indian
 *  tariffs in rupees per kWh, not scraped from any operator.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, db, disconnectDatabase } from '../src/config/db';
import { Stations, type StationInput } from '../src/models/Station';
import { Users } from '../src/models/User';
import type { OsmStation } from './import-osm';
import { logger } from '../src/utils/logger';
import { BRAND } from '../src/config/brand';
import type { ConnectorType, PortStatus } from '../src/types';

interface SeedStation {
  name: string;
  operator: string;
  locality: string;
  city: string;
  state: string;
  line1: string;
  pincode: string;
  lat: number;
  lng: number;
  pricePerKwh: number;
  rating: number;
  ratingCount: number;
  ports: Array<[ConnectorType, number, PortStatus]>;
  amenities: string[];
  queueLength: number;
}

const STATIONS: SeedStation[] = [
  // ── Mumbai ────────────────────────────────────────────────────────────────
  {
    name: 'Andheri Metro Charge Hub',
    operator: 'Tata Power',
    locality: 'Andheri East',
    city: 'Mumbai',
    state: 'Maharashtra',
    line1: 'Chakala Junction, Andheri-Kurla Road',
    pincode: '400059',
    lat: 19.1136,
    lng: 72.8697,
    pricePerKwh: 14.5,
    rating: 4.6,
    ratingCount: 212,
    ports: [
      ['CCS2', 60, 'occupied'],
      ['CCS2', 60, 'free'],
      ['Type2', 22, 'free'],
      ['CHAdeMO', 50, 'faulted'],
    ],
    amenities: ['restroom', 'cafe', 'parking'],
    queueLength: 2,
  },
  {
    name: 'Bandra Kurla Complex Fast Charge',
    operator: 'ChargeZone',
    locality: 'Bandra Kurla Complex',
    city: 'Mumbai',
    state: 'Maharashtra',
    line1: 'G Block, BKC',
    pincode: '400051',
    lat: 19.0662,
    lng: 72.8692,
    pricePerKwh: 18.0,
    rating: 4.8,
    ratingCount: 340,
    ports: [
      ['CCS2', 120, 'free'],
      ['CCS2', 120, 'occupied'],
      ['Type2', 22, 'free'],
    ],
    amenities: ['restroom', 'cafe', 'wifi', 'lounge'],
    queueLength: 0,
  },
  {
    name: 'Powai Lakeside Charging Point',
    operator: 'Statiq',
    locality: 'Powai',
    city: 'Mumbai',
    state: 'Maharashtra',
    line1: 'Hiranandani Gardens, Central Avenue',
    pincode: '400076',
    lat: 19.1197,
    lng: 72.9051,
    pricePerKwh: 11.75,
    rating: 4.1,
    ratingCount: 88,
    ports: [
      ['CCS2', 60, 'free'],
      ['Bharat-DC-001', 15, 'free'],
    ],
    amenities: ['parking'],
    queueLength: 0,
  },
  {
    name: 'Colaba Causeway EV Point',
    operator: 'Jio-bp pulse',
    locality: 'Colaba',
    city: 'Mumbai',
    state: 'Maharashtra',
    line1: 'Shahid Bhagat Singh Road',
    pincode: '400005',
    lat: 18.9067,
    lng: 72.8147,
    pricePerKwh: 16.25,
    rating: 3.7,
    ratingCount: 54,
    ports: [
      ['CCS2', 50, 'occupied'],
      ['Type2', 22, 'occupied'],
    ],
    amenities: ['restroom'],
    queueLength: 5,
  },
  {
    name: 'Dadar Station Rapid Charge',
    operator: 'Tata Power',
    locality: 'Dadar West',
    city: 'Mumbai',
    state: 'Maharashtra',
    line1: 'Senapati Bapat Marg',
    pincode: '400028',
    lat: 19.0176,
    lng: 72.8434,
    pricePerKwh: 14.5,
    rating: 4.0,
    ratingCount: 130,
    ports: [
      ['CCS2', 60, 'free'],
      ['CCS2', 60, 'free'],
      ['Bharat-AC-001', 10, 'free'],
    ],
    amenities: ['parking', 'restroom'],
    queueLength: 1,
  },
  {
    name: 'Worli Sea Face Supercharge',
    operator: 'ChargeZone',
    locality: 'Worli',
    city: 'Mumbai',
    state: 'Maharashtra',
    line1: 'Khan Abdul Gaffar Khan Road',
    pincode: '400030',
    lat: 19.0176,
    lng: 72.8156,
    pricePerKwh: 21.5,
    rating: 4.9,
    ratingCount: 410,
    ports: [
      ['CCS2', 180, 'free'],
      ['CCS2', 180, 'free'],
      ['CCS2', 180, 'occupied'],
      ['Type2', 22, 'free'],
    ],
    amenities: ['cafe', 'wifi', 'lounge', 'restroom'],
    queueLength: 0,
  },

  // ── Pune ──────────────────────────────────────────────────────────────────
  {
    name: 'Hinjewadi Phase 1 Charge Park',
    operator: 'Statiq',
    locality: 'Hinjewadi',
    city: 'Pune',
    state: 'Maharashtra',
    line1: 'Rajiv Gandhi Infotech Park',
    pincode: '411057',
    lat: 18.5913,
    lng: 73.7389,
    pricePerKwh: 9.5,
    rating: 4.3,
    ratingCount: 176,
    ports: [
      ['CCS2', 60, 'free'],
      ['CCS2', 60, 'free'],
      ['Type2', 22, 'occupied'],
    ],
    amenities: ['parking', 'cafe'],
    queueLength: 0,
  },
  {
    name: 'Koregaon Park EV Station',
    operator: 'Jio-bp pulse',
    locality: 'Koregaon Park',
    city: 'Pune',
    state: 'Maharashtra',
    line1: 'North Main Road, Lane 5',
    pincode: '411001',
    lat: 18.5362,
    lng: 73.8939,
    pricePerKwh: 12.0,
    rating: 4.4,
    ratingCount: 92,
    ports: [
      ['CCS2', 60, 'free'],
      ['CHAdeMO', 50, 'free'],
    ],
    amenities: ['restroom', 'cafe'],
    queueLength: 0,
  },
  {
    name: 'Shivajinagar Bus Depot Charge',
    operator: 'MSEDCL',
    locality: 'Shivajinagar',
    city: 'Pune',
    state: 'Maharashtra',
    line1: 'Jangli Maharaj Road',
    pincode: '411005',
    lat: 18.5308,
    lng: 73.8475,
    pricePerKwh: 8.25,
    rating: 3.2,
    ratingCount: 61,
    ports: [
      ['Bharat-DC-001', 15, 'free'],
      ['Bharat-AC-001', 10, 'free'],
      ['Bharat-AC-001', 10, 'faulted'],
    ],
    amenities: [],
    queueLength: 3,
  },
  {
    name: 'Baner Highway Charge Stop',
    operator: 'ChargeZone',
    locality: 'Baner',
    city: 'Pune',
    state: 'Maharashtra',
    line1: 'Mumbai-Bangalore Highway',
    pincode: '411045',
    lat: 18.5590,
    lng: 73.7868,
    pricePerKwh: 15.75,
    rating: 4.5,
    ratingCount: 203,
    ports: [
      ['CCS2', 120, 'free'],
      ['CCS2', 120, 'free'],
    ],
    amenities: ['cafe', 'restroom', 'parking'],
    queueLength: 1,
  },

  // ── Bengaluru ─────────────────────────────────────────────────────────────
  {
    name: 'Indiranagar 100ft Road Charger',
    operator: 'Ather Grid',
    locality: 'Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    line1: '100 Feet Road, HAL 2nd Stage',
    pincode: '560038',
    lat: 12.9784,
    lng: 77.6408,
    pricePerKwh: 13.0,
    rating: 4.7,
    ratingCount: 289,
    ports: [
      ['CCS2', 60, 'free'],
      ['Type2', 22, 'free'],
      ['Type2', 22, 'occupied'],
    ],
    amenities: ['cafe', 'wifi'],
    queueLength: 0,
  },
  {
    name: 'Whitefield Tech Park Charge Bay',
    operator: 'Statiq',
    locality: 'Whitefield',
    city: 'Bengaluru',
    state: 'Karnataka',
    line1: 'ITPL Main Road',
    pincode: '560066',
    lat: 12.9698,
    lng: 77.7500,
    pricePerKwh: 11.75,
    rating: 4.1,
    ratingCount: 154,
    ports: [
      ['CCS2', 60, 'occupied'],
      ['CCS2', 60, 'occupied'],
      ['CHAdeMO', 50, 'free'],
      ['Type2', 22, 'free'],
    ],
    amenities: ['parking', 'restroom'],
    queueLength: 4,
  },
  {
    name: 'Koramangala 5th Block EV Hub',
    operator: 'Tata Power',
    locality: 'Koramangala',
    city: 'Bengaluru',
    state: 'Karnataka',
    line1: '80 Feet Road, 5th Block',
    pincode: '560095',
    lat: 12.9352,
    lng: 77.6245,
    pricePerKwh: 14.5,
    rating: 4.2,
    ratingCount: 198,
    ports: [
      ['CCS2', 60, 'free'],
      ['Bharat-DC-001', 15, 'free'],
    ],
    amenities: ['cafe'],
    queueLength: 0,
  },
  {
    name: 'Electronic City Toll Charge',
    operator: 'Jio-bp pulse',
    locality: 'Electronic City',
    city: 'Bengaluru',
    state: 'Karnataka',
    line1: 'Hosur Road, Phase 1',
    pincode: '560100',
    lat: 12.8452,
    lng: 77.6602,
    pricePerKwh: 9.5,
    rating: 3.5,
    ratingCount: 77,
    ports: [
      ['CCS2', 50, 'free'],
      ['Type2', 22, 'faulted'],
    ],
    amenities: ['restroom'],
    queueLength: 2,
  },

  // ── Delhi NCR ─────────────────────────────────────────────────────────────
  {
    name: 'Connaught Place Inner Circle Charge',
    operator: 'BSES',
    locality: 'Connaught Place',
    city: 'New Delhi',
    state: 'Delhi',
    line1: 'Inner Circle, Block A',
    pincode: '110001',
    lat: 28.6315,
    lng: 77.2167,
    pricePerKwh: 10.5,
    rating: 3.9,
    ratingCount: 143,
    ports: [
      ['CCS2', 60, 'occupied'],
      ['Type2', 22, 'free'],
      ['Bharat-AC-001', 10, 'free'],
    ],
    amenities: ['parking', 'restroom'],
    queueLength: 1,
  },
  {
    name: 'Cyber Hub Gurugram Supercharge',
    operator: 'ChargeZone',
    locality: 'DLF Cyber City',
    city: 'Gurugram',
    state: 'Haryana',
    line1: 'Cyber Hub, DLF Phase 2',
    pincode: '122002',
    lat: 28.4949,
    lng: 77.0886,
    pricePerKwh: 19.0,
    rating: 4.8,
    ratingCount: 367,
    ports: [
      ['CCS2', 180, 'free'],
      ['CCS2', 180, 'occupied'],
      ['CCS2', 120, 'free'],
      ['Type2', 22, 'free'],
    ],
    amenities: ['cafe', 'wifi', 'lounge', 'restroom', 'parking'],
    queueLength: 0,
  },
  {
    name: 'Noida Sector 18 Metro Charge',
    operator: 'Statiq',
    locality: 'Sector 18',
    city: 'Noida',
    state: 'Uttar Pradesh',
    line1: 'Atta Market Road',
    pincode: '201301',
    lat: 28.5708,
    lng: 77.3260,
    pricePerKwh: 12.0,
    rating: 4.0,
    ratingCount: 121,
    ports: [
      ['CCS2', 60, 'free'],
      ['CHAdeMO', 50, 'free'],
      ['Type2', 22, 'occupied'],
    ],
    amenities: ['parking'],
    queueLength: 0,
  },
  {
    name: 'Dwarka Sector 21 Charge Point',
    operator: 'BSES',
    locality: 'Dwarka',
    city: 'New Delhi',
    state: 'Delhi',
    line1: 'Sector 21 Metro Station',
    pincode: '110075',
    lat: 28.5522,
    lng: 77.0583,
    pricePerKwh: 8.25,
    rating: 3.3,
    ratingCount: 45,
    ports: [
      ['Bharat-DC-001', 15, 'free'],
      ['Bharat-AC-001', 10, 'free'],
    ],
    amenities: [],
    queueLength: 0,
  },
  {
    name: 'Saket Select City Charge Deck',
    operator: 'Tata Power',
    locality: 'Saket',
    city: 'New Delhi',
    state: 'Delhi',
    line1: 'Press Enclave Marg',
    pincode: '110017',
    lat: 28.5285,
    lng: 77.2190,
    pricePerKwh: 16.25,
    rating: 4.4,
    ratingCount: 256,
    ports: [
      ['CCS2', 120, 'free'],
      ['CCS2', 60, 'occupied'],
      ['Type2', 22, 'free'],
    ],
    amenities: ['cafe', 'restroom', 'parking'],
    queueLength: 1,
  },
];

const USERS = [
  {
    name: 'WattWay Admin',
    email: 'admin@wattway.dev',
    password: 'kothimbir123',
    role: 'admin' as const,
  },
  {
    name: 'Operator Kothimbir',
    email: 'operator@wattway.dev',
    password: 'kothimbir123',
    role: 'operator' as const,
  },
  {
    name: 'Demo Driver',
    email: 'driver@wattway.dev',
    password: 'kothimbir123',
    role: 'driver' as const,
    vehicle: {
      make: 'Tata',
      model: 'Nexon EV Max',
      batteryCapacityKwh: 40.5,
      rangeKm: 437,
      connectorType: 'CCS2' as const,
    },
  },
];

/** Real Pune stations from OpenStreetMap (see scripts/import-osm.ts). */
function osmStations(): OsmStation[] {
  const file = path.resolve(__dirname, '../db/stations-osm.json');
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { stations: OsmStation[] }).stations;
}

export async function seed(options: { fresh?: boolean; disconnect?: boolean } = {}): Promise<void> {
  const fresh = options.fresh ?? process.argv.includes('--fresh');
  const disconnect = options.disconnect ?? true;

  await connectDatabase();

  if (fresh) {
    logger.warn('--fresh: dropping existing stations and seeded users');
    await db.query('delete from stations');
    await db.query('delete from users where email = any($1)', [USERS.map((user) => user.email)]);
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  let createdUsers = 0;
  for (const spec of USERS) {
    if (await Users.findByEmail(spec.email)) continue;
    await Users.create({
      name: spec.name,
      email: spec.email,
      password: spec.password,
      role: spec.role,
      ...('vehicle' in spec ? { vehicle: spec.vehicle } : {}),
    });
    createdUsers += 1;
  }

  const operator = await Users.findByEmail('operator@wattway.dev');

  // ── Stations ──────────────────────────────────────────────────────────────
  const inputs: StationInput[] = [
    ...STATIONS.map((spec, n) => ({
      name: spec.name,
      operator: spec.operator,
      address: { line1: spec.line1, locality: spec.locality, city: spec.city, state: spec.state, pincode: spec.pincode },
      location: { lat: spec.lat, lng: spec.lng },
      pricePerKwh: spec.pricePerKwh,
      rating: { average: spec.rating, count: spec.ratingCount },
      ports: spec.ports.map(([connectorType, powerKw, status], index) => ({
        index,
        connectorType,
        powerKw,
        status,
        occupiedSince: status === 'occupied' ? new Date() : null,
      })),
      amenities: spec.amenities,
      queueLength: spec.queueLength,
      // A stable handle for the routing module to hang a graph vertex off.
      graphNodeId: `node-${spec.city.toLowerCase().replace(/\s+/g, '-')}-${n}`,
      source: 'seed' as const,
    })),
    ...osmStations().map((spec) => ({
      name: spec.name,
      operator: spec.operator,
      address: {
        line1: spec.line1,
        locality: spec.locality,
        city: spec.city,
        state: spec.state,
        ...(spec.pincode ? { pincode: spec.pincode } : {}),
      },
      location: { lat: spec.lat, lng: spec.lng },
      pricePerKwh: spec.pricePerKwh,
      ports: spec.ports.map(([connectorType, powerKw], index) => ({
        index,
        connectorType,
        powerKw,
        status: 'free' as const,
        occupiedSince: null,
      })),
      amenities: spec.amenities,
      source: 'osm' as const,
      externalId: spec.externalId,
    })),
  ];

  let createdStations = 0;
  let skipped = 0;
  for (const input of inputs) {
    const { rows } = await db.query(
      `select 1 from stations where (name = $1 and address->>'city' = $2) or (source = $3 and external_id = $4)`,
      [input.name, input.address.city, input.source, input.externalId ?? null],
    );
    if (rows.length) {
      skipped += 1;
      continue;
    }
    const station = await Stations.create({ ...input, ...(operator ? { managedBy: operator.id } : {}) });
    if (operator) await Users.addOperatorOf(operator.id, station.id);
    createdStations += 1;
  }

  const prices = [...new Set(inputs.map((s) => s.pricePerKwh))].sort((a, b) => a - b);
  const { rows: totals } = await db.query<{ total: number; osm: number }>(
    "select count(*) as total, count(*) filter (where source = 'osm') as osm from stations",
  );

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `${BRAND.emoji}  WattWay seed complete — ${BRAND.team}`,
      '─'.repeat(64),
      `  users created .......... ${createdUsers}`,
      `  stations created ....... ${createdStations}`,
      `  stations skipped ....... ${skipped} (already present)`,
      `  total in database ...... ${totals[0]?.total} (${totals[0]?.osm} from OpenStreetMap)`,
      '',
      `  distinct prices ........ ${prices.length}  (Rs.${prices[0]} - Rs.${prices[prices.length - 1]}/kWh)`,
      '',
      '  Sign in with any of:',
      ...USERS.map((user) => `    ${user.role.padEnd(9)} ${user.email}  /  ${user.password}`),
      '',
      '  Try it:',
      '    curl "http://localhost:4000/api/search/autocomplete?q=tata"',
      '    curl "http://localhost:4000/api/search/range?minPrice=9&maxPrice=14&explain=true"',
      '    curl "http://localhost:4000/api/index/stats"',
      '',
    ].join('\n'),
  );

  if (disconnect) await disconnectDatabase();
}

// Only run when invoked directly (`npm run seed`), not when imported by demo.ts.
if (require.main === module) {
  seed().catch((error: unknown) => {
    logger.error('Seed failed', error);
    process.exit(1);
  });
}
