import pg from 'pg';
import { StorageInterface } from './StorageInterface.ts';
import { createLogger } from '../../utils/logger.ts';
import type { UserConfig, PublicStats } from '../../types/index.ts';

const log = createLogger('PostgresAdapter');
const { Pool } = pg;

export class PostgresAdapter extends StorageInterface {
  private pool: InstanceType<typeof Pool>;

  constructor(uri: string) {
    super();
    this.pool = new Pool({ connectionString: uri });
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
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
    } catch (error) {
      log.error('Postgres connection error', { error: (error as Error).message });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async getUserConfig(userId: string): Promise<UserConfig | null> {
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

  async saveUserConfig(config: UserConfig): Promise<UserConfig> {
    const userId = config.userId;
    const apiKeyId = config.apiKeyId || null;
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
    return {
      userId,
      apiKeyId,
      ...res.rows[0].data,
    } as UserConfig;
  }

  async getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]> {
    const res = await this.pool.query(
      'SELECT user_id, api_key_id, data FROM user_configs WHERE api_key_id = $1 ORDER BY updated_at DESC',
      [apiKeyId]
    );

    return res.rows.map((row: Record<string, unknown>) => ({
      userId: row.user_id as string,
      apiKeyId: row.api_key_id as string,
      ...(row.data as Record<string, unknown>),
    })) as UserConfig[];
  }

  async deleteUserConfig(userId: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM user_configs WHERE user_id = $1', [userId]);
    return (res.rowCount || 0) > 0;
  }

  async getPublicStats(): Promise<PublicStats> {
    const userResult = await this.pool.query(
      'SELECT COUNT(DISTINCT api_key_id) as count FROM user_configs'
    );
    const totalUsers = parseInt(userResult.rows[0].count, 10);
    const catalogResult = await this.pool.query(`
      SELECT COUNT(*) as count
      FROM user_configs,
      jsonb_array_elements(data->'catalogs') as cat
      WHERE (cat->'filters'->>'listType') IS NULL
         OR (cat->'filters'->>'listType') = 'discover'
    `);

    const totalCatalogs = parseInt(catalogResult.rows[0].count, 10);

    return { totalUsers, totalCatalogs };
  }
}
