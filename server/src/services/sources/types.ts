import type { Request, Response } from 'express';
import type { StremioMeta, StremioMetaPreview } from '../../types/stremio.ts';
import type { ContentType } from '../../types/common.ts';
import type { CatalogFilters } from '../../types/config.ts';

export interface ManifestSearchCatalog {
  id: string;
  type: ContentType;
  name: string;
  extra: { name: string; isRequired?: boolean }[];
}

export interface DiscoverResult {
  items: StremioMetaPreview[];
  hasMore: boolean;
  totalCount?: number;
}

/**
 * Per-request context handed to a source when dispatching a catalog
 * request from the addon router. Sources own the response lifecycle —
 * they must terminate the response (json/end/error) themselves.
 */
export interface CatalogRequestContext {
  userId: string;
  type: ContentType;
  catalogId: string;
  extra: Record<string, string>;
  req: Request;
  res: Response;
}

export interface IDiscoverSource {
  readonly sourceId: string;
  readonly catalogIdPrefix: string;
  readonly defaultPageSize: number;
  isEnabled(): boolean;
  sanitizeFilters(filters: CatalogFilters): CatalogFilters;

  /**
   * Return search catalogs this source contributes to the manifest.
   * Called by manifestService — each source owns its own search shape.
   * Return an empty array if search is disabled or the source is off.
   */
  getSearchCatalogs(): ManifestSearchCatalog[];

  /**
   * Handle a Stremio catalog request whose `catalogId` matched this
   * source's `catalogIdPrefix`. Implementations terminate the
   * response. The TMDB source acts as the default catalog provider
   * and is dispatched directly by the router (no prefix match).
   */
  handleCatalogRequest?(ctx: CatalogRequestContext): Promise<void>;
}

export type { StremioMeta };
