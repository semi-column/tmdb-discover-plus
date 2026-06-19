import type {
  IStorageAdapter,
  UserConfig,
  PublicStats,
  MarketplaceEntry,
  MarketplaceSearchParams,
} from '../../types/index.ts';

export abstract class StorageInterface implements IStorageAdapter {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getUserConfig(userId: string): Promise<UserConfig | null>;
  abstract saveUserConfig(config: UserConfig): Promise<UserConfig>;
  abstract getConfigsByApiKeyId(apiKeyId: string): Promise<UserConfig[]>;
  abstract deleteUserConfig(userId: string): Promise<boolean>;
  abstract getPublicStats(): Promise<PublicStats>;

  // --- Marketplace persistence ---
  abstract upsertMarketplaceEntry(entry: MarketplaceEntry): Promise<MarketplaceEntry>;
  abstract deleteMarketplaceEntryByOrigin(
    originUserId: string,
    originCatalogId: string
  ): Promise<boolean>;
  abstract getMarketplaceEntry(marketplaceId: string): Promise<MarketplaceEntry | null>;
  abstract searchMarketplaceEntries(params: MarketplaceSearchParams): Promise<MarketplaceEntry[]>;
  abstract countMarketplaceEntries(params: MarketplaceSearchParams): Promise<number>;
  abstract incrementMarketplaceCounter(
    marketplaceId: string,
    field: 'installs' | 'likes' | 'views',
    delta: 1 | -1
  ): Promise<number>;
  abstract setTrendingScore(marketplaceId: string, score: number): Promise<number>;
  abstract recordLike(marketplaceId: string, actorUserId: string): Promise<boolean>;
  abstract removeLike(marketplaceId: string, actorUserId: string): Promise<boolean>;
  abstract hasLiked(marketplaceId: string, actorUserId: string): Promise<boolean>;
}
