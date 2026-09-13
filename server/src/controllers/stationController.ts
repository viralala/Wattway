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
import { Station } from '../models/Station';
import { User } from '../models/User';
import { stationIndex } from '../services/stationIndex';
import { ApiError } from '../utils/ApiError';
import { created, ok, paginate } from '../utils/respond';
import { currentUser } from '../middleware/auth';
import { haversineKm, isValidLatLng, type LatLng } from '../utils/geo';
import type { ConnectorType, PortStatus, StationResult } from '../types';

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

  const filter: Record<string, unknown> = { isActive: true };
  if (city) filter['address.city'] = new RegExp(`^${escapeRegex(city)}$`, 'i');
  if (operator) filter.operator = new RegExp(`^${escapeRegex(operator)}$`, 'i');
  if (connectorType) filter['ports.connectorType'] = connectorType;

  const near: LatLng | undefined =
    lat !== undefined && lng !== undefined && isValidLatLng({ lat, lng }) ? { lat, lng } : undefined;

  if (near && radiusKm !== undefined) {
    filter.location = {
      $geoWithin: {
        // $centerSphere takes a radius in radians: km / Earth radius.
        $centerSphere: [[near.lng, near.lat], radiusKm / 6371],
      },
    };
  }

  const [documents, total] = await Promise.all([
    Station.find(filter)
      .sort({ 'rating.average': -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec(),
    Station.countDocuments(filter).exec(),
  ]);

  const stations: StationResult[] = documents.map((document) => {
    const indexed = document.toIndexed();
    return near
      ? { ...indexed, distanceKm: round(haversineKm(near, indexed.location), 3) }
      : indexed;
  });

  if (near) stations.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

  ok(res, { stations }, { pagination: paginate(page, limit, total) });
}

/** GET /api/stations/:id */
export async function getStation(req: Request, res: Response): Promise<void> {
  const station = await Station.findById(req.params.id).exec();
  if (!station || !station.isActive) throw ApiError.notFound('Station not found');
  ok(res, { station: station.toJSON() });
}

/** POST /api/stations — operator or admin. */
export async function createStation(req: Request, res: Response): Promise<void> {
  const actor = currentUser(req);
  const body = req.body as StationBody;

  const station = await Station.create({
    name: body.name,
    operator: body.operator,
    address: body.address,
    location: { type: 'Point', coordinates: [body.location.lng, body.location.lat] },
    pricePerKwh: body.pricePerKwh,
    // The fixed-size port board. Index is assigned here, once, and is the
    // array position every later O(1) port update relies on.
    ports: body.ports.map((port, index) => ({
      index,
      connectorType: port.connectorType,
      powerKw: port.powerKw,
      status: port.status ?? 'free',
      occupiedSince: null,
    })),
    amenities: body.amenities ?? [],
    ...(body.graphNodeId ? { graphNodeId: body.graphNodeId } : {}),
    managedBy: actor.id,
  });

  // Mirror the link onto the operator so "my stations" is a single read.
  if (actor.role === 'operator') {
    await User.updateOne({ _id: actor.id }, { $addToSet: { operatorOf: station._id } }).exec();
  }

  stationIndex.upsert(station.toIndexed());
  created(res, { station: station.toJSON() });
}

/** PATCH /api/stations/:id — operator (own stations) or admin. */
export async function updateStation(req: Request, res: Response): Promise<void> {
  const station = await Station.findById(req.params.id).exec();
  if (!station) throw ApiError.notFound('Station not found');

  const body = req.body as Partial<StationBody> & { isActive?: boolean };

  if (body.name !== undefined) station.name = body.name;
  if (body.operator !== undefined) station.operator = body.operator;
  if (body.address !== undefined) station.set('address', body.address);
  if (body.pricePerKwh !== undefined) station.pricePerKwh = body.pricePerKwh;
  if (body.amenities !== undefined) station.amenities = body.amenities;
  if (body.graphNodeId !== undefined) station.graphNodeId = body.graphNodeId;
  if (body.isActive !== undefined) station.isActive = body.isActive;

  if (body.location !== undefined) {
    station.location = { type: 'Point', coordinates: [body.location.lng, body.location.lat] };
  }

  // Replacing the port board renumbers it, so any live queue assignment
  // referencing an old port index is invalidated by design.
  if (body.ports !== undefined) {
    station.ports = body.ports.map((port, index) => ({
      index,
      connectorType: port.connectorType,
      powerKw: port.powerKw,
      status: port.status ?? 'free',
      occupiedSince: null,
    }));
  }

  await station.save();

  // A price or name change moves this station in the BST and the trie.
  if (station.isActive) stationIndex.upsert(station.toIndexed());
  else stationIndex.remove(station._id.toString());

  ok(res, { station: station.toJSON() });
}

/**
 * DELETE /api/stations/:id
 *
 * Soft delete. Trips and queue history reference stations, and hard-deleting
 * one would leave those rows pointing at nothing.
 */
export async function deactivateStation(req: Request, res: Response): Promise<void> {
  const station = await Station.findById(req.params.id).exec();
  if (!station) throw ApiError.notFound('Station not found');

  station.isActive = false;
  await station.save();
  stationIndex.remove(station._id.toString());

  ok(res, { id: station._id.toString(), isActive: false });
}

/**
 * PATCH /api/stations/:id/ports/:portIndex
 *
 * The Array data structure in action (PRD Section 5): O(1) addressing into a
 * fixed-size slot board to flip one port's state.
 *
 * The queue module will call this when a session starts or ends; an operator
 * calls it from the dashboard to mark a charger faulted.
 */
export async function setPortStatus(req: Request, res: Response): Promise<void> {
  const station = await Station.findById(req.params.id).exec();
  if (!station) throw ApiError.notFound('Station not found');

  const portIndex = Number(req.params.portIndex);
  const { status } = req.body as { status: PortStatus };

  let port;
  try {
    port = station.setPortStatus(portIndex, status);
  } catch (error) {
    if (error instanceof RangeError) throw ApiError.notFound(error.message);
    throw error;
  }

  await station.save();

  // Free-port count feeds the recommendation score, so the index must see it.
  stationIndex.upsert(station.toIndexed());

  ok(res, {
    stationId: station._id.toString(),
    port,
    freePorts: station.freePorts,
    totalPorts: station.totalPorts,
  });
}

/**
 * POST /api/stations/:id/rating — any signed-in driver.
 *
 * Kept as a running mean rather than a separate reviews collection: the second
 * BST is keyed on `rating.average`, and a running mean updates it in O(1)
 * without re-aggregating anything.
 */
export async function rateStation(req: Request, res: Response): Promise<void> {
  const station = await Station.findById(req.params.id).exec();
  if (!station || !station.isActive) throw ApiError.notFound('Station not found');

  const { rating } = req.body as { rating: number };

  const total = station.rating.average * station.rating.count + rating;
  station.rating.count += 1;
  station.rating.average = round(total / station.rating.count, 2);

  await station.save();

  // The rating BST is keyed on this value, so the station has to move buckets.
  stationIndex.upsert(station.toIndexed());

  ok(res, { stationId: station._id.toString(), rating: station.rating });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Never interpolate user input into a RegExp unescaped. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
