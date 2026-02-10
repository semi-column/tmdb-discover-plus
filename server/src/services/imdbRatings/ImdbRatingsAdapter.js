/**
 * Interface for IMDb Ratings storage backends.
 * Implementations must support bulk writes and single/batch lookups.
 */
export class ImdbRatingsAdapter {
  /**
   * Store a single rating entry.
   * @param {string} imdbId - e.g. "tt0133093"
   * @param {string} value  - e.g. "8.7|1234567"
   * @returns {Promise<void>}
   */
  async set(imdbId, value) {
    throw new Error('Not implemented');
  }

  /**
   * Retrieve a single rating.
   * @param {string} imdbId
   * @returns {Promise<string|null>} "rating|votes" or null
   */
  async get(imdbId) {
    throw new Error('Not implemented');
  }

  /**
   * Retrieve ratings for multiple IDs in one call.
   * @param {string[]} imdbIds
   * @returns {Promise<Map<string, string>>} Map of imdbId → "rating|votes"
   */
  async getMany(imdbIds) {
    throw new Error('Not implemented');
  }

  /**
   * Execute a batch of set operations efficiently.
   * @param {Array<[string, string]>} entries - Array of [imdbId, "rating|votes"]
   * @returns {Promise<void>}
   */
  async setBatch(entries) {
    throw new Error('Not implemented');
  }

  /**
   * Remove all stored ratings (before a fresh import).
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('Not implemented');
  }

  /**
   * Get the total number of stored ratings.
   * @returns {Promise<number>}
   */
  async count() {
    throw new Error('Not implemented');
  }

  /**
   * Store a metadata value (e.g. ETag, last update timestamp).
   * @param {string} key
   * @param {string} value
   * @returns {Promise<void>}
   */
  async setMeta(key, value) {
    throw new Error('Not implemented');
  }

  /**
   * Retrieve a metadata value.
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  async getMeta(key) {
    throw new Error('Not implemented');
  }

  /**
   * Delete a metadata value.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delMeta(key) {
    throw new Error('Not implemented');
  }

  /**
   * Clean up resources (close connections, etc.).
   * @returns {Promise<void>}
   */
  async destroy() {
    // Default no-op
  }
}
