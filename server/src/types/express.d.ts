/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * Augment Express's Request so `req.user` is typed everywhere after the auth
 * middleware has run. Without this every controller would need a cast.
 * ---------------------------------------------------------------------------
 */

import type { AuthUser } from './index';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth` / `optionalAuth`. Undefined for public routes. */
      user?: AuthUser;
      /** Set by the request logger; echoed back as `X-Request-Id`. */
      requestId?: string;
    }
  }
}

export {};
