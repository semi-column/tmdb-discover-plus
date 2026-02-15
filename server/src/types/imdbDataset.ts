export interface ImdbTitle {
  tconst: string;
  titleType: string;
  primaryTitle: string;
  startYear: number;
  runtimeMinutes: number;
  genres: string[];
  averageRating: number;
  numVotes: number;
  regions: string[];
}

export interface ImdbDatasetQuery {
  type: 'movie' | 'series';
  genre?: string;
  region?: string;
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
  getRegions(type: 'movie' | 'series'): Promise<string[]>;
  clear(): Promise<void>;
  setMeta(key: string, value: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  destroy(): Promise<void>;
}

export interface ImdbCatalogFilters {
  listType?: string;
  genre?: string;
  region?: string;
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
