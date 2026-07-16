/**
 * Marketplace HTTP routes.
 *
 * Exposes the marketplace surface under `/marketplace` (mounted by
 * `server/src/index.ts` — task 12.4, not here):
 *
 *   GET    /search          — search/browse public entries        (optionalAuth)
 *   GET    /:id             — entry detail (increments `views`)    (optionalAuth)
 *   POST   /publish         — publish a catalog the caller owns    (requireAuth + ownership + strict)
 *   POST   /:id/unpublish   — remove the caller's entry            (requireAuth + ownership + strict)
 *   POST   /:id/install     — clone an entry into a target config  (requireAuth + ownership(target) + strict)
 *   POST   /:id/like        — idempotent like                      (requireAuth + strict)
 *   DELETE /:id/like        — idempotent unlike                    (requireAuth + strict)
 *
 * Reads use `optionalAuth`; mutations use `requireAuth` + `strictRateLimit` and
 * an ownership check against the userId being acted upon. Request-shape
 * validation/normalization is delegated to `handlers/marketplaceValidation.ts`
 * and the business logic to `services/marketplaceService.ts`. Every handler maps
 * `AppError` to its status/code/message via `sendError`; any other error becomes
 * a 500 with a `safeErrorMessage`.
 *
 * Requirements: 1.3, 4.5, 11.3, 11.4, 12.4, 13.8, 13.9, 19.1, 19.2, 19.3, 19.4,
 * 19.5, 19.6, 19.7, 21.1, 21.2, 21.3, 21.4, 21.6.
 */

import { Router, type Request, type Response } from 'express';

import { requireAuth, optionalAuth } from '../utils/authMiddleware.ts';
import { strictRateLimit } from '../utils/rateLimit.ts';
import { sendError, ErrorCodes, AppError, safeErrorMessage } from '../utils/AppError.ts';
import { createLogger } from '../utils/logger.ts';
import { getUserConfig, getApiKeyFromConfig } from '../services/configService.ts';
import { computeApiKeyId } from '../utils/security.ts';
import { getStorage } from '../services/storage/index.ts';
import {
  parseSearchQuery,
  validatePublishRequest,
  validateInstallRequest,
  validateEntryId,
} from './handlers/marketplaceValidation.ts';
import {
  searchMarketplace,
  getEntry,
  publishCatalog,
  unpublishCatalog,
  installEntry,
  likeEntry,
  unlikeEntry,
} from '../services/marketplaceService.ts';
import type { MarketplaceSearchQuery } from '../types/marketplace.ts';

const router = Router();
const log = createLogger('marketplace');

/**
 * Map a thrown error onto an HTTP response. A known `AppError` is surfaced with
 * its own status/code/message; any other error is logged and reduced to a 500
 * with a sanitized message so internal details never leak (Req 21.1, 21.2).
 */
function handleRouteError(res: Response, context: string, error: unknown): void {
  if (error instanceof AppError) {
    sendError(res, error.statusCode, error.code, error.message);
    return;
  }
  const err = error instanceof Error ? error : new Error('Unknown error');
  log.error('Marketplace route error', { context, error: err.message });
  sendError(res, 500, ErrorCodes.INTERNAL_ERROR, safeErrorMessage(err));
}

/**
 * Enforce that the authenticated caller (identified by `req.apiKeyId`) owns the
 * configuration belonging to `userId`, mirroring `requireConfigOwnership` but
 * keyed by a body/provenance-supplied userId rather than a path param.
 *
 * Throws `404 CONFIG_NOT_FOUND` when the target config is missing, `403
 * FORBIDDEN` when the caller's API key does not match the config's, and `500`
 * when the config is corrupt (no API key). On success it returns nothing.
 *
 * Requirements: 1.3 (publish ownership), 4.5 (unpublish ownership),
 * 13.8 (install target ownership).
 */
async function assertConfigOwnership(req: Request, userId: string): Promise<void> {
  const config = await getUserConfig(userId);
  if (!config) {
    throw new AppError(404, ErrorCodes.CONFIG_NOT_FOUND, 'Configuration not found');
  }

  const configApiKey = getApiKeyFromConfig(config);
  if (!configApiKey) {
    log.error('Config has no API key during ownership check', { userId });
    throw new AppError(500, ErrorCodes.INTERNAL_ERROR, 'Configuration error');
  }

  const expectedApiKeyId = await computeApiKeyId(configApiKey);
  if (req.apiKeyId !== expectedApiKeyId) {
    log.warn('Marketplace ownership check failed', { userId });
    throw new AppError(
      403,
      ErrorCodes.FORBIDDEN,
      'Access denied: This configuration belongs to a different API key'
    );
  }
}

// ---------------------------------------------------------------------------
// Reads (optionalAuth)
// ---------------------------------------------------------------------------

/**
 * GET /marketplace/search — search/browse public + active entries.
 *
 * The raw query string is validated/normalized by `parseSearchQuery` (which
 * 400s on an unrecognized source/type/sort, naming the field) before the
 * service ranks and paginates. Genres are re-joined to the comma-separated
 * shape the service expects.
 *
 * Requirements: 19.1, 21.1, 21.3, 21.6.
 */
router.get('/search', optionalAuth, async (req: Request, res: Response) => {
  try {
    const normalized = parseSearchQuery(req.query);
    const query: MarketplaceSearchQuery = {
      q: normalized.q,
      source: normalized.source?.join(','),
      type: normalized.type,
      genres: normalized.genres.join(','),
      sort: normalized.sort,
      page: normalized.page,
      limit: normalized.limit,
    };
    const result = await searchMarketplace(query);
    res.json(result);
  } catch (error) {
    handleRouteError(res, 'GET /search', error);
  }
});

/**
 * GET /marketplace/:id — public entry detail; the service increments `views`
 * once per retrieval, 400s a malformed id, and 404s an unknown id.
 *
 * Requirements: 11.3, 11.4, 19.1.
 */
router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    const id = validateEntryId(req.params.id);
    const entry = await getEntry(id);
    res.json(entry);
  } catch (error) {
    handleRouteError(res, 'GET /:id', error);
  }
});

// ---------------------------------------------------------------------------
// Mutations (requireAuth + strictRateLimit + ownership)
// ---------------------------------------------------------------------------

/**
 * POST /marketplace/publish — publish (or re-publish) a catalog the caller owns.
 *
 * The body is validated for shape, then ownership of `userId` is enforced
 * against the caller's API key before delegating to `publishCatalog`.
 *
 * Requirements: 1.3, 19.2, 19.3, 21.1, 21.4.
 */
router.post('/publish', requireAuth, strictRateLimit, async (req: Request, res: Response) => {
  try {
    const { userId, catalogId, description, tags } = validatePublishRequest(req.body);
    await assertConfigOwnership(req, userId);
    const entry = await publishCatalog(userId, catalogId, { description, tags });
    res.json(entry);
  } catch (error) {
    handleRouteError(res, 'POST /publish', error);
  }
});

/**
 * POST /marketplace/:id/unpublish — remove the caller's own entry from the index.
 *
 * Because `unpublishCatalog` is keyed by the `(originUserId, originCatalogId)`
 * pair, the route first resolves the entry by its marketplace id to recover its
 * provenance, enforces ownership of `originUserId`, then deletes by origin pair.
 * The entry is loaded directly from storage (not via `getEntry`) so the lookup
 * does not record a view for an unpublish action. A missing entry is a 404.
 *
 * Requirements: 4.5, 19.2.
 */
router.post('/:id/unpublish', requireAuth, strictRateLimit, async (req: Request, res: Response) => {
  try {
    const id = validateEntryId(req.params.id);

    const entry = await getStorage().getMarketplaceEntry(id);
    if (!entry) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Marketplace entry not found');
    }

    const { originUserId, originCatalogId } = entry.provenance;
    await assertConfigOwnership(req, originUserId);
    await unpublishCatalog(originUserId, originCatalogId);

    res.json({ success: true });
  } catch (error) {
    handleRouteError(res, 'POST /:id/unpublish', error);
  }
});

/**
 * POST /marketplace/:id/install — clone an entry into the target user's config.
 *
 * The body supplies `targetUserId`; ownership of that config is enforced before
 * `installEntry` clones the entry. A duplicate install surfaces
 * `alreadyInstalled: true` without bumping the counter.
 *
 * Requirements: 13.8, 13.9, 19.4, 21.1, 21.4.
 */
router.post('/:id/install', requireAuth, strictRateLimit, async (req: Request, res: Response) => {
  try {
    const id = validateEntryId(req.params.id);
    const { targetUserId } = validateInstallRequest(req.body);
    await assertConfigOwnership(req, targetUserId);
    const result = await installEntry(id, targetUserId);
    res.json(result);
  } catch (error) {
    handleRouteError(res, 'POST /:id/install', error);
  }
});

/**
 * POST /marketplace/:id/like — idempotent like by the authenticated user.
 *
 * Requirements: 19.5, 19.6.
 */
router.post('/:id/like', requireAuth, strictRateLimit, async (req: Request, res: Response) => {
  try {
    const id = validateEntryId(req.params.id);
    const actorUserId = req.apiKeyId as string;
    const result = await likeEntry(id, actorUserId);
    res.json(result);
  } catch (error) {
    handleRouteError(res, 'POST /:id/like', error);
  }
});

/**
 * DELETE /marketplace/:id/like — idempotent unlike by the authenticated user.
 *
 * Requirements: 19.5, 19.7.
 */
router.delete('/:id/like', requireAuth, strictRateLimit, async (req: Request, res: Response) => {
  try {
    const id = validateEntryId(req.params.id);
    const actorUserId = req.apiKeyId as string;
    const result = await unlikeEntry(id, actorUserId);
    res.json(result);
  } catch (error) {
    handleRouteError(res, 'DELETE /:id/like', error);
  }
});

export default router;
