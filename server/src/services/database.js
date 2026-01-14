import mongoose from 'mongoose';
import { createLogger } from '../utils/logger.js';

const log = createLogger('database');

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    log.warn('MONGODB_URI not set - running in memory-only mode');
    log.warn('User configurations will not persist across restarts');
    return null;
  }

  try {
    await mongoose.connect(uri);
    log.info('Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    log.error('MongoDB connection error', { error: error.message });
    log.warn('Running in memory-only mode');
    return null;
  }
}

export function isConnected() {
  return mongoose.connection.readyState === 1;
}
