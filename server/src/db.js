import mongoose from 'mongoose';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let embedded = null;

// Uses MONGODB_URI when set. Otherwise starts an embedded MongoDB (development only)
// whose data persists in server/.data, so nothing has to be installed to run the app.
export async function connectDb(uri) {
  let mode = 'mongodb';
  if (!uri) {
    let MongoMemoryServer;
    try {
      ({ MongoMemoryServer } = await import('mongodb-memory-server'));
    } catch {
      throw new Error('MONGODB_URI is not set and mongodb-memory-server is not installed. Set MONGODB_URI in server/.env.');
    }
    if (process.env.PUFFS_EPHEMERAL_DB === '1') {
      embedded = await MongoMemoryServer.create(); // tests: throwaway database
    } else {
      const dbPath = fileURLToPath(new URL('../.data/db', import.meta.url));
      mkdirSync(dbPath, { recursive: true });
      embedded = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
    }
    uri = embedded.getUri('puffs');
    mode = 'embedded';
  }
  await mongoose.connect(uri);
  return mode;
}

export async function closeDb() {
  await mongoose.disconnect();
  if (embedded) await embedded.stop({ doCleanup: false });
}
