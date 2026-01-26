import { StorageInterface } from './StorageInterface.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('MemoryAdapter');

export class MemoryAdapter extends StorageInterface {
  constructor() {
    super();
    this.users = new Map(); // userId -> config
    this.configs = new Map(); // apiKeyId -> [configs]
  }

  async connect() {
    log.info('Connected to In-Memory Storage');
    return true;
  }

  async disconnect() {
    this.users.clear();
    this.configs.clear();
  }

  async getUserConfig(userId) {
    return this.users.get(userId) || null;
  }

  async saveUserConfig(config) {
    this.users.set(config.userId, config);
    
    // Update secondary index (apiKeyId)
    if (config.apiKeyId) {
        // Remove old entry for this user from the list if it exists
        const oldList = this.configs.get(config.apiKeyId) || [];
        const newList = oldList.filter(c => c.userId !== config.userId);
        newList.push(config);
        // Sort by updatedAt desc
        newList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        this.configs.set(config.apiKeyId, newList);
    }
    
    return config;
  }

  async getConfigsByApiKeyId(apiKeyId) {
    return this.configs.get(apiKeyId) || [];
  }

  async deleteUserConfig(userId) {
    const config = this.users.get(userId);
    if (!config) return false;

    this.users.delete(userId);
    if (config.apiKeyId) {
        const list = this.configs.get(config.apiKeyId) || [];
        this.configs.set(config.apiKeyId, list.filter(c => c.userId !== userId));
    }
    return true;
  }
  
  async getPublicStats() {
      const allConfigs = Array.from(this.users.values());
      const totalUsers = new Set(allConfigs.map(c => c.apiKeyId)).size;
      
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
