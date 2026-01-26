import mongoose from 'mongoose';
import { StorageInterface } from './StorageInterface.js';
import { UserConfig } from '../../models/UserConfig.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('MongoAdapter');

export class MongoAdapter extends StorageInterface {
  constructor(uri) {
    super();
    this.uri = uri;
  }

  async connect() {
    if (!this.uri) {
        log.warn('No MongoDB URI provided');
        return false;
    }
    try {
      await mongoose.connect(this.uri);
      log.info('Connected to MongoDB');
      return true;
    } catch (error) {
      log.error('MongoDB connection error', { error: error.message });
      throw error;
    }
  }

  async disconnect() {
    await mongoose.disconnect();
  }

  async getUserConfig(userId) {
    return UserConfig.findOne({ userId }).lean();
  }

  async saveUserConfig(config) {
    // Existing logic uses findOneAndUpdate within saveUserConfig service, 
    // but the adapter should handle the DB interaction part.
    // The higher level service handles encryption/validation logic.
    
    return UserConfig.findOneAndUpdate(
      { userId: config.userId },
      { $set: config },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
  }

  async getConfigsByApiKeyId(apiKeyId) {
    return UserConfig.find({ apiKeyId }).sort({ updatedAt: -1 }).lean();
  }

  async deleteUserConfig(userId) {
    const res = await UserConfig.findOneAndDelete({ userId });
    return !!res;
  }

  async getPublicStats() {
    const totalUsers = await UserConfig.distinct('apiKeyId').then((ids) => ids.length);
    const catalogStats = await UserConfig.aggregate([
      { $unwind: '$catalogs' },
      { 
        $match: { 
          'catalogs.filters.listType': { $in: ['discover', null] } 
        } 
      },
      { $count: 'total' },
    ]);
    const totalCatalogs = catalogStats[0]?.total || 0;
    return { totalUsers, totalCatalogs };
  }
}
