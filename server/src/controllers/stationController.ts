/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * stationController.ts — station CRUD, the port board, and ratings.
 *
 * EVERY WRITE IN THIS FILE KEEPS THE INDEX IN SYNC.
 *
 * Whenever a station is created, changed, rated or deactivated, we call
 * `stationIndex.upsert()` / `.remove()` in the same request. Skip that and the
 * BST keeps serving the old price and the trie keeps serving the old name until
 * the next scheduled rebuild — a stale-read bug that is very hard to spot in a
 * demo, because it looks like everything works.
 *
 * If you add a write path to stations from another module, do the same.
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import {
  Stations,
  freePorts,
  setPortStatus as flipPort,
  stationJSON,
  toIndexed,
  totalPorts,
} from '../models/Station';
import { Users } from '../models/User';
import { stationIndex } from '../services/stationIndex';
import { ApiError } from '../utils/ApiError';
import { created, ok, paginate } from '../utils/respond';
import { currentUser } from '../middleware/auth';
import { haversineKm, isValidLatLng, type LatLng } from '../utils/geo';
import type { ConnectorType, Port, PortStatus, StationResult } from '../types';

interface PortInput {
  connectorType: ConnectorType;
  powerKw: number;
  status?: PortStatus;
}

interface StationBody {
  name: string;
  operator: string;
  address: {
    line1: string;
    locality: string;
    city: string;
    state: string;
    pincode?: string;
  };
  location: { lat: number; lng: number };
  pricePerKwh: number;
  ports: PortInput[];
  amenities?: string[];
  graphNodeId?: string;
}

/**
 * GET /api/stations
 *
 * The plain listing — paginated, optionally filtered by city/operator and
 * sorted by proximity. Range filtering by price or rating lives at
 * `/api/search/range`, because that is the BST's job and this one is a
 * straightforward database read.
 */
export async function listStations(req: Request, res: Response): Promise<void> {
  const {
    page = 1,
    limit = 20,
    city,
    operator,
    connectorType,
    lat,
    lng,
    radiusKm,
  } = req.query as unknown as {
    page?: number;
    limit?: number;
    city?: string;
    operator?: string;
    connectorType?: ConnectorType;
    lat?: number;
    lng?: number;
    radiusKm?: number;
  };

  const near: LatLng | undefined =
    lat !== undefined && lng !== undefined && isValidLatLng({ lat, lng }) ? { lat, lng } : undefined;

  const { stations: rows, total } = await Stations.page(
    { city, operator, connectorType, ...(near && radiusKm !== undefined ? { near, radiusKm } : {}) },
    page,
    limit,
  );

  const stations: StationResult[] = rows.map((row) => {
    const indexed: StationResult = { ...toIndexed(row), ports: row.ports, source: row.source };
    return near
      ? { ...indexed, distanceKm: round(haversineKm(near, indexed.location), 3) }
      : indexed;
  });

  if (near) stations.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

  ok(res, { stations }, { pagination: paginate(page, limit, total) });
}

export async function getStation(req: Request, res: Response): Promise<void> {
  const station = await Stations.findById(req.params.id);
  if (!station || !station.isActive) throw ApiError.notFound('Station not found');
  ok(res, { station: stationJSON(station) });
}

export async function createStation(req: Request, res: Response): Promise<void> {
  const actor = currentUser(req);
  const body = req.body as StationBody;

  const station = await Stations.create({
    name: body.name,
    operator: body.operator,
    address: body.address,
    location: body.location,
    pricePerKwh: body.pricePerKwh,
    ports: toPorts(body.ports),
    amenities: body.amenities ?? [],
    ...(body.graphNodeId ? { graphNodeId: body.graphNodeId } : {}),
    managedBy: actor.id,
  });

  if (actor.role === 'operator') await Users.addOperatorOf(actor.id, station.id);

  stationIndex.upsert(toIndexed(station));
  created(res, { station: stationJSON(station) });
}

export async function updateStation(req: Request, res: Response): Promise<void> {
  const station = await Stations.findById(req.params.id);
  if (!station) throw ApiError.notFound('Station not found');

  const body = req.body as Partial<StationBody> & { isActive?: boolean };

  if (body.name !== undefined) station.name = body.name;
  if (body.operator !== undefined) station.operator = body.operator;
  if (body.address !== undefined) station.address = body.address;
  if (body.pricePerKwh !== undefined) station.pricePerKwh = body.pricePerKwh;
  if (body.amenities !== undefined) station.amenities = body.amenities;
  if (body.graphNodeId !== undefined) station.graphNodeId = body.graphNodeId;
  if (body.isActive !== undefined) station.isActive = body.isActive;
  if (body.location !== undefined) {
    station.location = { type: 'Point', coordinates: [body.location.lng, body.location.lat] };
  }
  if (body.ports !== undefined) station.ports = toPorts(body.ports);

  await Stations.save(station);

  if (station.isActive) stationIndex.upsert(toIndexed(station));
  else stationIndex.remove(station.id);

  ok(res, { station: stationJSON(station) });
}

export async function deactivateStation(req: Request, res: Response): Promise<void> {
  const station = await Stations.findById(req.params.id);
  if (!station) throw ApiError.notFound('Station not found');

  station.isActive = false;
  await Stations.save(station);
  stationIndex.remove(station.id);

  ok(res, { id: station.id, isActive: false });
}

export async function setPortStatus(req: Request, res: Response): Promise<void> {
  const station = await Stations.findById(req.params.id);
  if (!station) throw ApiError.notFound('Station not found');

  const portIndex = Number(req.params.portIndex);
  const { status } = req.body as { status: PortStatus };

  let port;
  try {
    port = flipPort(station, portIndex, status);
  } catch (error) {
    if (error instanceof RangeError) throw ApiError.notFound(error.message);
    throw error;
  }

  await Stations.save(station);

  stationIndex.upsert(toIndexed(station));

  ok(res, {
    stationId: station.id,
    port,
    freePorts: freePorts(station),
    totalPorts: totalPorts(station),
  });
}

/**
 * POST /api/stations/:id/rating — one rating per driver per station; rating
 * again replaces the earlier score. The average is recomputed from the
 * ratings table in the same statement, so it can never drift.
 */
export async function rateStation(req: Request, res: Response): Promise<void> {
  const actor = currentUser(req);
  const station = await Stations.findById(req.params.id);
  if (!station || !station.isActive) throw ApiError.notFound('Station not found');

  const { rating } = req.body as { rating: number };
  const updated = await Stations.rate(station.id, actor.id, rating);
  if (!updated) throw ApiError.notFound('Station not found');

  stationIndex.upsert(toIndexed(updated));

  ok(res, { stationId: updated.id, rating: updated.rating });
}

function toPorts(ports: PortInput[]): Port[] {
  return ports.map((port, index) => ({
    index,
    connectorType: port.connectorType,
    powerKw: port.powerKw,
    status: port.status ?? 'free',
    occupiedSince: null,
  }));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
