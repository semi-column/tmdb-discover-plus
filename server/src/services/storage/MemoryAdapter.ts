import { StorageInterface } from './StorageInterface.ts';
import { createLogger } from '../../utils/logger.ts';
import type { UserConfig, PublicStats } from '../../types/index.ts';

const log = createLogger('MemoryAdapter');

export class MemoryAdapter extends StorageInterface {
  private users: Map<string, UserConfig>;
  private configs: Map<string, UserConfig[]>;

  constructor() {
    super();
    this.users = new Map();
    this.configs = new Map();
  }

  async connect(): Promise<void> {
    log.info('Connected to In-Memory Storage');
  }

  async disconnect(): Promise<void> {
    this.users.clear();
    this.configs.clear();
  }

  async getUserConfig(userId: string): Promise<UserConfig | null> {
    return this.users.get(userId) || null;
  }

  async saveUserConfig(config: UserConfig): Promise<UserConfig> {
    this.users.set(config.userId, config);

    if (config.apiKeyId) {
      const oldList = this.configs.get(config.apiKeyId) || [];
      const newList = oldList.filter((c) => c.userId !== config.userId);
      newList.push(config);
      newList.sort(
        (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
      );
      this.configs.set(config.apiKeyId, newList);
    }

    return config;
  }

  async getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]> {
    return this.configs.get(apiKeyId) || [];
  }

  async deleteUserConfig(userId: string): Promise<boolean> {
    const config = this.users.get(userId);
    if (!config) return false;

    this.users.delete(userId);
    if (config.apiKeyId) {
      const list = this.configs.get(config.apiKeyId) || [];
      this.configs.set(
        config.apiKeyId,
        list.filter((c) => c.userId !== userId)
      );
    }
    return true;
  }

  async getPublicStats(): Promise<PublicStats> {
    const allConfigs = Array.from(this.users.values());
    const totalUsers = new Set(allConfigs.map((c) => c.apiKeyId)).size;

    let totalCatalogs = 0;
    for (const config of allConfigs) {
      if (Array.isArray(config.catalogs)) {
        for (const cat of config.catalogs) {
          const type = cat.filters?.listType;
          if (!type || type === 'discover') {
            totalCatalogs++;
          }
        }
      }
    }

    return { totalUsers, totalCatalogs };
  }
}
