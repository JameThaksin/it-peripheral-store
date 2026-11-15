import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { api } from './routes/api.js';

export function createApp(opts: { webDist?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:'], 'script-src': ["'self'"] } },
  }));
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api', api);

  // Same-origin hosting: serve the built React app when it exists.
  if (opts.webDist && fs.existsSync(path.join(opts.webDist, 'index.html'))) {
    app.use(express.static(opts.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(opts.webDist!, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] unhandled error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
  });
  return app;
}
