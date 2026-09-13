/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * QueueEntry.ts — one vehicle's place in one station's virtual waiting line.
 *
 * PRD Section 10: "Join a station's virtual queue and see live position +
 *                  estimated wait (Queue-backed, pushed via WebSocket)."
 *
 * OWNERSHIP NOTE FOR THE QUEUE MODULE
 * -----------------------------------
 * This collection is the *durable* record of the queue — what survives a server
 * restart and what an operator can audit. The live, hot-path structure is your
 * in-memory Queue (and the doubly-linked list behind it, for O(1) mid-queue
 * removal when a driver bails). Treat Mongo as the write-behind log for that
 * structure, not as the thing you read on every socket tick.
 *
 * `position` is stored because a driver reloading the page should see the same
 * number they saw before; keep it in sync when you dequeue.
 * ---------------------------------------------------------------------------
 */

import { Schema, model, type Document, type Model, type Types } from 'mongoose';

export const QUEUE_STATUSES = ['waiting', 'charging', 'completed', 'cancelled', 'expired'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export interface QueueEntryDocument extends Document<Types.ObjectId> {
  station: Types.ObjectId;
  user: Types.ObjectId;
  status: QueueStatus;
  /** 1-based place in line while `status === 'waiting'`; 0 once charging. */
  position: number;
  /** Which port the driver was assigned, once one frees up. */
  portIndex?: number | null;
  joinedAt: Date;
  startedChargingAt?: Date | null;
  finishedAt?: Date | null;
  /** Snapshot of the estimate shown at join time, for later accuracy analysis. */
  estimatedWaitMinutesAtJoin?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type QueueEntryModel = Model<QueueEntryDocument>;

const queueEntrySchema = new Schema<QueueEntryDocument, QueueEntryModel>(
  {
    station: { type: Schema.Types.ObjectId, ref: 'Station', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: QUEUE_STATUSES, default: 'waiting', index: true },
    position: { type: Number, default: 0, min: 0 },
    portIndex: { type: Number, default: null, min: 0 },
    joinedAt: { type: Date, default: Date.now },
    startedChargingAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    estimatedWaitMinutesAtJoin: { type: Number, min: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// FIFO read for one station: the queue module's rehydrate-on-boot query.
queueEntrySchema.index({ station: 1, status: 1, joinedAt: 1 });

/**
 * A driver may hold at most one live place per station. The partial filter
 * means completed/cancelled history rows are exempt, so someone can queue at
 * the same station again tomorrow.
 */
queueEntrySchema.index(
  { station: 1, user: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['waiting', 'charging'] } },
  },
);

export const QueueEntry = model<QueueEntryDocument, QueueEntryModel>('QueueEntry', queueEntrySchema);
export default QueueEntry;
