import type {
  ImdbTitle,
  ImdbDatasetQuery,
  ImdbDatasetResult,
  IImdbDatasetAdapter,
} from '../../types/imdbDataset.ts';

export abstract class ImdbDatasetAdapter implements IImdbDatasetAdapter {
  abstract setBatch(entries: ImdbTitle[]): Promise<void>;
  abstract query(query: ImdbDatasetQuery): Promise<ImdbDatasetResult>;
  abstract count(type: 'movie' | 'series'): Promise<number>;
  abstract getGenres(type: 'movie' | 'series'): Promise<string[]>;
  abstract getDecades(type: 'movie' | 'series'): Promise<number[]>;
  abstract getRegions(type: 'movie' | 'series'): Promise<string[]>;
  abstract clear(): Promise<void>;
  abstract setMeta(key: string, value: string): Promise<void>;
  abstract getMeta(key: string): Promise<string | null>;

  _finalize?(): void;
  async destroy(): Promise<void> {}
}
