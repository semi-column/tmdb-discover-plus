/**
 * Interface for Cache operations
 */
export class CacheInterface {
  /**
   * Get a value from cache
   * @param {string} key 
   * @returns {Promise<any>}
   */
  async get(key) { throw new Error('Not implemented'); }

  /**
   * Set a value in cache
   * @param {string} key 
   * @param {any} value 
   * @param {number} ttlSeconds 
   */
  async set(key, value, ttlSeconds) { throw new Error('Not implemented'); }

  /**
   * Delete a value from cache
   * @param {string} key 
   */
  async del(key) { throw new Error('Not implemented'); }
}
