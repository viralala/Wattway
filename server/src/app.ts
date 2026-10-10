/**
 * ============================================================================
 *  WattWay · Team Kothimbir 🌿  ·  Module: Indexing & Backend
 * ============================================================================
 *
 *  app.ts — the Express application.
 *
 *  Deliberately exports the app WITHOUT starting a listener. `server.ts` owns
 *  the socket; Supertest imports this module directly and drives it in-process,
 *  so the integration tests never bind a port and never race each other.
 *
 *  Middleware order matters and is not arbitrary:
 *
 *      1. trust proxy    — so rate limiting sees the real client IP on Render
 *      2. helmet         — security headers before anything can respond
 *      3. cors           — reject a disallowed origin before doing work
 *      4. body parsers   — with a size cap
 *      5. brand + trace  — request id on every response, errors included
 *      6. logging        — after the id exists, so it can be logged
 *      7. rate limit     — before routes, after cheap rejections
 *      8. routes
 *      9. 404            — anything unmatched
 *     10. error handler  — must be last, and must take four arguments
 * ============================================================================
 */

import path from 'node:path';
import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import routes from './routes';
import * as metaController from './controllers/metaController';
import { asyncHandler } from './middleware/asyncHandler';
import { brandAndTrace } from './middleware/brand';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/error';
import { env } from './config/env';
import { BRAND } from './config/brand';

export function createApp(): Express {
  const app = express();

  // Behind Render/Railway/Vercel, the client IP is in X-Forwarded-For. Without
  // this every request looks like it came from the proxy and the rate limiter
  // throttles the whole world as one client.
  app.set('trust proxy', 1);

  // Helmet sets its own X-Powered-By removal; we replace it with ours in
  // brandAndTrace, which runs later.
  app.use(helmet());
  app.disable('x-powered-by');

  // Per-request options, so a request can be recognised as same-origin. Browsers
  // attach `Origin` to same-origin POSTs too, which matters now that the server
  // hosts the dashboard it is called from.
  const corsOptions = (req: express.Request, callback: (err: Error | null, options?: CorsOptions) => void): void => {
    const origin = req.header('Origin');
    const sameOrigin = origin !== undefined && origin === `${req.protocol}://${req.get('host')}`;
    const allowed =
      !origin || // curl, Postman, server-to-server: not a browser, CORS is not the control
      sameOrigin ||
      env.corsOrigins.includes(origin) ||
      env.corsOrigins.includes('*');
    if (!allowed) return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    callback(null, { origin: true, credentials: true, exposedHeaders: ['X-Request-Id', 'X-WattWay-Team'] });
  };
  app.use(cors(corsOptions));

  app.use(compression());

  // 100kb is plenty for our largest body (a 32-port station). A cap here is
  // the cheapest possible defence against a memory-exhaustion POST.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  app.use(brandAndTrace);

  if (!env.isTest) {
    morgan.token('rid', (req) => (req as express.Request).requestId ?? '-');
    app.use(
      morgan(':rid :method :url :status :response-time ms', {
        skip: (_req, res) => res.statusCode < 400 && env.isProduction,
      }),
    );
  }

  // The dashboard is plain static files, served from the same origin as the API
  // so the browser needs no CORS allowance and no build step.
  app.use('/dashboard', express.static(path.resolve(__dirname, '../../client/public/dashboard')));
  // (static files sit before the limiter: page loads must not spend the API quota)

  app.use(apiLimiter);

  app.get('/', asyncHandler(metaController.root));
  app.use('/api', routes);

  // Order is load-bearing: 404 catches unmatched paths, then the error handler
  // catches everything thrown anywhere above it.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
export { BRAND };
export default app;
