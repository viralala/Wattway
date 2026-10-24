/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Queue & Realtime
 * ============================================================================
 *
 *  QueueEntry.ts — the `queue_entries` table: one row per driver per visit.
 *
 *  The live line itself is a doubly linked list in services/queueService.ts;
 *  these rows are its durable log. A partial unique index allows only one
 *  waiting-or-charging entry per driver per station.
 *
 *  Every function takes the transaction handle (`q`) explicitly, because the
 *  queue service always writes inside one.
 * ============================================================================
 */

import type { Queryable } from '../config/db';

export const QUEUE_STATUSES = ['waiting', 'charging', 'completed', 'cancelled', 'expired'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** A live entry plus the driver's display name, as the line rehydrates it. */
export interface LiveEntry {
  id: string;
  userId: string;
  userName: string | null;
  status: QueueStatus;
  /** 1-based place in line while waiting; 0 once charging. */
  position: number;
  portIndex: number | null;
  joinedAt: Date;
  startedChargingAt: Date | null;
  batteryPct: number | null;
  emergency: boolean;
  expectedChargeMinutes: number | null;
}

interface LiveRow {
  id: string;
  user_id: string;
  user_name: string | null;
  status: QueueStatus;
  position: number;
  port_index: number | null;
  joined_at: Date;
  started_charging_at: Date | null;
  battery_pct: number | string | null;
  emergency: boolean;
  expected_charge_minutes: number | string | null;
}

const num = (value: number | string | null): number | null => (value === null ? null : Number(value));

export const QueueEntries = {
  /** Waiting and charging entries for a station, in stored line order. */
  async live(q: Queryable, stationId: string): Promise<LiveEntry[]> {
    const { rows } = await q.query<LiveRow>(
      `select e.id, e.user_id, u.name as user_name, e.status, e.position, e.port_index, e.joined_at,
              e.started_charging_at, e.battery_pct, e.emergency, e.expected_charge_minutes
       from queue_entries e join users u on u.id = e.user_id
       where e.station_id = $1 and e.status in ('waiting', 'charging')
       order by e.position, e.joined_at`,
      [stationId],
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      status: row.status,
      position: Number(row.position),
      portIndex: row.port_index === null ? null : Number(row.port_index),
      joinedAt: new Date(row.joined_at),
      startedChargingAt: row.started_charging_at ? new Date(row.started_charging_at) : null,
      batteryPct: num(row.battery_pct),
      emergency: row.emergency,
      expectedChargeMinutes: num(row.expected_charge_minutes),
    }));
  },

  /** Insert a waiting entry; returns its id. Throws Postgres 23505 if the driver is already in line. */
  async create(
    q: Queryable,
    input: {
      stationId: string;
      userId: string;
      position: number;
      joinedAt: Date;
      estimatedWaitMinutesAtJoin: number;
      batteryPct: number | null;
      emergency: boolean;
      expectedChargeMinutes: number;
    },
  ): Promise<string> {
    const { rows } = await q.query<{ id: string }>(
      `insert into queue_entries (station_id, user_id, status, position, joined_at, estimated_wait_minutes_at_join,
         battery_pct, emergency, expected_charge_minutes)
       values ($1, $2, 'waiting', $3, $4, $5, $6, $7, $8) returning id`,
      [
        input.stationId,
        input.userId,
        input.position,
        input.joinedAt,
        input.estimatedWaitMinutesAtJoin,
        input.batteryPct,
        input.emergency,
        input.expectedChargeMinutes,
      ],
    );
    return rows[0].id;
  },

  async startCharging(q: Queryable, id: string, portIndex: number, at: Date): Promise<void> {
    await q.query(
      `update queue_entries set status = 'charging', position = 0, port_index = $2, started_charging_at = $3,
         updated_at = now() where id = $1`,
      [id, portIndex, at],
    );
  },

  async finish(q: Queryable, id: string, status: 'completed' | 'cancelled', at: Date): Promise<void> {
    await q.query(
      'update queue_entries set status = $2, finished_at = $3, position = 0, updated_at = now() where id = $1',
      [id, status, at],
    );
  },

  /** Rewrite the positions that changed, in one statement. */
  async setPositions(q: Queryable, moves: { id: string; position: number }[]): Promise<void> {
    if (!moves.length) return;
    await q.query(
      `update queue_entries e set position = m.position, updated_at = now()
       from unnest($1::uuid[], $2::int[]) as m(id, position) where e.id = m.id`,
      [moves.map((m) => m.id), moves.map((m) => m.position)],
    );
  },

  async moveTo(q: Queryable, ids: string[], stationId: string): Promise<void> {
    if (!ids.length) return;
    await q.query('update queue_entries set station_id = $2, updated_at = now() where id = any($1::uuid[])', [
      ids,
      stationId,
    ]);
  },
};

export default QueueEntries;
