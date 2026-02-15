# Environment Variables

All variables are defined in `server/src/config.ts`. Only `JWT_SECRET` and `ENCRYPTION_KEY` are required.

## Core

| Variable      | Description                                                                                                                                | Default         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `PORT`        | HTTP server listen port                                                                                                                    | `7000`          |
| `NODE_ENV`    | Runtime environment (`production`, `development`, `test`, `nightly`)                                                                       | `production`    |
| `BASE_URL`    | Public base URL for manifest/install links. Auto-detected from `Host` header if unset. Required on BeamUp where headers are not forwarded. | _(auto-detect)_ |
| `TRUST_PROXY` | Express `trust proxy` setting — number of hops or `true`                                                                                   | `1`             |

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

| Variable             | Description                                                                                                                           | Default   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `TMDB_API_KEY`       | Server-side default TMDB API key. Per-user keys are stored encrypted in the database; this is a fallback when no per-user key exists. | _(empty)_ |
| `TMDB_RATE_LIMIT`    | Max TMDB API requests per second (token bucket capacity)                                                                              | `35`      |
| `DISABLE_TLS_VERIFY` | Disable TLS certificate verification for TMDB requests. **Never enable in production.**                                               | `false`   |
| `DEBUG_TMDB`         | Enable verbose logging of outbound TMDB API calls                                                                                     | `false`   |

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

## IMDB Dataset Catalogs

The IMDB dataset feature downloads IMDB's public TSV datasets (`title.basics.tsv.gz` and `title.ratings.tsv.gz`) to power catalog browsing sourced from real IMDB ratings and popularity data. No API key required. Uses ~200–300MB additional memory (filtered to titles with ≥1000 votes). Refreshes every 24 hours by default.

| Variable                    | Description                                                                        | Default |
| --------------------------- | ---------------------------------------------------------------------------------- | ------- |
| `IMDB_DATASET_DISABLED`     | Disable the IMDB dataset catalogs feature entirely                                 | `false` |
| `IMDB_DATASET_UPDATE_HOURS` | How often (in hours) to re-download and refresh the IMDB dataset                   | `24`    |
| `IMDB_DATASET_MIN_VOTES`    | Minimum vote count for a title to be included in IMDB catalogs (quality threshold) | `1000`  |

## External APIs

| Variable       | Description                                                                | Default   |
| -------------- | -------------------------------------------------------------------------- | --------- |
| `RPDB_API_KEY` | RatingPosterDB API key for poster overlays. Free tier key: `t0-free-rpdb`. | _(empty)_ |

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
| `DISABLE_METRICS`    | Disable the in-memory Prometheus-style metrics collector                                                  | `false` |

## Addon Identity

| Variable        | Description                                                                                                                                   | Default    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `ADDON_VARIANT` | Changes addon ID and display name. Set to `nightly` to produce ID `community.tmdb.discover.plus.nightly` and name "TMDB Discover+ (Nightly)". | _(stable)_ |

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

### BeamUp (Nightly)

```env
ADDON_VARIANT=nightly
BASE_URL=https://84f50d1c22e7-tmdb-discover-plus.baby-beamup.club
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
```

### Local Development

```env
NODE_ENV=development
DISABLE_RATE_LIMIT=true
LOG_LEVEL=debug
JWT_SECRET=dev-secret-not-for-production-use
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```
