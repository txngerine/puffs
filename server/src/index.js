import 'dotenv/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { connectDb, closeDb } from './db.js';
import { createApp } from './app.js';
import { log } from './logger.js';

let config;
try {
  config = loadConfig();
} catch (e) {
  log.error(e.message);
  process.exit(1);
}

let dbMode = 'connecting';
try {
  dbMode = await connectDb(config.mongoUri);
} catch (e) {
  log.error('database connection failed', { error: e.message });
  process.exit(1);
}

const app = createApp(config, { dbMode: () => dbMode });
const server = app.listen(config.port, () => {
  const served = existsSync(fileURLToPath(new URL('../../client/dist', import.meta.url)));
  log.info(`eve api on http://localhost:${config.port}`, {
    db: dbMode, app: served,
  });
});

const shutdown = async () => {
  server.close();
  await closeDb().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
