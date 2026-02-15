import { ImdbDatasetAdapter } from './ImdbDatasetAdapter.ts';
import type { ImdbTitle, ImdbDatasetQuery, ImdbDatasetResult } from '../../types/imdbDataset.ts';
import { createLogger } from '../../utils/logger.ts';

const log = createLogger('ImdbDataset:Memory');

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

type GenreIndex = { movie: Map<string, ImdbTitle[]>; series: Map<string, ImdbTitle[]> };
type DecadeIndex = { movie: Map<number, ImdbTitle[]>; series: Map<number, ImdbTitle[]> };

export class MemoryDatasetAdapter extends ImdbDatasetAdapter {
  private moviesByRating: ImdbTitle[] = [];
  private moviesByVotes: ImdbTitle[] = [];
  private seriesByRating: ImdbTitle[] = [];
  private seriesByVotes: ImdbTitle[] = [];
  private genreIndex: GenreIndex = { movie: new Map(), series: new Map() };
  private decadeIndex: DecadeIndex = { movie: new Map(), series: new Map() };
  private meta: Map<string, string> = new Map();

  constructor() {
    super();
  }

  async setBatch(entries: ImdbTitle[]): Promise<void> {
    const movies = [];
    const series = [];

    for (const entry of entries) {
      const type = mapType(entry.titleType);
      if (!type) continue;
      if (type === 'movie') movies.push(entry);
      else series.push(entry);
    }

    this.moviesByRating.push(...movies);
    this.seriesByRating.push(...series);

    for (const item of movies) {
      for (const genre of item.genres) {
        if (!this.genreIndex.movie.has(genre)) this.genreIndex.movie.set(genre, []);
        this.genreIndex.movie.get(genre)!.push(item);
      }
      if (item.startYear) {
        const decade = getDecade(item.startYear);
        if (!this.decadeIndex.movie.has(decade)) this.decadeIndex.movie.set(decade, []);
        this.decadeIndex.movie.get(decade)!.push(item);
      }
    }

    for (const item of series) {
      for (const genre of item.genres) {
        if (!this.genreIndex.series.has(genre)) this.genreIndex.series.set(genre, []);
        this.genreIndex.series.get(genre)!.push(item);
      }
      if (item.startYear) {
        const decade = getDecade(item.startYear);
        if (!this.decadeIndex.series.has(decade)) this.decadeIndex.series.set(decade, []);
        this.decadeIndex.series.get(decade)!.push(item);
      }
    }
  }

  _finalize(): void {
    const byRating = (a: ImdbTitle, b: ImdbTitle) =>
      b.averageRating - a.averageRating || b.numVotes - a.numVotes;
    const byVotes = (a: ImdbTitle, b: ImdbTitle) =>
      b.numVotes - a.numVotes || b.averageRating - a.averageRating;

    this.moviesByRating.sort(byRating);
    this.seriesByRating.sort(byRating);
    this.moviesByVotes = [...this.moviesByRating].sort(byVotes);
    this.seriesByVotes = [...this.seriesByRating].sort(byVotes);

    for (const [, items] of this.genreIndex.movie) items.sort(byRating);
    for (const [, items] of this.genreIndex.series) items.sort(byRating);
    for (const [, items] of this.decadeIndex.movie) items.sort(byRating);
    for (const [, items] of this.decadeIndex.series) items.sort(byRating);
  }

  async query(q: ImdbDatasetQuery): Promise<ImdbDatasetResult> {
    const type = q.type as 'movie' | 'series';
    let source: ImdbTitle[];

    if (q.genre) {
      const genreItems = this.genreIndex[type]?.get(q.genre);
      source = genreItems || [];
    } else if (q.decadeStart !== undefined) {
      const decadeItems = this.decadeIndex[type]?.get(q.decadeStart);
      source = decadeItems || [];
    } else if (q.sortBy === 'votes') {
      source = q.type === 'movie' ? this.moviesByVotes : this.seriesByVotes;
    } else {
      source = q.type === 'movie' ? this.moviesByRating : this.seriesByRating;
    }

    let filtered = source;

    if (q.ratingMin !== undefined || q.ratingMax !== undefined || q.votesMin !== undefined) {
      filtered = source.filter((item) => {
        if (q.ratingMin !== undefined && item.averageRating < q.ratingMin) return false;
        if (q.ratingMax !== undefined && item.averageRating > q.ratingMax) return false;
        if (q.votesMin !== undefined && item.numVotes < q.votesMin) return false;
        return true;
      });
    }

    if (q.decadeEnd !== undefined && q.decadeStart !== undefined && !q.genre) {
      filtered = filtered.filter(
        (item) => item.startYear >= q.decadeStart! && item.startYear <= q.decadeEnd!
      );
    }

    if (q.sortBy === 'votes' && (q.genre || q.decadeStart !== undefined)) {
      filtered = [...filtered].sort(
        (a, b) => b.numVotes - a.numVotes || b.averageRating - a.averageRating
      );
    }

    if (q.sortOrder === 'asc') {
      filtered = [...filtered].reverse();
    }

    const total = filtered.length;
    const items = filtered.slice(q.skip, q.skip + q.limit);

    return { items, total };
  }

  async count(type: string): Promise<number> {
    return type === 'movie' ? this.moviesByRating.length : this.seriesByRating.length;
  }

  async getGenres(type: string): Promise<string[]> {
    const t = type as 'movie' | 'series';
    return [...(this.genreIndex[t]?.keys() || [])].sort();
  }

  async getDecades(type: string): Promise<number[]> {
    const t = type as 'movie' | 'series';
    return [...(this.decadeIndex[t]?.keys() || [])].sort((a, b) => b - a);
  }

  async clear() {
    this.moviesByRating = [];
    this.moviesByVotes = [];
    this.seriesByRating = [];
    this.seriesByVotes = [];
    this.genreIndex = { movie: new Map(), series: new Map() };
    this.decadeIndex = { movie: new Map(), series: new Map() };
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }

  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async destroy() {
    await this.clear();
    this.meta.clear();
    log.info('Memory dataset adapter destroyed');
  }
}
