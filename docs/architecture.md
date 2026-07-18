# Architecture Overview

TMDB Discover+ is a Stremio addon that lets users create custom content catalogs powered by TMDB's Discover API. It consists of an Express server implementing the Stremio addon protocol and a React SPA ("Catalog Builder") for configuration.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Stremio App                              │
│   GET /:userId/manifest.json                                    │
│   GET /:userId/catalog/:type/:id/:extra.json                    │
│   GET /:userId/meta/:type/:id.json                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                      Express Server                             │
│                                                                 │
│  Middleware Pipeline:                                           │
│  CORS → JSON → Compression → Security Headers → Request ID     │
│  → Rate Limit (300/min)                                        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Addon Routes │  │  API Routes  │  │   Auth Routes      │    │
│  │ 1000/min     │  │  300/min     │  │   60/min (strict)  │    │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘    │
│         │                 │                     │               │
│  ┌──────▼─────────────────▼─────────────────────▼──────────┐   │
│  │                  Config Service                          │   │
│  │  ConfigCache (LRU 1000, 5min TTL, stampede protection)  │   │
│  │  → Encryption (AES-256-GCM) / PBKDF2 key derivation    │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │                                     │
│  ┌────────────────────────▼────────────────────────────────┐   │
│  │               Storage Adapter                            │   │
│  │  PostgresAdapter │ MongoAdapter │ MemoryAdapter          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    TMDB Client                           │   │
│  │  Circuit Breaker → Cache Check → Token Bucket Throttle  │   │
│  │  → HTTP Fetch (3 retries, exponential backoff)          │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │                                     │
│  ┌────────────────────────▼────────────────────────────────┐   │
│  │                  Cache Wrapper                           │   │
│  │  Stale-while-revalidate │ Error caching │ Deduplication │   │
│  │  RedisAdapter │ MemoryAdapter                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Request Lifecycle

### Stremio Catalog Request

1. **Inbound** — Stremio sends `GET /:userId/catalog/:type/:catalogId/:extra.json`
2. **Middleware** — CORS, compression, security headers, request ID, rate limit (1000/min for addon routes), ETag
3. **Config resolution** — `getUserConfig(userId)` loads user config via `ConfigCache` (LRU, 5-min TTL, stampede protection) backed by the storage adapter
4. **API key decryption** — AES-256-GCM decrypts the stored TMDB API key
5. **TMDB fetch** via `tmdbFetch()`:
   - Circuit breaker check — if open (≥10 failures in 60s), immediately returns 503
   - Cache check — `CacheWrapper.getEntry()` returns cached response if fresh, or serves stale data while triggering background refresh
   - Token bucket throttle — `TokenBucket.acquire()` enforces rate limit (~35 req/s)
   - HTTP fetch with up to 3 retries (exponential backoff: 300ms × 2^attempt)
   - 429 handling — respects `Retry-After` header
6. **Response enrichment** — IMDb ID mapping, localized genres, IMDb ratings overlay, RPDB poster overlays
7. **Format conversion** — Transforms TMDB data to Stremio meta objects via `toStremioMeta()`
8. **ETag response** — SHA-256-based weak ETag with 304 Not Modified support

### Configuration API Request

1. Client authenticates via `POST /api/auth/login` with TMDB API key → receives JWT
2. Client fetches reference data (`GET /api/reference-data`) — genres, languages, countries, etc.
3. Client builds catalogs with live preview (`POST /api/preview`)
4. Client saves configuration (`POST /api/config` or `PUT /api/config/:userId`)
5. All authenticated endpoints require `Authorization: Bearer <token>` header

## Storage Layer

`IStorageAdapter` with three concrete adapters, selected by `DATABASE_DRIVER` env var or auto-detected from connection URIs.

| Adapter           | Backend              | Use Case                  |
| ----------------- | -------------------- | ------------------------- |
| `PostgresAdapter` | PostgreSQL via `pg`  | ElfHosted, Docker Compose |
| `MongoAdapter`    | MongoDB via Mongoose | Nightly                   |
| `MemoryAdapter`   | In-process `Map`     | Development, testing      |

**What's stored:** User configurations containing encrypted TMDB API keys, catalog definitions (filter sets), preferences (language, adult content, poster service), and a PBKDF2-derived `apiKeyId` for ownership verification.

## Cache Layer

### CacheWrapper

Wraps a raw cache adapter with resilience features:

- **Stale-while-revalidate** — Entries store `__storedAt` + `__ttl` metadata. When age exceeds TTL but is less than 2×TTL, stale data is served immediately while a background refresh runs. Beyond 2×TTL, treated as a cache miss. The underlying cache adapter retains entries for 2.5×TTL to cover the full stale window.
- **Error-aware caching** — Failed lookups are cached with type-specific TTLs to prevent thundering herd:

| Error Type            | Cache TTL |
| --------------------- | --------- |
| Empty result          | 60s       |
| Rate limited (429)    | 15min     |
| Temporary error (5xx) | 2min      |
| Permanent error (4xx) | 30min     |
| Not found (404)       | 1hr       |

- **Request deduplication** — Concurrent requests for the same cache key share a single in-flight promise
- **Self-healing** — Detects and replaces corrupted cache entries automatically

### Cache Adapters

| Adapter         | Backend                                           | Selection                                   |
| --------------- | ------------------------------------------------- | ------------------------------------------- |
| `RedisAdapter`  | Redis with JSON serialization                     | `CACHE_DRIVER=redis` or `REDIS_URL` present |
| `MemoryAdapter` | `node-cache` with LRU eviction (50K keys default) | Fallback                                    |

Redis failure triggers automatic degradation to the memory adapter.

### ConfigCache

Separate in-memory LRU cache (1000 entries, 5-min TTL) for user configs with stampede protection — concurrent loads for the same key coalesce into a single database query.

### Cache Warming

Runs after server start as a non-blocking background task. Pre-warms genre lists, languages, countries, certifications, watch regions, and watch providers for configured regions.

## Auth Flow

1. User submits TMDB API key → `POST /api/auth/login`
2. Server validates key against TMDB API (`/configuration` endpoint)
3. API key is encrypted with **AES-256-GCM** (random IV + auth tag) and stored as `tmdbApiKeyEncrypted`
4. An `apiKeyId` is derived via **PBKDF2** (100K iterations, SHA-256) — a one-way hash for ownership verification without storing the raw key
5. Server issues a **JWT** containing `{ apiKeyId, jti }`:
   - `rememberMe=true` → 7-day expiry
   - `rememberMe=false` → 24-hour expiry
6. Client stores JWT in `localStorage` (persistent) or `sessionStorage` (session-only)

**Token revocation:** In-memory `Map<jti, expiresAt>` with periodic cleanup every 10 minutes.

**Auth middleware chain:**

| Middleware               | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `requireAuth`            | Validates JWT, sets `req.apiKeyId`                             |
| `resolveApiKey`          | Looks up actual TMDB API key from configs using `req.apiKeyId` |
| `requireConfigOwnership` | Verifies JWT's `apiKeyId` matches the config being accessed    |
| `optionalAuth`           | Non-blocking — sets `req.apiKeyId` if valid token present      |

## TMDB Client

### Circuit Breaker

Module-level singleton with three implicit states:

| State     | Condition            | Behavior                                                 |
| --------- | -------------------- | -------------------------------------------------------- |
| Closed    | < 10 failures in 60s | Normal operation                                         |
| Open      | ≥ 10 failures in 60s | All requests immediately fail with 503                   |
| Half-Open | 30s cooldown elapsed | Next request probes; success → Closed, failure → re-Open |

### Token Bucket Throttle

- Capacity: `TMDB_RATE_LIMIT` (default 35 tokens/sec)
- Refill: same rate, replenished every 100ms
- Queue: up to 500 pending requests, 10s per-request timeout
- Graceful shutdown: rejects all queued requests

### Retry Logic

- Up to 3 retries on network errors and 5xx/429 responses
- Exponential backoff: 300ms × 2^attempt
- 429: respects `Retry-After` header (capped at 10s)

### URL Security

- HTTPS-only enforcement
- Origin whitelist (`api.themoviedb.org`)
- No embedded credentials allowed
- API keys redacted in all log output

## Client Architecture

React 19 SPA with no external state library. State management uses a hooks composition pattern:

| Hook                | Responsibility                                                          |
| ------------------- | ----------------------------------------------------------------------- |
| `useAppController`  | Facade — composes all hooks, exposes `{ state, actions, data }`         |
| `useConfig`         | Core state: userId, catalogs, preferences, dirty tracking, CRUD         |
| `useAuth`           | Login/logout, session verification, legacy migration                    |
| `useTMDB`           | Reference data fetching, preview, entity search, IMDb reference/preview |
| `useCatalogManager` | Catalog add/delete/duplicate/reorder, active tracking                   |
| `useConfigManager`  | Save/install flow, multi-config management, import/export               |
