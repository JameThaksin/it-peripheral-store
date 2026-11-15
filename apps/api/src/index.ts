import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';

const env = loadEnv();
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
const server = createApp({ webDist }).listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT} (${env.NODE_ENV})`);
});

const shutdown = () => server.close(() => { disconnectDb().finally(() => process.exit(0)); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
