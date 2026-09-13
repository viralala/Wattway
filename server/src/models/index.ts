/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Barrel for the Mongoose models. Import from here (`../models`) rather than
 * reaching into individual files, so model registration order stays under our
 * control and a circular import shows up in one place.
 * ---------------------------------------------------------------------------
 */

export { User } from './User';
export type { UserDocument, UserModel, VehicleProfile } from './User';

export { Station } from './Station';
export type { StationDocument, StationModel } from './Station';

export { Trip, TRIP_STATUSES } from './Trip';
export type { TripDocument, TripModel, TripStatus } from './Trip';

export { QueueEntry, QUEUE_STATUSES } from './QueueEntry';
export type { QueueEntryDocument, QueueEntryModel, QueueStatus } from './QueueEntry';
