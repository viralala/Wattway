/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * import-osm.ts — fetch real EV charging stations from OpenStreetMap.
 *
 *   npm run import:osm            → writes db/stations-osm.json
 *
 * Asks the Overpass API for every `amenity=charging_station` in the bounding
 * box, then reverse-geocodes each one with Nominatim for its locality (at most
 * one request a second, as Nominatim's usage policy asks). The result is a
 * committed snapshot that `npm run seed` loads, so seeding never depends on
 * these services being up.
 *
 * OpenStreetMap rarely records prices or live port states, so:
 *   - ports come from `capacity` / `socket:*` tags, or a typical layout for the
 *     operator (two-wheeler networks get AC points, car networks DC + AC),
 *   - the price is a typical tariff for that kind of charger,
 *   - ratings start at zero: nobody has rated these stations yet.
 * Every station is stored with `source = 'osm'` and its OSM id.
 *
 * Map data © OpenStreetMap contributors, ODbL.
 * ---------------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ConnectorType } from '../src/types';

/** Greater Pune: south, west, north, east. */
const BBOX = [18.4, 73.65, 18.7, 74.05];
const CITY = 'Pune';
const STATE = 'Maharashtra';
const OUT = path.resolve(__dirname, '../db/stations-osm.json');
const USER_AGENT = 'WattWay/0.1 (DSA course project; https://github.com/viralala/Wattway)';

interface OsmElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

export interface OsmStation {
  externalId: string;
  name: string;
  operator: string;
  line1: string;
  locality: string;
  city: string;
  state: string;
  pincode?: string;
  lat: number;
  lng: number;
  pricePerKwh: number;
  ports: Array<[ConnectorType, number]>;
  amenities: string[];
}

/** Networks that mostly serve two-wheelers with slow AC points. */
const TWO_WHEELER = /ather|bolt|bijlify|go ?ego|goego|powerup|trimurti|ola/i;

const SOCKETS: Array<[string, ConnectorType, number]> = [
  ['socket:type2_combo', 'CCS2', 60],
  ['socket:chademo', 'CHAdeMO', 50],
  ['socket:type2', 'Type2', 22],
  ['socket:gb_t', 'GB/T', 50],
];

function titleCase(text: string): string {
  return text.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1));
}

function operatorOf(tags: Record<string, string>): string {
  const raw = tags.operator || tags.brand || tags.network || tags['brand:en'] || 'Independent';
  // OSM spells the same network several ways ("Tata power", "Tata").
  if (/^tata/i.test(raw)) return 'Tata Power';
  if (/go ?ego/i.test(raw)) return 'GoEgo';
  if (/jio/i.test(raw)) return 'Jio-bp pulse';
  return titleCase(raw.trim());
}

function portsFor(tags: Record<string, string>, operator: string): Array<[ConnectorType, number]> {
  const ports: Array<[ConnectorType, number]> = [];
  for (const [tag, type, kw] of SOCKETS) {
    const count = Number.parseInt(tags[tag] ?? '', 10);
    if (count > 0) for (let i = 0; i < Math.min(count, 8); i += 1) ports.push([type, kw]);
  }
  if (ports.length) return ports;

  const capacity = Math.min(Math.max(Number.parseInt(tags.capacity ?? '', 10) || 2, 1), 8);
  if (TWO_WHEELER.test(operator)) return Array.from({ length: capacity }, () => ['Bharat-AC-001', 3.3]);
  // Car networks: one fast DC point, the rest AC.
  return Array.from({ length: capacity }, (_, i) => (i === 0 ? ['CCS2', 60] : ['Type2', 22]));
}

/** A typical public tariff for the fastest port at the station, ₹/kWh. */
function priceFor(ports: Array<[ConnectorType, number]>, externalId: string): number {
  const fastest = Math.max(...ports.map(([, kw]) => kw));
  const base = fastest >= 50 ? 19 : fastest >= 15 ? 15 : 11;
  // Spread stations a little (stable per id) so the BST sees distinct keys.
  const jitter = [...externalId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 7;
  return base + jitter * 0.5;
}

async function overpass(): Promise<OsmElement[]> {
  const [s, w, n, e] = BBOX;
  const query = `[out:json][timeout:60];(node["amenity"="charging_station"](${s},${w},${n},${e});way["amenity"="charging_station"](${s},${w},${n},${e}););out center tags;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error(`Overpass replied ${response.status}`);
  return ((await response.json()) as { elements: OsmElement[] }).elements;
}

interface Place {
  line1: string;
  locality: string;
  pincode?: string;
}

async function reverse(lat: number, lng: number): Promise<Place> {
  const url = `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'jsonv2',
    zoom: '17',
    addressdetails: '1',
  })}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Nominatim replied ${response.status}`);
  const body = (await response.json()) as { address?: Record<string, string> };
  const a = body.address ?? {};
  const locality = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || a.town || CITY;
  const line1 = [a.house_number, a.road].filter(Boolean).join(' ') || a.amenity || a.building || locality;
  const pincode = /^\d{6}$/.test(a.postcode ?? '') ? a.postcode : undefined;
  return { line1, locality, ...(pincode ? { pincode } : {}) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const elements = await overpass();
  // eslint-disable-next-line no-console
  console.log(`Overpass: ${elements.length} charging stations in ${CITY}`);

  const stations: OsmStation[] = [];
  const names = new Set<string>();
  for (const element of elements) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (lat === undefined || lng === undefined) continue;

    const tags = element.tags ?? {};
    const externalId = `${element.type}/${element.id}`;
    const operator = operatorOf(tags);
    const place = await reverse(lat, lng);
    await sleep(1100);

    // Most OSM chargers have no name: call them "<operator> <locality>", made unique.
    const base = (tags.name || `${operator === 'Independent' ? 'EV Charging' : operator} ${place.locality}`).slice(0, 110);
    let name = base;
    for (let n = 2; names.has(name); n += 1) name = `${base} ${n}`;
    names.add(name);

    const ports = portsFor(tags, operator);
    const amenities = [
      tags.covered === 'yes' ? 'covered' : '',
      tags.access === 'customers' ? 'customers only' : '',
      tags.fee === 'no' ? 'free charging' : '',
    ].filter(Boolean);

    stations.push({
      externalId,
      name,
      operator,
      line1: place.line1.slice(0, 160),
      locality: place.locality,
      city: CITY,
      state: STATE,
      ...(place.pincode ? { pincode: place.pincode } : {}),
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      pricePerKwh: tags.fee === 'no' ? 0 : priceFor(ports, externalId),
      ports,
      amenities,
    });
    // eslint-disable-next-line no-console
    console.log(`  ${externalId.padEnd(16)} ${name}`);
  }

  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', fetchedAt: new Date().toISOString(), stations }, null, 2)}\n`,
  );
  // eslint-disable-next-line no-console
  console.log(`Wrote ${stations.length} stations to ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
