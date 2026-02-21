import mongoose from 'mongoose';
import { StorageInterface } from './StorageInterface.ts';
import { UserConfig } from '../../models/UserConfig.ts';
import { createLogger } from '../../utils/logger.ts';
import type { UserConfig as UserConfigType, PublicStats } from '../../types/index.ts';

const log = createLogger('MongoAdapter');

export class MongoAdapter extends StorageInterface {
  private uri: string;

  constructor(uri: string) {
    super();
    this.uri = uri;
  }

  async connect(): Promise<void> {
    if (!this.uri) {
      log.warn('No MongoDB URI provided');
      return;
    }
    try {
      await mongoose.connect(this.uri);
      log.info('Connected to MongoDB');
    } catch (error) {
      log.error('MongoDB connection error', { error: (error as Error).message });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();
  }

  async getUserConfig(userId: string): Promise<UserConfigType | null> {
    if (!userId) return null;
    return UserConfig.findOne({ userId: String(userId) }).lean().exec() as unknown as Promise<UserConfigType | null>;
  }

  async saveUserConfig(config: UserConfigType): Promise<UserConfigType> {
    return UserConfig.findOneAndUpdate(
      { userId: String(config.userId) },
      { $set: config },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean().exec() as unknown as Promise<UserConfigType>;
  }

  async getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfigType[]> {
    if (!apiKeyId) return [];
    return UserConfig.find({ apiKeyId: String(apiKeyId) })
      .sort({ updatedAt: -1 })
      .lean().exec() as unknown as Promise<UserConfigType[]>;
  }

  async deleteUserConfig(userId: string): Promise<boolean> {
    if (!userId) return false;
    const res = await UserConfig.findOneAndDelete({ userId: String(userId) });
    return !!res;
  }

  async getPublicStats(): Promise<PublicStats> {
    const totalUsers = await UserConfig.distinct('apiKeyId').then((ids: string[]) => ids.length);
    const catalogStats = await UserConfig.aggregate([
      { $unwind: '$catalogs' },
      {
        $match: {
          'catalogs.filters.listType': { $in: ['discover', null] },
        },
      },
      { $count: 'total' },
    ]);
    const totalCatalogs = catalogStats[0]?.total || 0;
    return { totalUsers, totalCatalogs };
  }
}
