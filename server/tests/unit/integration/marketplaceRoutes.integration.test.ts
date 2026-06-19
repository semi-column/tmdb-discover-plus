import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'crypto';
import express, { type Express } from 'express';
import request from 'supertest';

import { MemoryAdapter } from '../../../src/services/storage/MemoryAdapter.ts';
import type { CatalogConfig, UserConfig } from '../../../src/types/config.ts';

/**
 * Integration tests for the marketplace HTTP routes against a real MemoryAdapter.
 *
 * A minimal Express app mounts the real marketplace router at `/marketplace`
 * with `express.json()`. The only boundary substituted is the storage factory
 * (`services/storage/index.ts`), which is pointed at a real, in-process
 * `MemoryAdapter`. Everything else runs for real:
 *   - `requireAuth` / `optionalAuth` verify genuine JWTs (security util),
 *   - ownership checks decrypt the seeded config's API key and compare the
 *     derived apiKeyId against the caller's token,
 *   - the marketplace service performs the real publish/search/install/like
 *     logic and view counting.
 *
 * Auth is real (not mocked): a session token is minted with `generateToken`
 * using the same TMDB API key that seeds the owner's config, so the token's
 * `apiKeyId` matches the config owner.
 *
 * Covered:
 *   - auth rejection (401)            — Req 19.3
 *   - ownership rejection (403)       — Req 1.3 / 13.8
 *   - rate-limit wiring (light)       — mutations carry strictRateLimit
 *   - publish → search → preview(detail) → install → like/unlike flow
 *   - view increment on detail        — Req 12.1 (source+filters for preview)
 *   - like / unlike counters          — Req 19.5, 19.7
 *   - error body shape: category(code) + message(error) — Req 21.1, 21.2, 21.6
 */

// Shared MemoryAdapter referenced by both the mocked storage factory and the
// test body. Hoisted so the vi.mock factory can close over it.
const refs = vi.hoisted(() => ({
  adapter: { current: null as MemoryAdapter | null },
}));

vi.mock('../../../src/services/storage/index.ts', () => ({
  getStorage: () => {
    if (!refs.adapter.current) throw new Error('test storage not initialized');
    return refs.adapter.current;
  },
  initStorage: async () => refs.adapter.current,
}));

// Imported after the mock is declared so the real router/service/config wiring
// resolves the mocked storage factory.
import marketplaceRouter from '../../../src/routes/marketplace.ts';
import { saveUserConfig } from '../../../src/services/configService.ts';
import { generateToken, computeApiKeyId } from '../../../src/utils/security.ts';
import { getMarketplaceCache } from '../../../src/infrastructure/marketplaceCache.ts';

// --- Fixtures ---------------------------------------------------------------

// 32-hex-char keys satisfy isValidApiKeyFormat. Two distinct keys => two
// distinct apiKeyIds (owner vs. a different caller for the 403 path).
const OWNER_API_KEY = 'abcdef0123456789abcdef0123456789';
const OTHER_API_KEY = '0123456789abcdef0123456789abcdef';

const OWNER_USER = 'owneruser1'; // matches /^[A-Za-z0-9_-]{6,30}$/
const CATALOG_ID = crypto.randomUUID(); // valid catalog id ([A-Za-z0-9_-]{1,64})
const CATALOG_NAME = 'PopularMovies';

let app: Express;
let ownerToken: string;
let otherToken: string;
let ownerApiKeyId: string;

// Captured during the publish step and reused by later flow steps.
let publishedId = '';

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  a.use('/marketplace', marketplaceRouter);
  return a;
}

function auth(token: string): string {
  return `Bearer ${token}`;
}

beforeAll(async () => {
  const adapter = new MemoryAdapter();
  await adapter.connect();
  refs.adapter.current = adapter;
  getMarketplaceCache().clear();

  app = buildApp();

  ownerToken = (await generateToken(OWNER_API_KEY)).token;
  otherToken = (await generateToken(OTHER_API_KEY)).token;
  ownerApiKeyId = await computeApiKeyId(OWNER_API_KEY);

  // Seed the owner's config with one (not-yet-published) catalog. published:false
  // keeps save-time reconciliation from auto-publishing, so the route's
  // POST /publish is what creates the marketplace entry.
  const catalog: CatalogConfig = {
    _id: CATALOG_ID,
    name: CATALOG_NAME,
    type: 'movie',
    source: 'tmdb',
    filters: { sortBy: 'popularity' },
    enabled: true,
    published: false,
  };
  const seed: UserConfig = {
    userId: OWNER_USER,
    tmdbApiKey: OWNER_API_KEY,
    catalogs: [catalog],
    preferences: {},
  };
  await saveUserConfig(seed);
});

// --- Auth rejection (Req 19.3) ---------------------------------------------

describe('auth rejection — requireAuth on mutations (Req 19.3, 21.x)', () => {
  it('POST /publish without a token is 401 with category + message', async () => {
    const res = await request(app)
      .post('/marketplace/publish')
      .send({ userId: OWNER_USER, catalogId: CATALOG_ID });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('POST /:id/like without a token is 401', async () => {
    const res = await request(app).post(`/marketplace/${crypto.randomUUID()}/like`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('a malformed/garbage bearer token is 401', async () => {
    const res = await request(app)
      .post('/marketplace/publish')
      .set('Authorization', auth('not-a-real-jwt'))
      .send({ userId: OWNER_USER, catalogId: CATALOG_ID });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});

// --- Ownership rejection (Req 1.3 / 13.8) ----------------------------------

describe('ownership rejection (Req 1.3, 13.8, 21.x)', () => {
  it('publish for a userId the caller does not own is 403 FORBIDDEN', async () => {
    // Authenticated as OTHER_API_KEY but acting on the owner's config.
    const res = await request(app)
      .post('/marketplace/publish')
      .set('Authorization', auth(otherToken))
      .send({ userId: OWNER_USER, catalogId: CATALOG_ID });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('install into a target config the caller does not own is 403 FORBIDDEN', async () => {
    const res = await request(app)
      .post(`/marketplace/${crypto.randomUUID()}/install`)
      .set('Authorization', auth(otherToken))
      .send({ targetUserId: OWNER_USER });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

// --- Rate-limit wiring (light) ---------------------------------------------

describe('strictRateLimit wiring on mutations', () => {
  // NOTE: exhaustively driving the limiter to 429 is intentionally NOT done.
  // The limiter is configured to skip localhost requests under NODE_ENV=test
  // (see utils/rateLimit.ts), so a supertest client (127.0.0.1) is never
  // throttled. Instead we assert the limiter middleware is wired onto the
  // mutation routes: each mutation route carries an extra middleware layer
  // (requireAuth + strictRateLimit + handler = 3) that read routes lack.
  function handlerCount(method: 'get' | 'post' | 'delete', path: string): number {
    const layer = (marketplaceRouter as unknown as { stack: any[] }).stack.find(
      (l) => l.route?.path === path && l.route?.methods?.[method]
    );
    return layer ? layer.route.stack.length : -1;
  }

  it('mutation routes carry auth + rate-limit middleware ahead of the handler', () => {
    // optionalAuth + handler
    expect(handlerCount('get', '/search')).toBe(2);
    // requireAuth + strictRateLimit + handler
    expect(handlerCount('post', '/publish')).toBe(3);
    expect(handlerCount('post', '/:id/install')).toBe(3);
    expect(handlerCount('post', '/:id/like')).toBe(3);
    expect(handlerCount('delete', '/:id/like')).toBe(3);
  });
});

// --- Happy-path flow: publish -> search -> detail -> install -> like --------

describe('publish → search → preview(detail) → install → like flow', () => {
  it('publishes an owned catalog (200) and returns a marketplace entry', async () => {
    const res = await request(app)
      .post('/marketplace/publish')
      .set('Authorization', auth(ownerToken))
      .send({
        userId: OWNER_USER,
        catalogId: CATALOG_ID,
        description: 'A great list',
        tags: ['movies', 'popular'],
      });

    expect(res.status).toBe(200);
    expect(res.body.marketplaceId).toBeTruthy();
    expect(res.body.name).toBe(CATALOG_NAME);
    expect(res.body.visibility).toBe('public');
    expect(res.body.provenance.originUserId).toBe(OWNER_USER);

    publishedId = res.body.marketplaceId;
  });

  it('finds the published entry via GET /search', async () => {
    const res = await request(app).get('/marketplace/search').query({ q: CATALOG_NAME });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    const ids = res.body.items.map((i: { marketplaceId: string }) => i.marketplaceId);
    expect(ids).toContain(publishedId);
  });

  it('GET /:id returns detail with source+filters (preview delegation, Req 12.1) and increments views', async () => {
    const first = await request(app).get(`/marketplace/${publishedId}`);
    expect(first.status).toBe(200);
    expect(first.body.marketplaceId).toBe(publishedId);
    // Preview is delegated client-side from the entry's source + filters.
    expect(first.body.source).toBe('tmdb');
    expect(typeof first.body.filters).toBe('object');
    expect(first.body.filters).not.toBeNull();

    const firstViews = first.body.engagement.views;
    expect(firstViews).toBeGreaterThanOrEqual(1);

    // A second retrieval increments views by exactly 1.
    const second = await request(app).get(`/marketplace/${publishedId}`);
    expect(second.status).toBe(200);
    expect(second.body.engagement.views).toBe(firstViews + 1);
  });

  it('POST /:id/install clones into the target config and increments installs once', async () => {
    const res = await request(app)
      .post(`/marketplace/${publishedId}/install`)
      .set('Authorization', auth(ownerToken))
      .send({ targetUserId: OWNER_USER });

    expect(res.status).toBe(200);
    expect(res.body.alreadyInstalled).toBe(false);
    expect(res.body.installs).toBe(1);
    expect(res.body.catalog.clonedFrom.marketplaceId).toBe(publishedId);
  });

  it('a repeat install is idempotent: alreadyInstalled=true and installs unchanged', async () => {
    const res = await request(app)
      .post(`/marketplace/${publishedId}/install`)
      .set('Authorization', auth(ownerToken))
      .send({ targetUserId: OWNER_USER });

    expect(res.status).toBe(200);
    expect(res.body.alreadyInstalled).toBe(true);
    expect(res.body.installs).toBe(1);
  });

  it('POST /:id/like then DELETE /:id/like adjust the like counter (Req 19.5, 19.7)', async () => {
    const liked = await request(app)
      .post(`/marketplace/${publishedId}/like`)
      .set('Authorization', auth(ownerToken));

    expect(liked.status).toBe(200);
    expect(liked.body.liked).toBe(true);
    expect(liked.body.likes).toBe(1);

    // Idempotent: a repeat like does not bump the counter.
    const likedAgain = await request(app)
      .post(`/marketplace/${publishedId}/like`)
      .set('Authorization', auth(ownerToken));
    expect(likedAgain.status).toBe(200);
    expect(likedAgain.body.likes).toBe(1);

    const unliked = await request(app)
      .delete(`/marketplace/${publishedId}/like`)
      .set('Authorization', auth(ownerToken));

    expect(unliked.status).toBe(200);
    expect(unliked.body.liked).toBe(false);
    expect(unliked.body.likes).toBe(0);
  });
});

// --- Error body shape (Req 21.1, 21.2, 21.6) -------------------------------

describe('error responses expose a category (code) + message (error)', () => {
  it('400 validation error names a category for a bad search facet', async () => {
    const res = await request(app).get('/marketplace/search').query({ source: 'not-a-source' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('400 validation error for a malformed entry id', async () => {
    const res = await request(app).get('/marketplace/has spaces');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('404 NOT_FOUND for a syntactically valid but unknown entry id', async () => {
    const res = await request(app).get(`/marketplace/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(typeof res.body.error).toBe('string');
  });

  it('every error body carries both code and error fields', async () => {
    const res = await request(app)
      .post('/marketplace/publish')
      .set('Authorization', auth(ownerToken))
      .send({ userId: 'bad', catalogId: '' }); // invalid shape -> 400

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('error');
  });
});
