# Architecture Overview

TMDB Discover+ is a Stremio catalog/metadata addon with TMDB, IMDb, AniList,
MyAnimeList, Kitsu, and Simkl sources. It consists of an Express server
implementing the Stremio addon protocol, a React SPA ("Catalog Builder"), and an
optional admin dashboard. Source availability depends on instance/user
credentials. See [self-hosting](self-hosting.md) for deployment topology and
[environment settings](environment.md) for configuration.

## Core Request Path

The diagram below focuses on shared infrastructure and the TMDB request path;
other sources have their own clients and source-specific throttling/caching.

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
│  → Rate Limit (300/IP/min except addon resource paths)          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ Addon Routes │  │  API Routes  │  │   Auth Routes      │    │
│  │ 1000/user/min│  │  300/IP/min  │  │   60/IP/min        │    │
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

## Cache observability

The admin Overview shows lookup hit/miss percentages; the Caching tab adds weighted
request outcomes and the top 50 routes or redacted paths ranked by cache misses.
Both use the selected time range and request filters across Postgres, MongoDB, and
memory history. Totals include all matching groups, not only the top 50.

Lookup rates use instrumented shared-cache hits divided by hits plus misses.
Requests with at least one recorded lookup are classified as all hits, mixed, or
misses only. "Miss + upstream" counts requests with a miss and a captured outbound
call; it is correlation, not evidence that the miss caused that call. A request
can have several lookups, all hits can still include API calls, and a miss may
share another request's in-flight work. Stale reads count as hits; cached errors,
cache failures, process-local caches, and browser/CDN caches are excluded from
these hit/miss metrics. Sampling produces weighted estimates. Unavailable history
is shown explicitly rather than as zero activity.

New request-history records also snapshot fresh/stale hits, misses, cached-error
reads and read failures at HTTP response completion. Fixed cache-key families
separate addon responses, key validation, TMDB data/reference data, seasons,
artwork, ID lookups, IMDb data/freshness markers, anime, and pagination; raw cache
keys are never retained in these details. Each shared-cache read contributes one
outcome; write failures do not count as read failures. Layer counts are weighted
like the existing lookup totals, including error-only requests. Detail-card
percentages use all five outcomes; layer hit rates still use hits plus misses.
Fresh/stale means the shared wrapper's logical TTL, not end-to-end HTTP/source
freshness: IMDb additionally checks a separate freshness marker. Refresh work
starting after response completion is outside the request snapshot.

Legacy rows retain their original hit/miss counts but have no layer/freshness/error
detail. They are not backfilled as zero reads. Coverage reports unweighted
matching retained rows, including requests without cache reads, their actual
oldest/newest timestamps, and the detailed subset's count/oldest timestamp. These
bounds do not prove continuous capture or complete coverage of the selected range.
The Caching tab distinguishes the actual request-history backend, application-cache
driver and live-counter driver, and displays current retention/storage limits and
collector loss/pause indicators. Redis cache/live storage is not durable request
history; database history may fall back to bounded process memory.

The read-only TTL inventory comes from the current deployment's shared constants
and effective IMDb environment overrides, including local/error TTLs and physical
retention multipliers. It is not a historical snapshot or a cache-content browser.
HTTP freshness, logical server freshness, and physical retention are distinct.
The former configless/unmatched shortcut is removed; ordinary route exclusion
filters remain supported, including existing bookmarked filters.

## Request Lifecycle

### Stremio Catalog Request

1. **Inbound** — Stremio sends `GET /:userId/catalog/:type/:catalogId/:extra.json`
2. **Middleware** — CORS, compression, security headers, request ID, addon IP limit (3,000/min), invalid-ID budget check, ETag. Configured addon resources do not consume the API/general budget.
3. **Config resolution** — `getUserConfig(userId)` loads user config via `ConfigCache` (LRU, 5-min TTL, stampede protection) backed by the storage adapter. Existing configurations use a 1,000/min per-user budget; missing/invalid IDs consume a 30/min per-IP budget.
4. **API key decryption** — AES-256-GCM decrypts the stored TMDB API key
5. **TMDB fetch** via `tmdbFetch()`:
   - Circuit breaker check — if open (≥10 failures in 60s), immediately returns 503
   - Cache check — `CacheWrapper.getEntry()` returns cached response if fresh, or serves stale data while triggering background refresh
   - Uncached addon builds use bounded admission (6/user and 60 total, shared across Redis replicas); hits bypass admission, stale refresh and prefetch consume capacity. Queues remain local, capped at 100/user and 500/process with a 5-second wait; saturation returns an uncacheable 429.
   - Token bucket throttle — shared Redis budget (~35 req/s total), or process-local `TokenBucket` in memory mode
   - HTTP fetch with up to 3 retries (exponential backoff: 300ms × 2^attempt)
   - 429 handling — respects `Retry-After` header
6. **Response enrichment** — IMDb ID mapping, localized genres, IMDb ratings overlay, RPDB poster overlays
7. **Format conversion** — Transforms TMDB data to Stremio meta objects via `toStremioMeta()`
8. **ETag response** — SHA-256-based weak ETag with 304 Not Modified support

### Configuration and enrichment bounds

- The root `/manifest.json` requires configuration and advertises no catalog or meta resources. Only a configured `/:userId/manifest.json` advertises playable IDs and catalogs.
- TMDB search merges title matches and person credits, then returns 20 items per `skip` page. The full filmography remains reachable; only that page receives detailed metadata/artwork enrichment.
- Series metadata uses TMDB's [append-to-response](https://developer.themoviedb.org/reference/tv-series-details) support to batch up to 20 uncached seasons per request, retaining individual season caches and falling back to individual fetches for missing batch members. All seasons and IMDb episode/overview augmentation are preserved, including the two existing extra-season probes.
- Artwork is resolved once per TMDB meta/preview. TVDB/Fanart payloads are reused across image kinds within that resolution. Image probes retry HEAD 401/405/501 once with a ranged GET under the same deadline, cancel the body, and only negative-cache definitive missing/invalid images—not authentication, throttling, transport failures, or cancellation.
- Timeout/disconnect cancellation propagates through TMDB/IMDb fetches, throttle queues, retry waits, and enrichment loops. Aborted computations cannot write positive or negative cache entries; a healthy coalesced caller can retry independently when its original producer disconnects. Completed season responses may retain their normal 14-day TTL, but the aggregated meta TTL is one day, not 14 days.

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
- Refill: same rate; warmup uses half capacity/rate (rounded up). Redis uses server time and atomic Lua, memory replenishes every 100ms.
- Redis mode (`REDIS_URL` set and `CACHE_DRIVER` not `memory`) shares tokens, warmup completion and 429 pauses across replicas. Pauses are clamped to 1–10 seconds, never shortened by another replica, and do not earn tokens.
- Queue: up to 500 pending requests **per process**, 10s per-request timeout. Redis polling is bounded and abortable; commands time out after at most 1 second. A caller's shorter queue deadline does not shorten that Redis timeout or close the shared connection. Outstanding commands remain counted against queue bounds until they settle. Late work grants are released; a late TMDB token may be spent, but does not permit an outbound call.
- A dedicated Redis connection is fail-closed: connection, command, release or renewal failures stop admission (`SharedAdmissionError`, status 503), not unlimited memory fallback. In-flight waiters and leases on the failed connection are aborted and commands are rejected for 5 seconds; the next admission attempt or command then opens a fresh connection. Admission callers check recovery before capturing the connection's cancellation signal, so an aborted generation cannot permanently block new requests. Ambiguous grants are never retried; orphaned leases expire. Graceful shutdown cancels waiters and closes this connection through the TMDB shutdown hook.
- Work admission uses two atomic sorted sets (global/user), opaque lease IDs and hashed user keys under `tmdb-discover-plus:{admission}:v1:`. Leases expire after 30 seconds and renew every 10 seconds; release is idempotent. A renewal reply showing the lease expired aborts only that request context; a Redis error during renewal fails the whole connection generation like any other command. Killed replicas reclaim capacity through lease/key expiry.
- `withAddonWork()` preserves existing request contexts and creates an abortable background context when absent. Background refresh/prefetch upstream calls therefore receive `getRequestSignal()` and cancel on renewal loss as request-bound calls do.
- Lease expiry is crash recovery, not fencing: work must honor request cancellation. A paused/partitioned process that ignores abort can continue computing after its lease expires. Queues/fairness and throttle statistics are process-local; Redis active ceilings are shared. All replicas must use the same rate configuration and Redis database; independent deployments need separate Redis databases. Protect admission keys from eviction/reset, which would erase live budgets/leases.

Shared admission tests spawn their own localhost Redis, never use `REDIS_URL`,
and destroy only that isolated server's state. Run
`npm --prefix server test -- tests/unit/sharedAdmission.test.ts` with
`redis-server` installed, or set `ADMISSION_REDIS_SERVER` to its executable path.
Live Redis cases are skipped when the executable is unavailable.

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
