import { PostgresAdapter } from './PostgresAdapter.js';
import { MemoryAdapter } from './MemoryAdapter.js';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';

const log = createLogger('StorageFactory');

let storageInstance = null;

export async function initStorage() {
  if (storageInstance) return storageInstance;

  const mongoUri = config.database.mongodbUri;
  const postgresUri = config.database.postgresUri;
  const driver = config.database.driver;

  if (driver === 'postgres' && postgresUri) {
    log.info('Initializing Postgres Adapter (Explicit)');
    storageInstance = new PostgresAdapter(postgresUri);
  } else if (driver === 'mongo' && mongoUri) {
    log.info('Initializing MongoDB Adapter (Explicit)');
    const { MongoAdapter } = await import('./MongoAdapter.js');
    storageInstance = new MongoAdapter(mongoUri);
  } else if (driver === 'memory') {
    log.info('Initializing Memory Adapter (Explicit)');
    storageInstance = new MemoryAdapter();
  }
  // 2. Auto-detection Priority: Postgres > Mongo > Memory
  else if (postgresUri) {
    log.info('Initializing Postgres Adapter (Auto-detected)');
    storageInstance = new PostgresAdapter(postgresUri);
  } else if (mongoUri) {
    log.info('Initializing MongoDB Adapter (Auto-detected)');
    const { MongoAdapter } = await import('./MongoAdapter.js');
    storageInstance = new MongoAdapter(mongoUri);
  } else {
    log.warn(
      'No database configured. Falling back to In-Memory Storage (Data will be lost on restart)'
    );
    storageInstance = new MemoryAdapter();
  }

  await storageInstance.connect();
  return storageInstance;
}

export function getStorage() {
  if (!storageInstance) {
    throw new Error('Storage has not been initialized');
  }
  return storageInstance;
}
