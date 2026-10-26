import { PostgresAdapter } from './PostgresAdapter.ts';
import { MemoryAdapter } from './MemoryAdapter.ts';
import { createLogger } from '../../utils/logger.ts';
import { config } from '../../config.ts';
import type { IStorageAdapter } from '../../types/index.ts';

const log = createLogger('StorageFactory');

let storageInstance: IStorageAdapter | null = null;
let storageDriver: 'postgres' | 'mongo' | 'memory' | null = null;

export function getStorageDriver(): 'postgres' | 'mongo' | 'memory' | null {
  return storageDriver;
}

export async function initStorage(): Promise<IStorageAdapter> {
  if (storageInstance) return storageInstance;

  const mongoUri = config.database.mongodbUri;
  const postgresUri = config.database.postgresUri;
  const driver = config.database.driver;

  if (driver === 'postgres' && postgresUri) {
    log.info('Initializing Postgres Adapter (Explicit)');
    storageInstance = new PostgresAdapter(postgresUri);
    storageDriver = 'postgres';
  } else if (driver === 'mongo' && mongoUri) {
    log.info('Initializing MongoDB Adapter (Explicit)');
    const { MongoAdapter } = await import('./MongoAdapter.ts');
    storageInstance = new MongoAdapter(mongoUri);
    storageDriver = 'mongo';
  } else if (driver === 'memory') {
    log.info('Initializing Memory Adapter (Explicit)');
    storageInstance = new MemoryAdapter();
    storageDriver = 'memory';
  } else if (postgresUri) {
    log.info('Initializing Postgres Adapter (Auto-detected)');
    storageInstance = new PostgresAdapter(postgresUri);
    storageDriver = 'postgres';
  } else if (mongoUri) {
    log.info('Initializing MongoDB Adapter (Auto-detected)');
    const { MongoAdapter } = await import('./MongoAdapter.ts');
    storageInstance = new MongoAdapter(mongoUri);
    storageDriver = 'mongo';
  } else {
    log.warn(
      'No database configured. Falling back to In-Memory Storage (Data will be lost on restart)'
    );
    storageInstance = new MemoryAdapter();
    storageDriver = 'memory';
  }

  await storageInstance.connect();
  return storageInstance;
}

export function getStorage(): IStorageAdapter {
  if (!storageInstance) {
    throw new Error('Storage has not been initialized');
  }
  return storageInstance;
}
