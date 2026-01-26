/**
 * Interface that all storage adapters must implement.
 * This documents the contract for database operations.
 */
export class StorageInterface {
  async connect() { throw new Error('Not implemented'); }
  async disconnect() { throw new Error('Not implemented'); }
  
  /**
   * Get user config by User ID
   * @param {string} userId 
   * @returns {Promise<Object|null>}
   */
  async getUserConfig(userId) { throw new Error('Not implemented'); }

  /**
   * Save user config
   * @param {Object} config 
   * @returns {Promise<Object>}
   */
  async saveUserConfig(config) { throw new Error('Not implemented'); }

  /**
   * Get configs by API Key ID (HMAC)
   * @param {string} apiKeyId 
   * @returns {Promise<Array>}
   */
  async getConfigsByApiKeyId(apiKeyId) { throw new Error('Not implemented'); }

  /**
   * Delete user config
   * @param {string} userId 
   * @returns {Promise<boolean>}
   */
  async deleteUserConfig(userId) { throw new Error('Not implemented'); }

  /**
   * Get public stats
   * @returns {Promise<{totalUsers: number, totalCatalogs: number}>}
   */
  async getPublicStats() { throw new Error('Not implemented'); }
}
