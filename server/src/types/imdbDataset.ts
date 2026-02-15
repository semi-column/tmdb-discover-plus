export interface ImdbTitle {
  tconst: string;
  titleType: string;
  primaryTitle: string;
  startYear: number;
  runtimeMinutes: number;
  genres: string[];
  averageRating: number;
  numVotes: number;
}

export interface ImdbDatasetQuery {
  type: 'movie' | 'series';
  genre?: string;
  decadeStart?: number;
  decadeEnd?: number;
  sortBy: 'rating' | 'votes';
  sortOrder: 'desc' | 'asc';
  skip: number;
  limit: number;
  ratingMin?: number;
  ratingMax?: number;
  votesMin?: number;
}

export interface ImdbDatasetResult {
  items: ImdbTitle[];
  total: number;
}

export interface IImdbDatasetAdapter {
  setBatch(entries: ImdbTitle[]): Promise<void>;
  query(query: ImdbDatasetQuery): Promise<ImdbDatasetResult>;
  count(type: 'movie' | 'series'): Promise<number>;
  getGenres(type: 'movie' | 'series'): Promise<string[]>;
  getDecades(type: 'movie' | 'series'): Promise<number[]>;
  clear(): Promise<void>;
  setMeta(key: string, value: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  destroy(): Promise<void>;
}

export interface ImdbCatalogFilters {
  listType?: string;
  genre?: string;
  decadeStart?: number;
  decadeEnd?: number;
  sortBy?: string;
  ratingMin?: number;
  ratingMax?: number;
  votesMin?: number;
}

export interface ImdbCatalogConfig {
  _id: string;
  name: string;
  type: 'movie' | 'series';
  filters: ImdbCatalogFilters;
  enabled?: boolean;
}
