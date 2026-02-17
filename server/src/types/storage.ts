import type { UserConfig } from './config.ts';

export interface IStorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getUserConfig(userId: string): Promise<UserConfig | null>;
  saveUserConfig(config: UserConfig): Promise<UserConfig>;
  getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]>;
  deleteUserConfig(userId: string): Promise<boolean>;
  getPublicStats(): Promise<PublicStats>;
}

export interface PublicStats {
  totalUsers: number;
  totalCatalogs: number;
}

export interface IImdbRatingsAdapter {
  set(imdbId: string, value: string): Promise<void>;
  get(imdbId: string): Promise<string | null>;
  getMany(imdbIds: string[]): Promise<Map<string, string>>;
  setBatch(entries: [string, string][]): Promise<void>;
  replaceAll(entries: [string, string][]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  setMeta(key: string, value: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  delMeta(key: string): Promise<void>;
  destroy(): Promise<void>;
}

export interface ImdbRating {
  rating: number;
  votes: number;
}
