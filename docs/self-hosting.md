# Self-hosting

This guide covers a single-instance deployment, persistent storage, HTTPS, admin
setup, backups, and upgrades. The public ElfHosted service is managed separately;
the repository's DuckDNS/Caddy files are not its production configuration.

## Choose a deployment

| Setup                                    | Use                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Published container + PostgreSQL + Redis | Recommended persistent self-hosted setup below                         |
| Node.js + PostgreSQL or MongoDB          | Manual deployment or a platform with managed services                  |
| Memory storage/cache                     | Local evaluation only; configurations and history disappear on restart |

Use Docker Engine with the Compose v2 plugin (`docker compose`), or Node.js
22.16+ for a source installation. Node.js 24 is used in CI. Containers are
published for `linux/amd64` and `linux/arm64`.

You need a valid TMDB API key to use the configuration builder. Users sign in
with their own keys; an instance-wide `TMDB_API_KEY` is optional and is not a
replacement for user authentication. Other catalog sources have additional
[configuration options](environment.md).

## Docker Compose: PostgreSQL + Redis

Create a dedicated directory. Save the following as `compose.selfhost.yml`.
Unlike the repository's existing all-services Compose file, this example does
not start MongoDB or publish database/cache ports.

```yaml
services:
  addon:
    image: ghcr.io/semi-column/tmdb-discover-plus:latest
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      PORT: '7000'
      DATABASE_DRIVER: postgres
      POSTGRES_URI: postgresql://tmdb:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@postgres:5432/tmdb_discover
      CACHE_DRIVER: redis
      REDIS_URL: redis://redis:6379
    ports:
      - '127.0.0.1:7000:7000'
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://127.0.0.1:7000/ready']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: tmdb
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: tmdb_discover
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U tmdb -d tmdb_discover']
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ['redis-server', '--appendonly', 'yes']
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

Create `.env` beside it:

```dotenv
# Generate THREE separate values with: openssl rand -hex 32
JWT_SECRET=replace-with-first-generated-value
ENCRYPTION_KEY=replace-with-second-generated-value
POSTGRES_PASSWORD=replace-with-third-generated-value

# Local browser test; change these before exposing through your HTTPS proxy.
BASE_URL=http://localhost:7000
TRUST_PROXY=0
LOG_LEVEL=info

# Optional: enable /admin with a password of at least 16 characters.
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=replace-with-a-separate-strong-password
```

Use a hex database password in this example so it is safe inside the connection
URI. Other passwords must be URL-encoded. Protect `.env` (`chmod 600 .env` on
Unix) and never commit it. The two application secrets must remain stable across
restarts and upgrades.

```bash
docker compose -f compose.selfhost.yml config --quiet
docker compose -f compose.selfhost.yml pull
docker compose -f compose.selfhost.yml up -d
docker compose -f compose.selfhost.yml ps
docker compose -f compose.selfhost.yml logs --tail=100 addon
curl --fail http://localhost:7000/ready
```

Open `http://localhost:7000/configure`. An enabled admin dashboard is at
`http://localhost:7000/admin`.

`latest` tracks stable releases. For reproducible deployments, replace it with a
published version such as `:2.13.1` (no leading `v`) or an image digest after
checking the [release notes](https://github.com/semi-column/tmdb-discover-plus/releases).
The release workflow also publishes major/minor tags. Docker Hub mirroring is
conditional on maintainer publishing credentials; GHCR is the documented registry.

### Build the image yourself

From a repository checkout, the Dockerfile builds the frontend and installs
production dependencies:

```bash
docker build -f Dockerfile.docker -t tmdb-discover-plus:local .
```

Replace the `addon` service's `image` with `tmdb-discover-plus:local` in your
Compose file and run `up -d`; do not run `pull` for that local tag.

### Existing repository Compose files

- `docker-compose.yml` builds the app and starts **PostgreSQL, MongoDB, and Redis**
  together, even if only one database is selected. It publishes their ports,
  uses a fixed local PostgreSQL password, hardcodes the app's Redis URL, and
  forwards only an explicit subset of environment variables. A `.env` file
  supplies interpolation values; it does not automatically pass every variable
  to the app. In particular, admin/proxy/observability settings need explicit
  forwarding or an `env_file`. Treat this as a local stack, not a secured
  production quick start.
- `docker-compose.production.yml` and `Caddyfile` describe the project's bespoke
  DuckDNS **nightly** deployment, not ElfHosted production. That VM also runs
  Redis and a separate `imdb-api` service. The files require an `imdb-api:latest` image, configure a fixed
  hostname and upstreams, and do not provision an application database. They
  are **not** a generic self-hosting or ElfHosted recipe.
  Redis cache/live counters do not imply database-backed request history; check
  the Caching tab's actual history backend and retained coverage.
- There is no `docker-compose.dev.yml`; use the [development commands](../README.md#development).

Use a distinct Compose project/directory if another instance is already running.
Do not run an old and new stack against the same ports or assume changing the
Compose filename migrates its database volume.

## Manual installation

Install Node.js 22.16+ (Node.js 24 recommended), npm, and your chosen database.
Redis is optional for one process, but recommended for shared cache, rate limits,
and token revocation across replicas.

```bash
git clone https://github.com/semi-column/tmdb-discover-plus.git
cd tmdb-discover-plus
npm ci
npm --prefix server ci
npm --prefix client ci
cp .env.example .env
```

Edit `.env`: replace both secrets, configure real database/cache connections, and
set the public URL and proxy trust. For a local-only, disposable test, explicitly
set `DATABASE_DRIVER=memory`, `CACHE_DRIVER=memory`, `REDIS_URL=` and
`OBS_REDIS_URL=`. Memory mode is not persistent hosting.

```bash
npm --prefix client run build
npm start
```

Run these commands from the repository root so dotenv reads the root `.env`.
`npm start` serves both the built frontend and API on `PORT` (default `7000`).
Use your platform's process manager to supervise it; do not use the Vite dev
server for production.

The app also needs outbound access to TMDB and whichever source/artwork APIs
you enable. Background IMDb ratings and anime-ID data initialization can use
additional network and memory; monitor `/health` and the admin System page on
small instances. Disable IMDb ratings with `IMDB_RATINGS_DISABLED=true` if you
do not use that enrichment. The nightly resource profile changes addon identity
as well as defaults, so it is not a transparent production memory-saving switch.

### Managed platforms and external databases

Deploy the published container or use the manual build/start commands above.
Configure secrets using the platform's environment settings, attach a persistent
PostgreSQL or MongoDB service, and set `DATABASE_DRIVER` plus the matching
`POSTGRES_URI` or `MONGODB_URI`. **`DATABASE_URL` alone does not select or connect
the application database**; map a provider-supplied URL to `POSTGRES_URI`.

Use a database-specific URI and the provider's required TLS parameters. The app
creates/migrates its tables or collections and indexes at startup. PostgreSQL
needs permission to create tables/indexes and the `pg_trgm` extension (or ask your
provider/DBA to install that extension first). Admin history also needs DDL
permissions for its `obs_*` tables/partitions or collections/indexes.

Inject `PORT` if required by the platform; the app binds `0.0.0.0`. The
standalone image's built-in healthcheck has a `5000` fallback while the app
defaults to `7000`, so **set `PORT=7000` explicitly** or supply the platform's
port. The Compose example sets its port and healthcheck explicitly.

Use `/ready` for readiness; `/health` includes runtime/cache/degradation details.
A `200` health response can describe a degraded instance, so inspect its JSON
and startup logs rather than treating status alone as proof every dependency is
healthy.

## HTTPS and reverse proxies

Use a domain with valid HTTPS for remote Stremio clients. Set:

```dotenv
BASE_URL=https://addon.example.com
TRUST_PROXY=1
```

`BASE_URL` must be the externally reachable origin, without a trailing slash,
not the Docker service name or internal port. `TRUST_PROXY=1` assumes exactly one
trusted proxy; choose the hop count or trusted IP/CIDR configuration for your
network. Use `0` for direct access. Do not expose a directly reachable app port
while trusting arbitrary forwarded headers. The Compose example binds only
loopback for a proxy running on the host. A proxy in another container instead
needs a shared Docker network and `http://addon:7000` as its upstream.

Example nginx location inside an **already configured HTTPS virtual host**:

```nginx
location / {
    proxy_pass http://127.0.0.1:7000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

Disabling response buffering allows the admin live tail to stream. Keep the
admin UI and `/api/admin/*` on the same origin. Do not publicly cache
`/api/*`, configuration pages, admin responses, or `/manifest.json`; preserve
the app's cache headers on configured addon responses.

Only set `TRUST_CLOUDFLARE_HEADERS=true` when ingress genuinely enforces
Cloudflare provenance (for example, origin access is restricted to Cloudflare
or a trusted ingress strips client-supplied `CF-*` headers). Merely placing a
Cloudflare DNS record in front is not sufficient.

### Optional: reject old config-less addon traffic at ingress

Old bare-manifest installations can keep requesting unsupported resources.
They already receive an app-level 404, but an ingress rejection avoids app
middleware/logging/rate-limit work. On **this addon's hostname only**, block:

```text
/meta/*
/catalog/*
/stream/*
/subtitles/*
```

Match only the first path segment, not those segments anywhere in a path.
Preserve `/<userId>/meta/*`, `/<userId>/catalog/*`,
`/<userId>/manifest.json`, `/manifest.json`, `/configure`, `/api/*`, and assets.
Do not blanket-block `/.well-known/*`. Return 404 (including appropriate CORS
headers for browser clients), not a success or a redirect. The root manifest
is a configuration entry point, not an installed catalog/metadata manifest.

## Admin dashboard and cache analytics

Set `ADMIN_USERNAME` and either `ADMIN_PASSWORD` (at least 16 characters) or
`ADMIN_PASSWORD_HASH`, then recreate/restart the app. In production visit
`/admin`; it returns 404 when admin access is disabled.

To generate a hash without storing a plain admin password, from a checkout:

```bash
npm --prefix server run admin:hash
```

Or in the running Compose app:

```bash
docker compose -f compose.selfhost.yml exec addon \
  node --experimental-strip-types server/src/scripts/adminSetup.ts
```

Save the printed `ADMIN_PASSWORD_HASH` in `.env`, remove `ADMIN_PASSWORD` if
using the hash, and recreate the app. Hash takes precedence. TOTP setup is
available under **Security**; persist the generated `ADMIN_TOTP_SECRET` as
instructed there. You can restrict access with `ADMIN_ALLOWED_IPS`.

The dashboard includes Overview, Requests, Errors, Dependencies, Live tail,
Usage, Caching, System, Proxy diagnostics, and Security. The **Caching** tab
shows shared-cache lookup hit/miss percentages, request outcomes, miss-heavy
routes/paths, and current runtime TTL policy. A miss and an outbound call on
the same request are correlated, not necessarily causal; local/browser/CDN
caches are not included. See [architecture](architecture.md#cache-observability).

History uses the app database, or bounded process memory without one. Live
counters and admin revocations use Redis when configured. Defaults are seven
days of history and a 1 GiB Postgres/Mongo history cap; ordinary app data is
not subject to this cap. See [environment settings](environment.md#admin-dashboard--observability)
for sampling, retention, dedicated Redis, and optional alert webhooks.

## Backups and upgrades

Back up **both the application database and `ENCRYPTION_KEY`**. Preserve
`JWT_SECRET` too: changing it signs out users and changes API-key-derived account
identifiers. Losing/changing the encryption key prevents decrypting saved
credentials. Keep secrets in a separate protected backup, not public catalog
exports. Exports are useful for migration but are not database/credential backups.

For the Compose PostgreSQL example, from a protected backup directory:

```bash
docker compose -f compose.selfhost.yml exec -T postgres \
  pg_dump -U tmdb -d tmdb_discover -Fc > tmdb-discover.dump
```

Protect that dump: it includes private configuration and possibly dashboard
history. Test restores to a separate database before relying on a backup.
For MongoDB use your provider's backup tooling or `mongodump`/`mongorestore`.
Redis cache is rebuildable, but losing Redis also loses any revocation,
lockout, or live-history records stored there.

Before upgrading, read release notes, record the old image tag/digest, and make
a verified database/secret backup. Then, for an image deployment:

```bash
docker compose -f compose.selfhost.yml pull addon
docker compose -f compose.selfhost.yml up -d addon
docker compose -f compose.selfhost.yml logs --tail=100 addon
curl --fail http://localhost:7000/ready
```

For source installs, update to your chosen release, run `npm ci` in the root,
server, and client, rebuild the client, and restart your process manager.
Database/index migrations run at startup; a rollback may require restoring
the matching backup, not just changing the image tag.

Never use `docker compose down -v` during a routine upgrade: it deletes named
database volumes. Changing `POSTGRES_PASSWORD` in `.env` does not change the
password of an already initialized PostgreSQL volume; rotate it in PostgreSQL
as well and update the app URI.

Multiple replicas need the same database, encryption/JWT secrets, and shared
Redis. Memory-only cache/rate limits/revocation/history are process-local.
Review the dedicated `OBS_REDIS_URL` guidance before separating observability
from an evicting application cache.

## Troubleshooting

| Symptom                                    | Check                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Missing/invalid secrets                    | Generate both values, use exactly 64 hex characters for `ENCRYPTION_KEY`, and check the process working directory/env injection |
| Configurations disappear on restart        | Check the actual database driver in startup logs/status; do not rely on memory storage                                          |
| Redis retries or degraded status           | Verify the hostname is reachable **from the app**; `localhost` inside a container is not the Redis container                    |
| PostgreSQL startup permission error        | Check DDL and `pg_trgm` permissions, database credentials, and provider TLS requirements                                        |
| Wrong host or HTTP install URL             | Set public HTTPS `BASE_URL`, forward original host/protocol, and verify proxy trust                                             |
| `/admin` returns 404                       | Check admin credentials/startup validation and ensure the frontend was built                                                    |
| Cache analytics empty after startup        | Generate requests, allow a history flush (about five seconds), and check collection/history status; data is not backfilled      |
| Invalid TMDB key                           | Configured addon/API access returns 401; export configurations through recovery and import after signing in with a valid key    |
| Root `/meta/*` or `/catalog/*` returns 404 | Expected: install a configured `/<userId>/manifest.json`, not the root manifest                                                 |
