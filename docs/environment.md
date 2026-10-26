# Environment Variables

All variables are defined in `server/src/config.ts`. Only `JWT_SECRET` and `ENCRYPTION_KEY` are required.

## Core

| Variable      | Description                                                                                                                                                                    | Default         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `PORT`        | HTTP server listen port                                                                                                                                                        | `7000`          |
| `NODE_ENV`    | Runtime environment (`production`, `development`, `test`, `nightly`)                                                                                                           | `production`    |
| `BASE_URL`    | Public base URL for manifest/install links. Auto-detected from `Host` header if unset. Set this explicitly when running behind proxies that do not preserve the original host. | _(auto-detect)_ |
| `TRUST_PROXY` | Express `trust proxy` setting — number of hops or `true`                                                                                                                       | `1`             |

## Auth & Security

| Variable         | Description                                                                                                                                                                                                                     | Default |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `JWT_SECRET`     | **Required.** Secret for signing JWT tokens. Must be at least 32 characters.                                                                                                                                                    | —       |
| `ENCRYPTION_KEY` | **Required.** AES-256 key for encrypting TMDB API keys at rest. Must be a 64-character hex string (32 bytes). Validated at startup — the server will refuse to start with an invalid key. Generate with `openssl rand -hex 32`. | —       |

Generate both with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## TMDB

| Variable          | Description                                                                                                                           | Default   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `TMDB_API_KEY`    | Server-side default TMDB API key. Per-user keys are stored encrypted in the database; this is a fallback when no per-user key exists. | _(empty)_ |
| `TMDB_RATE_LIMIT` | Max TMDB API requests per second (token bucket capacity)                                                                              | `35`      |
| `DEBUG_TMDB`      | Enable verbose logging of outbound TMDB API calls                                                                                     | `false`   |

## Database

Storage backend selection priority: explicit `DATABASE_DRIVER` → auto-detect from URI → memory fallback.

| Variable          | Description                                                               | Default         |
| ----------------- | ------------------------------------------------------------------------- | --------------- |
| `DATABASE_DRIVER` | Storage backend: `postgres`, `mongo`, or `memory`                         | _(auto-detect)_ |
| `POSTGRES_URI`    | PostgreSQL connection string. Required when `DATABASE_DRIVER=postgres`.   | _(empty)_       |
| `MONGODB_URI`     | MongoDB connection string. Required when `DATABASE_DRIVER=mongo`.         | _(empty)_       |
| `DATABASE_URL`    | Generic database URL (alternative to the driver-specific variables above) | _(empty)_       |

## Cache & Redis

| Variable                 | Description                                                                                                      | Default          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| `CACHE_DRIVER`           | Cache backend: `redis` or `memory`                                                                               | _(auto-detect)_  |
| `REDIS_URL`              | Redis connection string. Required when `CACHE_DRIVER=redis`. Falls back to memory adapter on connection failure. | _(empty)_        |
| `CACHE_MAX_KEYS`         | Maximum keys in the in-memory cache (LRU eviction)                                                               | `50000`          |
| `CACHE_VERSION_OVERRIDE` | Force a cache version string — changing this busts all cached entries                                            | _(empty)_        |
| `CACHE_WARM_REGIONS`     | Comma-separated ISO country codes for cache warming on startup                                                   | `US,GB,DE,FR,ES` |

## IMDB Ratings

| Variable                    | Description                                                      | Default |
| --------------------------- | ---------------------------------------------------------------- | ------- |
| `IMDB_RATINGS_DISABLED`     | Disable the IMDB ratings enrichment system entirely              | `false` |
| `IMDB_RATINGS_UPDATE_HOURS` | How often (in hours) to refresh the IMDB ratings dataset         | `24`    |
| `IMDB_MIN_VOTES`            | Minimum IMDB vote count for a title to receive rating enrichment | `100`   |

## External APIs

| Variable              | Description                                                                | Default        |
| --------------------- | -------------------------------------------------------------------------- | -------------- |
| `RPDB_API_KEY`        | RatingPosterDB API key for poster overlays. Free tier key: `t0-free-rpdb`. | `t0-free-rpdb` |
| `TOP_POSTERS_API_KEY` | TOP Posters API key. Required when using Top Posters artwork provider.     | _(empty)_      |
| `FANART_API_KEY`      | Fanart.tv API key. Required when using Fanart artwork provider.            | _(empty)_      |

## IMDb Source

The IMDb catalog source is enabled when a compatible IMDb API service is configured. It remains
available on nightly deployments when these values are set.

| Variable               | Description                                                                         | Default              |
| ---------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| `IMDB_DATA_ENABLED`    | Explicitly enables or disables the source. When unset, a configured key enables it. | _(derived from key)_ |
| `IMDB_DATA_KEY`        | Credential sent to the IMDb API service.                                            | _(empty)_            |
| `IMDB_DATA_HOST`       | IMDb API service host, without a protocol.                                          | _(empty)_            |
| `IMDB_DATA_ATTR_K`     | Request header name for `IMDB_DATA_KEY`.                                            | _(empty)_            |
| `IMDB_DATA_ATTR_H`     | Request header name for the API host.                                               | _(empty)_            |
| `IMDB_DATA_RATE_LIMIT` | Maximum IMDb API requests per second.                                               | `5`                  |

## CORS

| Variable                 | Description                                     | Default |
| ------------------------ | ----------------------------------------------- | ------- |
| `CORS_ORIGIN`            | Allowed CORS origin(s). `*` allows all origins. | `*`     |
| `CORS_ALLOW_CREDENTIALS` | Set `Access-Control-Allow-Credentials: true`    | `false` |

## Logging

| Variable     | Description                                                   | Default |
| ------------ | ------------------------------------------------------------- | ------- |
| `LOG_LEVEL`  | Log verbosity: `debug`, `info`, `warn`, `error`               | `info`  |
| `LOG_FORMAT` | Output format: `text` (human-readable) or `json` (structured) | `text`  |

## Feature Flags

| Variable             | Description                                                                                               | Default |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------- |
| `DISABLE_RATE_LIMIT` | Disable API rate limiting. Only effective in `development` or `test` environments; ignored in production. | `false` |

## Admin Dashboard & Observability

The admin dashboard lives at `/admin`. It returns 404 unless `ADMIN_USERNAME` and either `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` are set. Nothing is collected or written until then.

It uses whatever the app already runs on, with no extra services:

| Your setup     | Request / error history                                             | Live counters and live tail                            |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| Postgres       | `obs_*` tables, one partition per day                               |                                                        |
| MongoDB (4.4+) | `obs_*` collections with TTL indexes                                |                                                        |
| No database    | In memory: last 10,000 requests (3,000 on nightly), lost on restart |                                                        |
| Redis          |                                                                     | `obs:*` keys, shared by all instances                  |
| No Redis       |                                                                     | In memory, this instance only (fine for one container) |

| Variable                   | Description                                                                                                                                                                                            | Default      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `ADMIN_USERNAME`           | Admin login name                                                                                                                                                                                       | _(disabled)_ |
| `ADMIN_PASSWORD`           | Admin password, at least 16 characters. Set it like any other secret env var. Changing it signs out every admin session                                                                                | _(disabled)_ |
| `ADMIN_PASSWORD_HASH`      | Optional alternative to `ADMIN_PASSWORD` if you prefer not to keep the plain password in env (from `npm run admin:hash`). Takes precedence                                                             | _(unset)_    |
| `ADMIN_TOTP_SECRET`        | Optional base32 secret to require an authenticator code. Generate it in the dashboard under **Security** after signing in                                                                              | _(off)_      |
| `ADMIN_ALLOWED_IPS`        | Optional comma-separated IPs/CIDRs allowed to reach the admin                                                                                                                                          | _(any)_      |
| `TRUST_CLOUDFLARE_HEADERS` | Set to `true` only when Cloudflare proxies the app. Enables real visitor IP (`CF-Connecting-IP`), country and edge-location data. When off, those headers are ignored because clients could forge them | `false`      |
| `OBS_SAMPLE_RATE`          | Fraction (0–1) of successful requests stored as history. 5xx, slow (≥1.5s) and error-logging requests are always stored; live counters always count 100%                                               | `1`          |
| `OBS_RETENTION_DAYS`       | Days of request/upstream/error history kept (1–90)                                                                                                                                                     | `7`          |
| `OBS_MAX_STORAGE_MB`       | Upper bound for dashboard data in Postgres/MongoDB. Oldest days are deleted early; if today alone exceeds it, new request history pauses until it fits. `0` disables the cap. Never touches app data   | `1024`       |

Collection runs only when the admin is configured. Admin sessions last 8 hours.

## Addon Identity

| Variable        | Description                                                                                                                                   | Default    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `ADDON_VARIANT` | Changes addon ID and display name. Set to `nightly` to produce ID `community.tmdb.discover.plus.nightly` and name "TMDB Discover+ (Nightly)". | _(stable)_ |

## Nightly Resource Profile

When `ADDON_VARIANT=nightly`, runtime applies a constrained profile for memory-only deployments:

| Setting / Behavior           | Stable Default   | Nightly Effective      |
| ---------------------------- | ---------------- | ---------------------- |
| `TMDB_RATE_LIMIT` default    | `35`             | `12`                   |
| `CACHE_MAX_KEYS` default     | `20000`          | `6000`                 |
| `CACHE_WARM_REGIONS` default | `US,GB,DE,FR,ES` | `US`                   |
| IMDb API (`imdbApi.enabled`) | env-driven       | env-driven             |
| IMDb Ratings updater         | env-driven       | unchanged (env-driven) |
| Startup cache warming        | enabled          | skipped                |

Explicit env values still override the default numeric/cache settings.

## Deployment Examples

### Docker Compose (recommended)

```env
PORT=7000
DATABASE_DRIVER=postgres
POSTGRES_URI=postgres://user:pass@db:5432/tmdb_discover
CACHE_DRIVER=redis
REDIS_URL=redis://redis:6379
JWT_SECRET=<random-64-hex>
ENCRYPTION_KEY=<random-64-hex>
LOG_LEVEL=info
```

### Nightly (example)

```env
ADDON_VARIANT=nightly
BASE_URL=https://nightly.example.com
MONGODB_URI=mongodb+srv://...
JWT_SECRET=<random-64-hex>
ENCRYPTION_KEY=<random-64-hex>
```

### ElfHosted (Stable)

```env
DATABASE_DRIVER=postgres
POSTGRES_URI=postgres://...
CACHE_DRIVER=redis
REDIS_URL=redis://...
JWT_SECRET=<random-64-hex>
ENCRYPTION_KEY=<random-64-hex>
ADMIN_USERNAME=<admin-name>
ADMIN_PASSWORD=<at-least-16-characters>
TRUST_CLOUDFLARE_HEADERS=true
```

### Local Development

```env
NODE_ENV=development
DISABLE_RATE_LIMIT=true
LOG_LEVEL=debug
JWT_SECRET=dev-secret-not-for-production-use
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```
