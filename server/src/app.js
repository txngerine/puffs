import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { data } from './routes/data.js';
import { deviceRoutes } from './routes/device.js';
import { search } from './routes/search.js';
import { supported as deviceSupported } from './device/mac.js';
import { rateLimit } from './middleware/limits.js';
import { log, requestLog } from './logger.js';

// Builds the Express app without listening or connecting, so tests can drive it directly.
export function createApp(config, { dbMode = () => 'unknown', serveClient = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(requestLog);
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({
      ok: db, db: db ? dbMode() : 'down',
      device: Boolean(config.localActions) && deviceSupported(),
    });
  });

  app.use('/api', rateLimit({ windowMs: 60_000, max: 300, key: (req) => 'api:' + req.ip }));
  // Anonymous per-browser identity: every data route is scoped to this id.
  app.use('/api', (req, res, next) => {
    const id = req.get('x-eve-device');
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) return res.status(400).json({ error: 'missing or invalid x-eve-device header' });
    req.deviceId = id;
    next();
  });
  app.use('/api', search);
  const writes = rateLimit({ windowMs: 60_000, max: 60, key: (req) => 'w:' + req.deviceId });
  app.use('/api', (req, res, next) => (req.method === 'GET' ? next() : writes(req, res, next)));
  app.use('/api', data);
  app.use('/api/device', deviceRoutes(config));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  // Production: serve the built React app from the same origin.
  const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (serveClient && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: dist }));
  }

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request too large' });
    log.error('unhandled', { path: req.path, error: err.message });
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'internal error' });
  });
  return app;
}
