import type { IStorageAdapter, UserConfig, PublicStats } from '../../types/index.ts';

export abstract class StorageInterface implements IStorageAdapter {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getUserConfig(userId: string): Promise<UserConfig | null>;
  abstract saveUserConfig(config: UserConfig): Promise<UserConfig>;
  abstract getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]>;
  abstract deleteUserConfig(userId: string): Promise<boolean>;
  abstract getPublicStats(): Promise<PublicStats>;
}
