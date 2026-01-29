import pg from 'pg';
import { StorageInterface } from './StorageInterface.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('PostgresAdapter');
const { Pool } = pg;

export class PostgresAdapter extends StorageInterface {
  constructor(uri) {
    super();
    this.pool = new Pool({ connectionString: uri });
  }

  async connect() {
    try {
      // Test connection
      const client = await this.pool.connect();

      // Ensure schema exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_configs (
          user_id VARCHAR(255) PRIMARY KEY,
          api_key_id VARCHAR(255),
          data JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_api_key_id ON user_configs(api_key_id);
      `);

      client.release();
      log.info('Connected to Postgres and verified schema');
      return true;
    } catch (error) {
      log.error('Postgres connection error', { error: error.message });
      throw error;
    }
  }

  async disconnect() {
    await this.pool.end();
  }

  async getUserConfig(userId) {
    const res = await this.pool.query(
      'SELECT user_id, api_key_id, data FROM user_configs WHERE user_id = $1',
      [userId]
    );
    if (!res.rows[0]) return null;

    const { user_id, api_key_id, data } = res.rows[0];
    return {
      userId: user_id,
      apiKeyId: api_key_id,
      ...data,
    };
  }

  async saveUserConfig(config) {
    const userId = config.userId;
    const apiKeyId = config.apiKeyId || null;

    // Create a copy for JSONB storage but exclude the promoted columns to save space/duplication
    const { userId: _, apiKeyId: __, ...dataToStore } = config;
    const data = JSON.stringify(dataToStore);

    const query = `
      INSERT INTO user_configs (user_id, api_key_id, data, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        api_key_id = EXCLUDED.api_key_id,
        data = EXCLUDED.data,
        updated_at = NOW()
      RETURNING data;
    `;

    const res = await this.pool.query(query, [userId, apiKeyId, data]);

    // Merge back the ID fields so the application logic receives the full object as expected
    return {
      userId,
      apiKeyId,
      ...res.rows[0].data,
    };
  }

  async getConfigsByApiKeyId(apiKeyId) {
    // Postgres JSONB query might be slower if we don't index specific fields,
    // but here we just return the full objects based on the indexed api_key_id column.
    const res = await this.pool.query(
      'SELECT user_id, api_key_id, data FROM user_configs WHERE api_key_id = $1 ORDER BY updated_at DESC',
      [apiKeyId]
    );

    return res.rows.map((row) => ({
      userId: row.user_id,
      apiKeyId: row.api_key_id,
      ...row.data,
    }));
  }

  async deleteUserConfig(userId) {
    const res = await this.pool.query('DELETE FROM user_configs WHERE user_id = $1', [userId]);
    return (res.rowCount || 0) > 0;
  }

  async getPublicStats() {
    // Count unique users by api_key_id
    const userResult = await this.pool.query(
      'SELECT COUNT(DISTINCT api_key_id) as count FROM user_configs'
    );
    const totalUsers = parseInt(userResult.rows[0].count, 10);

    // For catalogs, we need to inspect the JSONB array.
    // This query unwraps the catalogs array and counts objects where listType is 'discover'
    // Note: This relies on Postgres JSONB operators.
    const catalogResult = await this.pool.query(`
      SELECT COUNT(*) as count
      FROM user_configs,
      jsonb_array_elements(data->'catalogs') as cat
      WHERE (cat->'filters'->>'listType') = 'discover'
    `);

    const totalCatalogs = parseInt(catalogResult.rows[0].count, 10);

    return { totalUsers, totalCatalogs };
  }
}
