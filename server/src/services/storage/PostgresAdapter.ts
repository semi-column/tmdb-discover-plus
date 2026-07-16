import pg from 'pg';
import { StorageInterface } from './StorageInterface.ts';
import { createLogger } from '../../utils/logger.ts';
import { MARKETPLACE_RANKING, MARKETPLACE_PAGINATION } from '../../constants.ts';
import { resolveSort, clampLimit, LEGACY_ANIME_SOURCES } from './searchHelpers.ts';
import type {
  UserConfig,
  PublicStats,
  MarketplaceEntry,
  MarketplaceSearchParams,
  MarketplaceSort,
} from '../../types/index.ts';

const log = createLogger('PostgresAdapter');
const { Pool } = pg;

const { W_TEXT, W_FUZZY, W_FACET, W_POP, POP_INSTALLS_WEIGHT, POP_LIKES_WEIGHT, FUZZY_THRESHOLD } =
  MARKETPLACE_RANKING;

const { TOTAL_COUNT_CAP, ADAPTER_RESPONSE_CAP } = MARKETPLACE_PAGINATION;

// Text-search configuration used consistently for both indexing (to_tsvector) and
// querying (websearch_to_tsquery) so ranking is comparable across writes/reads.
const TS_CONFIG = 'english';

// Counter fields that may be atomically incremented. Used as a hard allow-list so a
// column identifier is NEVER interpolated from caller-supplied input.
const COUNTER_COLUMNS: Record<'installs' | 'likes' | 'views', string> = {
  installs: 'installs',
  likes: 'likes',
  views: 'views',
};

// Accepts canonical UUID strings; used to avoid issuing a query with a malformed id
// (which Postgres would reject for a UUID column) and instead return "not found".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

      // Marketplace schema (consistent with user_configs DDL above).
      await client.query(`
        CREATE TABLE IF NOT EXISTS marketplace_entries (
          marketplace_id     UUID PRIMARY KEY,
          origin_user_id     VARCHAR(255) NOT NULL,
          origin_catalog_id  VARCHAR(255) NOT NULL,
          origin_config_name VARCHAR(255) DEFAULT '',
          name               TEXT NOT NULL,
          description        TEXT DEFAULT '',
          tags               TEXT[] DEFAULT '{}',
          type               VARCHAR(16) NOT NULL,
          source             VARCHAR(16) NOT NULL,
          genres             TEXT[] DEFAULT '{}',
          filter_facets      TEXT[] DEFAULT '{}',
          data               JSONB NOT NULL,
          visibility         VARCHAR(16) NOT NULL DEFAULT 'public',
          moderation         VARCHAR(16) NOT NULL DEFAULT 'active',
          likes              INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0),
          installs           INTEGER NOT NULL DEFAULT 0 CHECK (installs >= 0),
          views              INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
          trending_score     DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (trending_score >= 0),
          last_engaged_at    TIMESTAMPTZ,
          content_hash       VARCHAR(128) NOT NULL,
          published_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          schema_version     INTEGER NOT NULL DEFAULT 1,
          search_tsv         tsvector,
          UNIQUE (origin_user_id, origin_catalog_id)
        );
      `);

      // pg_trgm powers fuzzy / typo-tolerant matching on name.
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

      // Full-text ranking (name weighted A, tags B, genres C, description D),
      // fuzzy name matching, and facet/sort support (partial indexes on searchable rows only).
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mkt_tsv ON marketplace_entries USING GIN (search_tsv);
        CREATE INDEX IF NOT EXISTS idx_mkt_name_trgm ON marketplace_entries USING GIN (name gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_mkt_facets ON marketplace_entries (source, type)
          WHERE visibility = 'public' AND moderation = 'active';
        CREATE INDEX IF NOT EXISTS idx_mkt_installs ON marketplace_entries (installs DESC)
          WHERE visibility = 'public' AND moderation = 'active';
        CREATE INDEX IF NOT EXISTS idx_mkt_trending ON marketplace_entries (trending_score DESC)
          WHERE visibility = 'public' AND moderation = 'active';
        CREATE INDEX IF NOT EXISTS idx_mkt_genres ON marketplace_entries USING GIN (genres);
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS marketplace_likes (
          marketplace_id UUID NOT NULL,
          actor_user_id  VARCHAR(255) NOT NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (marketplace_id, actor_user_id)
        );
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

  // --- Marketplace persistence ---

  /**
   * Insert or update an entry, enforcing one entry per (originUserId, originCatalogId)
   * via the unique constraint. On conflict the stable marketplaceId, the original
   * publish time, and all engagement counters (likes/installs/views/trending_score/
   * last_engaged_at) are preserved while the searchable content is replaced. The
   * weighted `search_tsv` is (re)computed on every write (name A, tags B, genres C,
   * description D).
   */
  async upsertMarketplaceEntry(entry: MarketplaceEntry): Promise<MarketplaceEntry> {
    const e = entry.engagement;
    const dataJson = JSON.stringify({ filters: entry.filters, formState: entry.formState });

    const query = `
      INSERT INTO marketplace_entries (
        marketplace_id, origin_user_id, origin_catalog_id, origin_config_name,
        name, description, tags, type, source, genres, filter_facets, data,
        visibility, moderation, likes, installs, views, trending_score,
        last_engaged_at, content_hash, published_at, updated_at, schema_version,
        search_tsv
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        setweight(to_tsvector('${TS_CONFIG}', $5), 'A') ||
        setweight(to_tsvector('${TS_CONFIG}', array_to_string($7::text[], ' ')), 'B') ||
        setweight(to_tsvector('${TS_CONFIG}', array_to_string($10::text[], ' ')), 'C') ||
        setweight(to_tsvector('${TS_CONFIG}', COALESCE($6, '')), 'D')
      )
      ON CONFLICT (origin_user_id, origin_catalog_id) DO UPDATE SET
        origin_config_name = EXCLUDED.origin_config_name,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        tags = EXCLUDED.tags,
        type = EXCLUDED.type,
        source = EXCLUDED.source,
        genres = EXCLUDED.genres,
        filter_facets = EXCLUDED.filter_facets,
        data = EXCLUDED.data,
        visibility = EXCLUDED.visibility,
        moderation = EXCLUDED.moderation,
        content_hash = EXCLUDED.content_hash,
        updated_at = EXCLUDED.updated_at,
        schema_version = EXCLUDED.schema_version,
        search_tsv = EXCLUDED.search_tsv
      RETURNING *;
    `;

    const values = [
      entry.marketplaceId,
      entry.provenance.originUserId,
      entry.provenance.originCatalogId,
      entry.provenance.originConfigName ?? '',
      entry.name,
      entry.description ?? '',
      entry.tags ?? [],
      entry.type,
      entry.source,
      entry.genres ?? [],
      entry.filterFacets ?? [],
      dataJson,
      entry.visibility,
      entry.moderation,
      e.likes,
      e.installs,
      e.views,
      e.trendingScore,
      e.lastEngagedAt ?? null,
      entry.contentHash,
      entry.publishedAt,
      entry.updatedAt,
      entry.schemaVersion ?? 1,
    ];

    const res = await this.pool.query(query, values);
    return this.rowToEntry(res.rows[0]);
  }

  async deleteMarketplaceEntryByOrigin(
    originUserId: string,
    originCatalogId: string
  ): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM marketplace_entries
         WHERE origin_user_id = $1 AND origin_catalog_id = $2
       RETURNING marketplace_id`,
      [originUserId, originCatalogId]
    );
    if ((res.rowCount || 0) === 0) return false;

    // Clean up the like ledger for the removed entry (no FK cascade defined).
    const removedId = res.rows[0].marketplace_id;
    await this.pool.query('DELETE FROM marketplace_likes WHERE marketplace_id = $1', [removedId]);
    return true;
  }

  async getMarketplaceEntry(marketplaceId: string): Promise<MarketplaceEntry | null> {
    if (!UUID_RE.test(marketplaceId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM marketplace_entries WHERE marketplace_id = $1',
      [marketplaceId]
    );
    return res.rows[0] ? this.rowToEntry(res.rows[0]) : null;
  }

  /**
   * Searchable rows only (visibility='public' AND moderation='active'). When a query
   * is present, recall is the union of a full-text match (`websearch_to_tsquery`) and
   * a trigram-similarity match (`pg_trgm`) gated at FUZZY_THRESHOLD; relevance sort
   * ranks by a composite of ts_rank_cd + similarity + facet overlap + log-dampened
   * popularity. Every dynamic value is bound as a parameter ($1,$2,...); only our own
   * numeric constants are inlined (Req 20.7).
   */
  async searchMarketplaceEntries(params: MarketplaceSearchParams): Promise<MarketplaceEntry[]> {
    const { whereSql, values, qIndex } = this.buildSearchFilter(params);
    const q = (params.q ?? '').trim();
    const sort = resolveSort(params.sort, q.length > 0);

    const pageSize = clampLimit(params.limit);
    const limit = Math.min(pageSize, ADAPTER_RESPONSE_CAP);
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const offset = (page - 1) * pageSize;

    const orderBy = this.buildOrderBy(sort, qIndex);

    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const sql = `
      SELECT * FROM marketplace_entries
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const res = await this.pool.query(sql, values);
    return res.rows.map((row: Record<string, unknown>) => this.rowToEntry(row));
  }

  async countMarketplaceEntries(params: MarketplaceSearchParams): Promise<number> {
    const { whereSql, values } = this.buildSearchFilter(params);
    values.push(TOTAL_COUNT_CAP);
    const capIdx = values.length;

    // Capped count: stop scanning at TOTAL_COUNT_CAP to avoid an expensive COUNT(*).
    const sql = `
      SELECT COUNT(*)::int AS count FROM (
        SELECT 1 FROM marketplace_entries
        WHERE ${whereSql}
        LIMIT $${capIdx}
      ) sub
    `;
    const res = await this.pool.query(sql, values);
    return res.rows[0].count as number;
  }

  async incrementMarketplaceCounter(
    marketplaceId: string,
    field: 'installs' | 'likes' | 'views',
    delta: 1 | -1
  ): Promise<number> {
    const column = COUNTER_COLUMNS[field];
    if (!column) {
      throw new Error(`Invalid marketplace counter field: ${field}`);
    }

    // Atomic in-database update (read-modify-write avoided); floored at 0.
    const sql = `
      UPDATE marketplace_entries
         SET ${column} = GREATEST(0, ${column} + $2)
       WHERE marketplace_id = $1
       RETURNING ${column} AS value
    `;
    const res = await this.pool.query(sql, [marketplaceId, delta]);
    if (!res.rows[0]) {
      throw new Error(`Marketplace entry not found: ${marketplaceId}`);
    }
    return res.rows[0].value as number;
  }

  /**
   * Persist a recomputed trending score for an entry. Only finite, non-negative
   * values are stored; anything else is coerced to 0 (the column also enforces
   * `trending_score >= 0`). Returns the stored value.
   */
  async setTrendingScore(marketplaceId: string, score: number): Promise<number> {
    const safe = Number.isFinite(score) && score > 0 ? score : 0;
    const res = await this.pool.query(
      `
      UPDATE marketplace_entries
         SET trending_score = $2
       WHERE marketplace_id = $1
       RETURNING trending_score AS value
    `,
      [marketplaceId, safe]
    );
    if (!res.rows[0]) {
      throw new Error(`Marketplace entry not found: ${marketplaceId}`);
    }
    return res.rows[0].value as number;
  }

  async recordLike(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO marketplace_likes (marketplace_id, actor_user_id)
         VALUES ($1, $2)
       ON CONFLICT (marketplace_id, actor_user_id) DO NOTHING`,
      [marketplaceId, actorUserId]
    );
    return (res.rowCount || 0) > 0;
  }

  async removeLike(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM marketplace_likes WHERE marketplace_id = $1 AND actor_user_id = $2',
      [marketplaceId, actorUserId]
    );
    return (res.rowCount || 0) > 0;
  }

  async hasLiked(marketplaceId: string, actorUserId: string): Promise<boolean> {
    const res = await this.pool.query(
      'SELECT 1 FROM marketplace_likes WHERE marketplace_id = $1 AND actor_user_id = $2 LIMIT 1',
      [marketplaceId, actorUserId]
    );
    return res.rows.length > 0;
  }

  // --- Internal marketplace helpers ---

  /** Map a marketplace_entries row to the public MarketplaceEntry shape. */
  private rowToEntry(row: Record<string, unknown>): MarketplaceEntry {
    const data = (row.data as { filters?: unknown; formState?: unknown } | null) ?? {};
    return {
      marketplaceId: row.marketplace_id as string,
      provenance: {
        originUserId: row.origin_user_id as string,
        originCatalogId: row.origin_catalog_id as string,
        originConfigName: (row.origin_config_name as string) || undefined,
      },
      name: row.name as string,
      description: (row.description as string) ?? undefined,
      tags: (row.tags as string[]) ?? [],
      type: row.type as MarketplaceEntry['type'],
      source: row.source as MarketplaceEntry['source'],
      genres: (row.genres as string[]) ?? [],
      filterFacets: (row.filter_facets as string[]) ?? [],
      filters: (data.filters as MarketplaceEntry['filters']) ?? ({} as MarketplaceEntry['filters']),
      formState: (data.formState as MarketplaceEntry['formState']) ?? undefined,
      visibility: row.visibility as MarketplaceEntry['visibility'],
      moderation: row.moderation as MarketplaceEntry['moderation'],
      engagement: {
        likes: row.likes as number,
        installs: row.installs as number,
        views: row.views as number,
        trendingScore: row.trending_score as number,
        lastEngagedAt: (row.last_engaged_at as Date) ?? undefined,
      },
      contentHash: row.content_hash as string,
      publishedAt: row.published_at as Date,
      updatedAt: row.updated_at as Date,
      schemaVersion: row.schema_version as number,
    };
  }

  /**
   * Build the parameterized WHERE clause shared by search and count. Returns the
   * accumulated bind values and the 1-based index of the bound query string (or null
   * when no query was supplied) so the caller can reuse it in the score/order clause.
   */
  private buildSearchFilter(params: MarketplaceSearchParams): {
    whereSql: string;
    values: unknown[];
    qIndex: number | null;
  } {
    const conditions: string[] = [`visibility = 'public'`, `moderation = 'active'`];
    const values: unknown[] = [];
    let qIndex: number | null = null;

    const q = (params.q ?? '').trim();
    if (q) {
      values.push(q);
      qIndex = values.length;
      conditions.push(
        `(search_tsv @@ websearch_to_tsquery('${TS_CONFIG}', $${qIndex})` +
          ` OR similarity(name, $${qIndex}) >= ${FUZZY_THRESHOLD})`
      );
    }

    const facets = params.facets;
    if (facets?.source) {
      const sources = Array.isArray(facets.source) ? facets.source : [facets.source];
      if (sources.length > 1) {
        values.push(sources);
        conditions.push(`source = ANY($${values.length}::text[])`);
      } else {
        values.push(sources[0]);
        conditions.push(`source = $${values.length}`);
      }
    }
    if (facets?.type === 'anime') {
      values.push('anime');
      const animeTypeIdx = values.length;
      values.push([...LEGACY_ANIME_SOURCES]);
      const legacySourcesIdx = values.length;
      conditions.push(
        `(type = $${animeTypeIdx} OR (type = 'series' AND source = ANY($${legacySourcesIdx}::text[])))`
      );
    } else if (facets?.type) {
      values.push(facets.type);
      conditions.push(`type = $${values.length}`);
    }
    if (facets?.genres && facets.genres.length) {
      values.push(facets.genres);
      conditions.push(`genres @> $${values.length}::text[]`);
    }

    return { whereSql: conditions.join(' AND '), values, qIndex };
  }

  /** Resolve the ORDER BY clause for a sort mode with a stable marketplace_id tiebreak. */
  private buildOrderBy(sort: MarketplaceSort, qIndex: number | null): string {
    const tiebreak = 'marketplace_id ASC';
    switch (sort) {
      case 'relevance':
        // Relevance requires a query; without one, fall back to trending order.
        return qIndex == null
          ? `trending_score DESC, ${tiebreak}`
          : `(${this.scoreExpr(qIndex)}) DESC, ${tiebreak}`;
      case 'popular':
        return `likes DESC, installs DESC, ${tiebreak}`;
      case 'most-installed':
        return `installs DESC, ${tiebreak}`;
      case 'newest':
        return `published_at DESC, ${tiebreak}`;
      case 'trending':
      default:
        return `trending_score DESC, ${tiebreak}`;
    }
  }

  /**
   * Composite relevance score (SQL form of the design's scoring formula):
   *   W_TEXT  * ts_rank_cd(full-text)
   * + W_FUZZY * trigram similarity(name, q)
   * + W_FACET * trigram similarity(facet text, q)
   * + W_POP   * (log10(1+installs)*0.6 + log10(1+likes)*0.4)
   * Only the bound query parameter is dynamic; weights are our own constants.
   */
  private scoreExpr(qIndex: number): string {
    const q = `$${qIndex}`;
    return (
      `${W_TEXT} * ts_rank_cd(search_tsv, websearch_to_tsquery('${TS_CONFIG}', ${q}))` +
      ` + ${W_FUZZY} * similarity(name, ${q})` +
      ` + ${W_FACET} * similarity(` +
      `COALESCE(array_to_string(genres, ' '), '') || ' ' || source || ' ' || type, ${q})` +
      ` + ${W_POP} * (log((1 + installs)::numeric) * ${POP_INSTALLS_WEIGHT}` +
      ` + log((1 + likes)::numeric) * ${POP_LIKES_WEIGHT})`
    );
  }
}
