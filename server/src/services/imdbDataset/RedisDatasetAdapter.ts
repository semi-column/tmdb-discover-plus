import { createClient, type RedisClientType } from 'redis';
import { ImdbDatasetAdapter } from './ImdbDatasetAdapter.ts';
import type { ImdbTitle, ImdbDatasetQuery, ImdbDatasetResult } from '../../types/imdbDataset.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('ImdbDataset:Redis');

const TITLES_HASH = 'imdb:dataset:titles';
const META_HASH = 'imdb:dataset:meta';
const GENRES_KEY = 'imdb:dataset:genres';
const DECADES_KEY = 'imdb:dataset:decades';
const REGIONS_KEY = 'imdb:dataset:regions';
const PIPELINE_BATCH = 10000;

const TITLE_TYPE_TO_STREMIO: Record<string, string> = {
  movie: 'movie',
  tvMovie: 'movie',
  tvSpecial: 'movie',
  video: 'movie',
  tvSeries: 'series',
  tvMiniSeries: 'series',
};

function mapType(titleType: string): string | null {
  return TITLE_TYPE_TO_STREMIO[titleType] || null;
}

function getDecade(year: number): number {
  return Math.floor(year / 10) * 10;
}

function ratingScore(item: ImdbTitle): number {
  return item.averageRating * 10_000_000_000 + item.numVotes;
}

function votesScore(item: ImdbTitle): number {
  return item.numVotes * 10 + item.averageRating;
}

function sortedSetKey(type: string, sortBy: string): string {
  return `imdb:dataset:${type}:by${sortBy === 'votes' ? 'Votes' : 'Rating'}`;
}

function genreSortedSetKey(type: string, genre: string, sortBy: string): string {
  return `imdb:dataset:${type}:genre:${genre}:by${sortBy === 'votes' ? 'Votes' : 'Rating'}`;
}

function decadeSortedSetKey(type: string, decade: number, sortBy: string): string {
  return `imdb:dataset:${type}:decade:${decade}:by${sortBy === 'votes' ? 'Votes' : 'Rating'}`;
}

function regionSortedSetKey(type: string, region: string, sortBy: string): string {
  return `imdb:dataset:${type}:region:${region}:by${sortBy === 'votes' ? 'Votes' : 'Rating'}`;
}

export class RedisDatasetAdapter extends ImdbDatasetAdapter {
  private client: ReturnType<typeof createClient>;

  constructor(redisUrl: string) {
    super();
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (err: Error) =>
      log.error('Redis client error', { error: err.message })
    );
  }

  async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
      log.info('Connected to Redis for IMDB dataset');
    }
  }

  _ensureReady() {
    if (!this.client.isOpen) {
      throw new Error('Redis client is not connected');
    }
  }

  async setBatch(entries: ImdbTitle[]): Promise<void> {
    this._ensureReady();

    const genresSet = new Set<string>();
    const decadesSet = new Set<string>();
    const regionsSet = new Set<string>();

    for (let i = 0; i < entries.length; i += PIPELINE_BATCH) {
      const batch = entries.slice(i, i + PIPELINE_BATCH);
      const pipeline = this.client.multi();

      for (const item of batch) {
        const type = mapType(item.titleType);
        if (!type) continue;

        pipeline.hSet(TITLES_HASH, item.tconst, JSON.stringify(item));

        const rScore = ratingScore(item);
        const vScore = votesScore(item);

        pipeline.zAdd(sortedSetKey(type, 'rating'), { score: rScore, value: item.tconst });
        pipeline.zAdd(sortedSetKey(type, 'votes'), { score: vScore, value: item.tconst });

        for (const genre of item.genres) {
          pipeline.zAdd(genreSortedSetKey(type, genre, 'rating'), {
            score: rScore,
            value: item.tconst,
          });
          pipeline.zAdd(genreSortedSetKey(type, genre, 'votes'), {
            score: vScore,
            value: item.tconst,
          });
          genresSet.add(`${type}:${genre}`);
        }

        if (item.startYear) {
          const decade = getDecade(item.startYear);
          pipeline.zAdd(decadeSortedSetKey(type, decade, 'rating'), {
            score: rScore,
            value: item.tconst,
          });
          pipeline.zAdd(decadeSortedSetKey(type, decade, 'votes'), {
            score: vScore,
            value: item.tconst,
          });
          decadesSet.add(`${type}:${decade}`);
        }

        for (const region of item.regions || []) {
          pipeline.zAdd(regionSortedSetKey(type, region, 'rating'), {
            score: rScore,
            value: item.tconst,
          });
          pipeline.zAdd(regionSortedSetKey(type, region, 'votes'), {
            score: vScore,
            value: item.tconst,
          });
          regionsSet.add(`${type}:${region}`);
        }
      }

      await pipeline.exec();
    }

    if (genresSet.size > 0) {
      const pipeline = this.client.multi();
      for (const entry of genresSet) {
        pipeline.sAdd(GENRES_KEY, entry as string);
      }
      await pipeline.exec();
    }

    if (decadesSet.size > 0) {
      const pipeline = this.client.multi();
      for (const entry of decadesSet) {
        pipeline.sAdd(DECADES_KEY, entry as string);
      }
      await pipeline.exec();
    }

    if (regionsSet.size > 0) {
      const pipeline = this.client.multi();
      for (const entry of regionsSet) {
        pipeline.sAdd(REGIONS_KEY, entry as string);
      }
      await pipeline.exec();
    }
  }

  async query(q: ImdbDatasetQuery): Promise<ImdbDatasetResult> {
    this._ensureReady();

    const needsPostFilter =
      q.ratingMin !== undefined ||
      q.ratingMax !== undefined ||
      q.votesMin !== undefined ||
      (q.decadeEnd !== undefined && q.decadeStart !== undefined) ||
      (q.region && q.genre);

    let key: string;
    if (q.region) {
      key = regionSortedSetKey(q.type, q.region, q.sortBy || 'rating');
    } else if (q.genre) {
      key = genreSortedSetKey(q.type, q.genre, q.sortBy || 'rating');
    } else if (q.decadeStart !== undefined) {
      key = decadeSortedSetKey(q.type, q.decadeStart, q.sortBy || 'rating');
    } else {
      key = sortedSetKey(q.type, q.sortBy || 'rating');
    }

    if (needsPostFilter) {
      const allIds =
        q.sortOrder === 'asc'
          ? await this.client.zRange(key, 0, -1)
          : await this.client.zRange(key, 0, -1, { REV: true });

      if (allIds.length === 0) return { items: [], total: 0 };

      const allRaw = await this.client.hmGet(TITLES_HASH, allIds);
      let filtered = allRaw
        .filter((v): v is string => v !== null)
        .map((raw: string) => JSON.parse(raw))
        .filter((item: ImdbTitle) => {
          if (q.ratingMin !== undefined && item.averageRating < q.ratingMin) return false;
          if (q.ratingMax !== undefined && item.averageRating > q.ratingMax) return false;
          if (q.votesMin !== undefined && item.numVotes < q.votesMin) return false;
          if (q.decadeEnd !== undefined && q.decadeStart !== undefined) {
            if (item.startYear < q.decadeStart || item.startYear > q.decadeEnd + 9) return false;
          }
          if (q.region && q.genre && !item.genres.includes(q.genre)) return false;
          return true;
        });

      const total = filtered.length;
      const items = filtered.slice(q.skip, q.skip + q.limit);
      return { items, total };
    }

    const total = await this.client.zCard(key);

    const ids =
      q.sortOrder === 'asc'
        ? await this.client.zRange(key, q.skip, q.skip + q.limit - 1)
        : await this.client.zRange(key, q.skip, q.skip + q.limit - 1, { REV: true });

    if (ids.length === 0) return { items: [], total };

    const rawItems = await this.client.hmGet(TITLES_HASH, ids);
    const items = rawItems.filter((v): v is string => v !== null).map((raw) => JSON.parse(raw));

    return { items, total };
  }

  async count(type: string): Promise<number> {
    this._ensureReady();
    try {
      return await this.client.zCard(sortedSetKey(type, 'rating'));
    } catch (e: any) {
      log.debug('Redis count failed', { error: e.message });
      return 0;
    }
  }

  async getGenres(type: string): Promise<string[]> {
    this._ensureReady();
    try {
      const members = await this.client.sMembers(GENRES_KEY);
      const prefix = `${type}:`;
      return members
        .filter((m: string) => m.startsWith(prefix))
        .map((m: string) => m.slice(prefix.length))
        .sort();
    } catch (e: any) {
      log.debug('Redis getGenres failed', { error: e.message });
      return [];
    }
  }

  async getDecades(type: string): Promise<number[]> {
    this._ensureReady();
    try {
      const members = await this.client.sMembers(DECADES_KEY);
      const prefix = `${type}:`;
      return members
        .filter((m: string) => m.startsWith(prefix))
        .map((m: string) => parseInt(m.slice(prefix.length), 10))
        .sort((a: number, b: number) => b - a);
    } catch (e: any) {
      log.debug('Redis getDecades failed', { error: e.message });
      return [];
    }
  }

  async getRegions(type: string): Promise<string[]> {
    this._ensureReady();
    try {
      const members = await this.client.sMembers(REGIONS_KEY);
      const prefix = `${type}:`;
      return members
        .filter((m: string) => m.startsWith(prefix))
        .map((m: string) => m.slice(prefix.length))
        .sort();
    } catch (e: any) {
      log.debug('Redis getRegions failed', { error: e.message });
      return [];
    }
  }

  async clear() {
    this._ensureReady();

    const keys: string[] = [];
    for await (const key of this.client.scanIterator({ MATCH: 'imdb:dataset:*', COUNT: 1000 })) {
      if (Array.isArray(key)) {
        keys.push(...key);
      } else {
        keys.push(key);
      }
    }

    if (keys.length > 0) {
      for (let i = 0; i < keys.length; i += 1000) {
        await this.client.del(keys.slice(i, i + 1000));
      }
    }
  }

  async setMeta(key: string, value: string): Promise<void> {
    this._ensureReady();
    await this.client.hSet(META_HASH, key, value);
  }

  async getMeta(key: string): Promise<string | null> {
    this._ensureReady();
    try {
      const val = await this.client.hGet(META_HASH, key);
      return val ?? null;
    } catch (e: any) {
      log.debug('Redis getMeta failed', { key, error: e.message });
      return null;
    }
  }

  async destroy() {
    try {
      if (this.client.isOpen) {
        await this.client.quit();
        log.info('Redis connection closed');
      }
    } catch (err: any) {
      log.warn('Error closing Redis connection', { error: err.message });
    }
  }
}
