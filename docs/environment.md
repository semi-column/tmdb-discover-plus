# Environment Variables

Most settings are defined in [`server/src/config.ts`](../server/src/config.ts).
The MAL client also reads `JIKAN_API_BASE`, and observability uses `HOSTNAME`.
Only `JWT_SECRET` and `ENCRYPTION_KEY` are mandatory for startup; durable hosting
also requires a working database.

Defaults below describe the app, not Compose overrides. See the
[self-hosting guide](self-hosting.md) and [`.env.example`](../.env.example).
Run `npm start` from the repository root to load its `.env`. A process started
from `server/` instead loads `server/.env` unless its environment or dotenv path
is supplied explicitly. Compose interpolation does not automatically forward
variables into containers.

## Core

| Variable                 | Description                                                                                                                | Default         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `PORT`                   | HTTP listen port; set explicitly in standalone containers                                                                  | `7000`          |
| `NODE_ENV`               | `production`, `development`, or `test`; nightly behavior is selected by `ADDON_VARIANT`                                    | `production`    |
| `BASE_URL`               | Public origin for generated links, no trailing slash; set explicitly for hosting                                           | Request-derived |
| `TRUST_PROXY`            | Proxy hop count or trusted IP/CIDR/preset configuration; use `0` directly, `1` only behind one trusted proxy               | `1`             |
| `JSON_BODY_LIMIT`        | Express JSON body size limit for API/configuration payloads                                                                | `512kb`         |
| `CORS_ORIGIN`            | Comma-separated allowed origins, or `*`; restricting it can prevent browser-based Stremio clients from accessing the addon | `*`             |
| `CORS_ALLOW_CREDENTIALS` | Allow credentialed CORS requests                                                                                           | `false`         |

Without `BASE_URL`, generated links can derive from request origin/referrer or
forwarded host/protocol headers. Restrict access to your origin and ensure
trusted proxies replace untrusted forwarded headers. Do not set broad proxy
trust merely to remove an IP/rate-limit warning.

## Auth & Security

| Variable         | Description                                                                          | Default |
| ---------------- | ------------------------------------------------------------------------------------ | ------- |
| `JWT_SECRET`     | Required signing and API-key-derived account-identity secret, at least 32 characters | None    |
| `ENCRYPTION_KEY` | Required 64-character hexadecimal AES-256 key; invalid format prevents startup       | None    |

Generate **two separate values**:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Or run the following separately for each secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Preserve both across restarts, upgrades, and replicas. Changing `JWT_SECRET`
signs out users and changes API-key-derived account identifiers. Changing or
losing `ENCRYPTION_KEY` prevents decrypting saved credentials. Back up secrets
securely alongside the database; never commit them.

## TMDB

| Variable          | Description                                                                                            | Default             |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------- |
| `TMDB_API_KEY`    | Optional instance default for shared/background TMDB work; users still authenticate with their own key | Empty               |
| `TMDB_RATE_LIMIT` | Per-process TMDB token-bucket rate/capacity                                                            | `35` (`12` nightly) |
| `DEBUG_TMDB`      | Verbose outbound TMDB logging                                                                          | `false`             |

Key validity is checked for user authentication and configured addon/API access.
Confirmed invalid keys return 401 and permit export-only configuration recovery.
The short shared validity cache currently lasts 60 seconds; temporary upstream
failures are not proof a key is invalid.

After a connection reset or refusal from `api.themoviedb.org`, each process
sends TMDB API calls to `api.tmdb.org` (same TMDB backend) for 10 minutes, then
tries the official host again; a reset on `api.tmdb.org` switches back at once. Some Indian networks (e.g. Airtel, Oracle Cloud
India) intermittently reset `api.themoviedb.org` by TLS SNI; DNS changes do not
help. Cache keys and logs keep the `api.themoviedb.org` URL.

## Database

| Variable          | Description                                                                                                | Default       |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------- |
| `DATABASE_DRIVER` | `postgres`, `mongo`, or `memory`                                                                           | URI detection |
| `POSTGRES_URI`    | PostgreSQL connection URI; set with `DATABASE_DRIVER=postgres`                                             | Empty         |
| `MONGODB_URI`     | MongoDB connection URI; set with `DATABASE_DRIVER=mongo`                                                   | Empty         |
| `DATABASE_URL`    | Read into config but **not used by the storage selector**; map a provider-supplied value to `POSTGRES_URI` | Empty         |

An explicit `memory` driver selects volatile storage. Otherwise a matching
explicit driver/URI is used; URI detection prefers PostgreSQL over MongoDB,
falling back to memory with neither. Invalid/incomplete driver settings may
also fall through to detection: verify the actual driver in startup logs.
Failure to connect to the selected database prevents app startup; it does not
migrate app data into memory.

The app creates/migrates tables or collections and indexes at startup.
PostgreSQL requires DDL permissions and the `pg_trgm` extension, which a DBA may
need to install first on managed services. Admin history needs its own
`obs_*` DDL/index permissions too.

## Cache & Redis

| Variable                      | Description                                                                         | Default                         |
| ----------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| `CACHE_DRIVER`                | `redis` or `memory`                                                                 | URI detection                   |
| `REDIS_URL`                   | Redis URI for cache, rate limits and user-token revocation                          | Empty                           |
| `CACHE_MAX_KEYS`              | In-memory cache maximum keys with eviction                                          | `20000` (`6000` nightly)        |
| `CACHE_VERSION_OVERRIDE`      | Override the cache namespace/version; changing it invalidates effective cache reuse | Empty                           |
| `CACHE_WARM_REGIONS`          | Comma-separated ISO country codes for startup warming                               | `US,GB,DE,FR,ES` (`US` nightly) |
| `DEMAND_FIRST_FETCHING`       | Share canonical series episodes and avoid speculative IMDb next-page enrichment     | `true`                          |
| `BACKGROUND_PRIORITY_ENABLED` | Bound opportunistic refreshes and leave capacity for foreground work                | `true`                          |

With a Redis URL, initial cache and request-rate-limit connections each have a
two-second deadline. If either cannot connect, that service falls back to
process-local memory **until the process restarts**, even if Redis later
recovers. `/health` reports these fallbacks as degraded. Without a Redis URL,
the cache uses memory even if the driver says `redis`.

JWT revocation does not fall back when `REDIS_URL` is configured. Its Redis
connection continues reconnecting after the startup deadline; verification and
logout fail closed with HTTP 503 until the shared store is available. `/ready`
also returns 503 while the revocation store or an already-selected Redis
rate-limit store is disconnected. Once a Redis-backed rate limiter has started,
runtime failures return 503 rather than silently switching to local limits.
Redis-backed cache reads and writes fail promptly during a disconnect and
resume after reconnection. Cache, request-limiter, revocation and live-store
commands have a two-second response deadline; the clients send a Redis PING
every two seconds and reconnect after a four-second socket stall. Each of these
clients rejects new commands with `The queue is full` once 1,000 are pending, so
a socket that accepts writes but never replies cannot grow memory without bound;
when writes stop, the stall timeout reconnects it. A write that
times out may still reach Redis, so retry logout if its result is uncertain.
Logout only records revocations for unexpired tokens signed by this server.

Readiness checks connection state, not Redis command permissions or retained
data: a connected Redis can still reject requests while `/ready` returns 200.
An undetected socket stall can take several seconds to change readiness.
Cache reconnection and the admission recovery cooldown are not readiness
dependencies, so provider-key validation can briefly return 503 after readiness
recovers.
An unavailable observability store makes `/health` degraded, but is not a
readiness dependency, so an admin outage alone does not remove an otherwise
usable replica from service.

Redis must retain user revocation keys until their TTLs expire. Use `noeviction`
with sufficient capacity and an appropriate persistence/failover policy: eviction
or data loss can make revoked tokens valid again. If `noeviction` rejects writes
under memory pressure, logout fails closed and rate-limited requests can fail
until capacity is restored.

`CACHE_DRIVER=memory` skips cache Redis, but other services can still use
`REDIS_URL`. For an entirely Redis-free local test, clear both `REDIS_URL` and
`OBS_REDIS_URL`. Memory cache/rate limits/revocation are process-local, not a
multi-replica replacement. Configuration persistence is a separate database
choice.

Demand-first fetching keeps complete series episode lists while reusing a
locale-specific, artwork-independent snapshot across configurations. It also
reuses cached full TMDB details for compatible previews, retains eligible
historical IMDb season data longer, and changes active-series metadata freshness
from 24 to 6 hours. When a freshness marker has expired, eligible completed seasons may
reuse a retained IMDb response less than 21 days old. IMDb pages are enriched
when requested, not automatically in advance.
Cold series can still query IMDb for every regular season and two additional
seasons so IMDb-only episodes are not discarded. Gap-first ordering and
historical reuse do not eliminate those cold requests.
The per-season IMDb cache and stale serving can affect how quickly upstream
changes appear; the six-hour metadata TTL is not a guarantee of upstream
freshness.

Set `DEMAND_FIRST_FETCHING=false` and restart to disable those demand-first
optimizations, restore automatic next-page IMDb enrichment, and return the
active-series response TTL to 24 hours. Safety checks for incomplete episodes
and season-count changes remain enabled. Set `BACKGROUND_PRIORITY_ENABLED=false`
independently to remove the separate background cap/reservations and restore
parallel startup warming; the existing shared work and provider limits still apply. Use the same
settings on all replicas. Existing cache entries expire under their stored
lifetimes; changing `CACHE_VERSION_OVERRIDE` forces a cold cache and can cause
an upstream traffic spike. A full rollback requires deploying the previous
release.

## IMDb Ratings

This dataset enrichment is separate from the IMDb catalog API.

| Variable                    | Description                       | Default |
| --------------------------- | --------------------------------- | ------- |
| `IMDB_RATINGS_DISABLED`     | Disable IMDb ratings enrichment   | `false` |
| `IMDB_RATINGS_UPDATE_HOURS` | Dataset refresh interval in hours | `24`    |
| `IMDB_MIN_VOTES`            | Minimum votes for enrichment      | `100`   |

## External Artwork APIs

| Variable              | Description                 | Default        |
| --------------------- | --------------------------- | -------------- |
| `RPDB_API_KEY`        | Instance RatingPosterDB key | `t0-free-rpdb` |
| `TOP_POSTERS_API_KEY` | Instance TOP Posters key    | Empty          |
| `FANART_API_KEY`      | Instance Fanart.tv key      | Empty          |

Users may also configure provider credentials/preferences in the builder.
These settings do not provision external services.

## IMDb Source

This source requires a compatible IMDb API service. It remains available on
nightly when configured.

| Variable               | Description                                                                  | Default                   |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------------- |
| `IMDB_DATA_ENABLED`    | Explicitly enable/disable; `true`/`1` enables, other nonempty values disable | Enabled when a key is set |
| `IMDB_DATA_KEY`        | Credential sent to the service                                               | Empty                     |
| `IMDB_DATA_HOST`       | Host without protocol                                                        | Empty                     |
| `IMDB_DATA_ATTR_K`     | Header name for the service credential                                       | Empty                     |
| `IMDB_DATA_ATTR_H`     | Header name for the service host                                             | Empty                     |
| `IMDB_DATA_RATE_LIMIT` | Per-process IMDb requests per second                                         | `5`                       |

Enabling the source does not install its backend. The client uses HTTPS for
normal hosts; hosts recognized as local (`localhost`, `127.0.0.1`, or
`imdb-api`, including `imdb-api:8787`) use HTTP. Do not assume an arbitrary IMDb/RapidAPI product has compatible
routes or authentication.

IMDb cache overrides are in **seconds**:

| Variable                   | Default   |
| -------------------------- | --------- |
| `IMDB_CACHE_TTL_SEARCH`    | `86400`   |
| `IMDB_CACHE_TTL_DETAIL`    | `604800`  |
| `IMDB_CACHE_TTL_RANKING`   | `86400`   |
| `IMDB_CACHE_TTL_POPULAR`   | `21600`   |
| `IMDB_CACHE_TTL_LIST`      | `21600`   |
| `IMDB_CACHE_TTL_REFERENCE` | `2592000` |

Most other TTLs are constants in
[`cacheTtls.ts`](../server/src/cacheTtls.ts), not environment settings.
The admin Caching tab lists effective runtime values and distinguishes HTTP
freshness, stale serving, and physical retention.

## MAL and Simkl

| Variable           | Description                                                          | Default                    |
| ------------------ | -------------------------------------------------------------------- | -------------------------- |
| `MAL_CLIENT_ID`    | Instance MAL client ID; users can also supply one                    | Empty                      |
| `MAL_RATE_LIMIT`   | Per-process MAL API requests per second                              | `3`                        |
| `JIKAN_API_BASE`   | Jikan base URL including `/v4`, used for Jikan-backed MAL operations | `https://api.jikan.moe/v4` |
| `SIMKL_CLIENT_ID`  | Instance Simkl client/API key; users can also supply one             | Empty                      |
| `SIMKL_RATE_LIMIT` | Per-process Simkl API requests per second                            | `5`                        |

AniList and Kitsu do not require instance API credentials. Individual operations
and source availability depend on instance/user configuration.

## Logging and Feature Flags

| Variable             | Description                                                                   | Default |
| -------------------- | ----------------------------------------------------------------------------- | ------- |
| `LOG_LEVEL`          | `debug`, `info`, `warn`, `error`                                              | `info`  |
| `LOG_FORMAT`         | `text` or `json`                                                              | `text`  |
| `DISABLE_RATE_LIMIT` | Disable app rate limits only in `development`/`test`; ignored in production   | `false` |
| `ADDON_VARIANT`      | `nightly` changes addon identity/name and resource defaults; unset for stable | Stable  |

## Admin Dashboard & Observability

Production admin UI: `/admin`. It returns 404 unless a valid admin setup is
configured and the frontend is built. The Vite development entry is
`/admin.html`. Normal app logging and health endpoints do not require admin
collection.

| Variable                   | Description                                                                                                                                                                            | Default          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ADMIN_USERNAME`           | Admin login name                                                                                                                                                                       | Disabled         |
| `ADMIN_PASSWORD`           | Plain password, at least 16 characters; rotate to invalidate admin sessions                                                                                                            | Disabled         |
| `ADMIN_PASSWORD_HASH`      | Alternative scrypt hash; takes precedence over plain password                                                                                                                          | Unset            |
| `ADMIN_TOTP_SECRET`        | Optional base32 authenticator secret; generate under Security and persist in environment                                                                                               | Off              |
| `ADMIN_ALLOWED_IPS`        | Comma-separated permitted IPs/CIDRs                                                                                                                                                    | Any              |
| `TRUST_CLOUDFLARE_HEADERS` | Honor `CF-*` headers only when trusted ingress enforces Cloudflare provenance/strips forged headers                                                                                    | `false`          |
| `OBS_SAMPLE_RATE`          | Fraction (0–1) of ordinary requests retained, including ordinary 4xx; 5xx, slow (at least 1.5s) and error-logging requests are retained independently; live counters count all traffic | `1`              |
| `OBS_RETENTION_DAYS`       | History retention, clamped to 1–90 days                                                                                                                                                | `7`              |
| `OBS_MAX_STORAGE_MB`       | Postgres/Mongo history cap; oldest days expire early, current-day overflow pauses new request history; `0` disables                                                                    | `1024`           |
| `OBS_REDIS_URL`            | Optional dedicated Redis for live metrics, admin lockout/revocation                                                                                                                    | Uses cache Redis |
| `OBS_ALERT_WEBHOOK_URL`    | Optional HTTPS generic-JSON health notification endpoint; no redirects or embedded URL credentials                                                                                     | Off              |
| `HOSTNAME`                 | Instance identifier, normally supplied by container runtime                                                                                                                            | OS hostname      |

Generate `ADMIN_PASSWORD_HASH` with `npm --prefix server run admin:hash` from
the repository root. See [admin setup](self-hosting.md#admin-dashboard-and-cache-analytics)
for container commands and TOTP. Invalid hashes/TOTP settings disable admin
access and are reported in startup logs. Admin sessions last eight hours.

Collection is opt-in with admin credentials. Request/error/upstream history
uses the application database, not an additional database service:

| Setup          | History                                               | Live counters/tail                          |
| -------------- | ----------------------------------------------------- | ------------------------------------------- |
| PostgreSQL     | `obs_*` tables/partitions                             | Redis if configured, otherwise this process |
| MongoDB (4.4+) | `obs_*` collections with TTL indexes                  | Redis if configured, otherwise this process |
| Memory         | Last 10,000 requests (3,000 nightly), lost on restart | Redis if configured, otherwise this process |

History initialization can fall back to bounded memory if database history
tables/indexes cannot be opened; check the dashboard persistence indicator.
History caps do not delete ordinary application data.

The admin Caching tab reports the actual history, cache and live-counter backends
separately, retention/storage limits, and matching retained timestamp bounds.
Selecting `7d` is a query window, not a guarantee of seven days of retained data.
Layer/freshness/error details start with newly instrumented records; older
records still contribute to the existing lookup rates, not to detailed counts.
Redis can be in use for cache and live counters while request history is memory.

For `OBS_REDIS_URL`, use a **separate Redis instance with `noeviction`** to
avoid app-cache eviction deleting counters or revocations. Different logical
databases on the same Redis do not isolate eviction. An explicitly configured
observability Redis fails closed for the admin session store when unavailable,
instead of silently choosing a different store. The same applies when the live
store uses the shared cache Redis. Admin operations fail until Redis reconnects;
live metrics may be dropped during the outage, while request
history continues when its storage is available. When moving the live store,
rotate the admin password/hash in the same rollout: old lockouts/revocations
are not copied.

Health checks run every minute without an open dashboard over the previous
five completed minutes. A minute with at least 20 requests is flagged at
**5xx >1%**, **4xx >5%**, or **slow >15%**; upstream 429s are included too.
Notifications are coalesced for five minutes across shared Redis (per process
otherwise). Failures are logged/retried; without a webhook, notifications are
logs only. Payloads contain counts/time bounds/provider names, not config IDs,
paths, or search terms. Use an adapter for Slack/Discord if needed.
These are investigation signals: a 4xx is not automatically a server defect.

Overview process-start markers are not proof of deployments. Counters are
per-process since startup; inactive live instances disappear after 24 hours,
without deleting retained system history. Newly captured search paths are
redacted; existing history is not rewritten and expires normally. Error-group
first-seen versions identify fingerprints, not necessarily new bugs (2.12.1
changed fingerprint identity).

Request exploration supports `sort=newest|duration|upstream`, `minMs`, `maxMs`,
`minUpstreamCalls`, and `userHash`. Event counts are stored rows, not weighted
traffic estimates; sampled cache analytics are weighted estimates. Invalid
custom time ranges return 400. See [cache metric definitions](architecture.md#cache-observability).

## Nightly Resource Profile

Set `ADDON_VARIANT=nightly` (not `NODE_ENV=nightly`):

| Setting               | Stable default     | Nightly default    |
| --------------------- | ------------------ | ------------------ |
| `TMDB_RATE_LIMIT`     | `35`               | `12`               |
| `CACHE_MAX_KEYS`      | `20000`            | `6000`             |
| `CACHE_WARM_REGIONS`  | `US,GB,DE,FR,ES`   | `US`               |
| Startup cache warming | Enabled            | Skipped            |
| IMDb source/ratings   | Environment-driven | Environment-driven |

The addon ID becomes `community.tmdb.discover.plus.nightly` and its display name
becomes `TMDB Discover+ (Nightly)`. Explicit settings override numeric/cache
defaults; choosing this variant does not itself select memory storage.

## Local Development Example

Replace placeholders with independently generated secrets:

```dotenv
NODE_ENV=development
DATABASE_DRIVER=memory
CACHE_DRIVER=memory
REDIS_URL=
OBS_REDIS_URL=
BASE_URL=http://localhost:5173
TRUST_PROXY=0
DISABLE_RATE_LIMIT=true
LOG_LEVEL=debug
JWT_SECRET=<generated-secret-at-least-32-characters>
ENCRYPTION_KEY=<generated-64-hex-characters>
```

For persistent hosting use the [complete Compose/manual guide](self-hosting.md).
Compose-only settings such as `POSTGRES_PASSWORD` are not app settings. Older
Compose files forward `IMDB_BUDGET_*`, but the current app does not read or
enforce those variables.
