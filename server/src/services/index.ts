/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Barrel for the service layer — stateful things that outlive a request.
 *
 *   · stationIndex  — the live BST + Trie index over stations
 *   · tokenService  — JWT minting and verification
 *
 * Expected from the Queue & Realtime module: `queueService.ts`, holding the
 * per-station in-memory Queue. Keep it a singleton the same way `stationIndex`
 * is — a per-request queue is not a queue.
 * ---------------------------------------------------------------------------
 */

export { StationIndex, stationIndex } from './stationIndex';
export type { StationIndexStats } from './stationIndex';

export {
  signAccessToken,
  signRefreshToken,
  issueTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  bearerFrom,
} from './tokenService';
export type { AccessTokenClaims, RefreshTokenClaims, TokenPair, TokenType } from './tokenService';
