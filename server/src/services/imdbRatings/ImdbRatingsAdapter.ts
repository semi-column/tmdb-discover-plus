import type { IImdbRatingsAdapter } from '../../types/index.ts';

export abstract class ImdbRatingsAdapter implements IImdbRatingsAdapter {
  abstract set(imdbId: string, value: string): Promise<void>;
  abstract get(imdbId: string): Promise<string | null>;
  abstract getMany(imdbIds: string[]): Promise<Map<string, string>>;
  abstract setBatch(entries: [string, string][]): Promise<void>;
  abstract replaceAll(entries: [string, string][]): Promise<void>;
  abstract clear(): Promise<void>;
  abstract count(): Promise<number>;
  abstract setMeta(key: string, value: string): Promise<void>;
  abstract getMeta(key: string): Promise<string | null>;
  abstract delMeta(key: string): Promise<void>;

  async destroy(): Promise<void> {}
}
