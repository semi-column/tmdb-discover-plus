# API Reference

All endpoints are served from the Express server. Rate limits are per IP address.

## Auth

| Method | Path               | Rate Limit | Auth                    |
| ------ | ------------------ | ---------- | ----------------------- |
| POST   | `/api/auth/login`  | 60/min     | none                    |
| POST   | `/api/auth/logout` | 300/min    | Bearer token (optional) |
| GET    | `/api/auth/verify` | 60/min     | Bearer token            |

### POST `/api/auth/login`

Validates a TMDB API key and returns a JWT session token, the selected
configuration, and safe configuration summaries. Decrypted API keys are not
returned.

Confirmed invalid keys return `401` with `code: INVALID_API_KEY`.
When associated saved configurations exist, login/verification also return
`recoveryConfigs` for export-only recovery. These contain catalog/preferences
data, not API keys; they do not grant editing or addon access. Temporary TMDB
verification failures return `503`, not an invalid-key verdict. A valid JWT
does not bypass validation of a subsequently rejected TMDB key.

**Request:**

```json
{
  "apiKey": "your-tmdb-api-key",
  "userId": "optional-existing-user-id",
  "rememberMe": true
}
```

**Response:**

```json
{
  "token": "eyJ...",
  "expiresAt": "2026-02-21T00:00:00.000Z",
  "userId": "abc123",
  "configName": "My Config",
  "isNewUser": false,
  "configs": [{ "userId": "abc123", "configName": "My Config" }]
}
```

### POST `/api/auth/logout`

Revokes the bearer token server-side.

**Headers:** `Authorization: Bearer <token>`

**Response:** `{ "success": true }`

### GET `/api/auth/verify`

Checks if a JWT is still valid.

**Headers:** `Authorization: Bearer <token>`

**Response:**

```json
{ "valid": true, "userId": "abc123", "configName": "My Config" }
```

---

## Config Management

All config endpoints require `Authorization: Bearer <token>`.

| Method | Path                  | Rate Limit | Auth                                 |
| ------ | --------------------- | ---------- | ------------------------------------ |
| GET    | `/api/configs`        | 300/min    | requireAuth + resolveApiKey          |
| POST   | `/api/config`         | 60/min     | requireAuth + resolveApiKey          |
| GET    | `/api/config/:userId` | 300/min    | requireAuth + requireConfigOwnership |
| PUT    | `/api/config/:userId` | 60/min     | requireAuth + requireConfigOwnership |
| DELETE | `/api/config/:userId` | 60/min     | requireAuth + requireConfigOwnership |

### GET `/api/configs`

List all configs belonging to the authenticated API key.

**Response:**

```json
[
  {
    "userId": "abc123",
    "configName": "My Config",
    "catalogs": [...],
    "preferences": {...},
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-02-01T00:00:00.000Z"
  }
]
```

### POST `/api/config`

Create a new config. A `userId` is auto-generated.

**Request:**

```json
{
  "catalogs": [
    {
      "id": "catalog-id",
      "name": "Trending Movies",
      "type": "movie",
      "listType": "trending",
      "filters": { "genre": [28], "voteAverageGte": 7 }
    }
  ],
  "preferences": {
    "language": "en",
    "includeAdult": false,
    "posterService": "tmdb"
  },
  "configName": "My Config"
}
```

**Response:**

```json
{
  "userId": "abc123",
  "configName": "My Config",
  "catalogs": [...],
  "preferences": {...},
  "installUrl": "https://host/abc123/manifest.json",
  "stremioUrl": "stremio://host/abc123/manifest.json",
  "configureUrl": "https://host/?userId=abc123"
}
```

### GET `/api/config/:userId`

Get a specific config. Must be the owner.

### PUT `/api/config/:userId`

Update a config. Same request body as POST.

### DELETE `/api/config/:userId`

Delete a config.

**Response:** `{ "success": true }`

---

## Reference Data

`/api/reference-data` requires both bearer authentication and TMDB API-key
resolution (`requireAuth + resolveApiKey`).

Collection lookups also require `requireAuth + resolveApiKey`:

| Method | Path                     | Purpose                 |
| ------ | ------------------------ | ----------------------- |
| GET    | `/api/search/collection` | Search TMDB collections |
| GET    | `/api/collection/:id`    | Collection details      |

Batch endpoint for all reference data (cached 7 days server-side):

| Method | Path                  | Rate Limit | Auth        |
| ------ | --------------------- | ---------- | ----------- |
| GET    | `/api/reference-data` | 300/min    | requireAuth |

**Response:** Object with keys: `genres`, `languages`, `originalLanguages`, `countries`, `sortOptions`, `listTypes`, `presetCatalogs`, `releaseTypes`, `tvStatuses`, `tvTypes`, `monetizationTypes`, `certifications`, `watchRegions`, `tvNetworks`.

Individual endpoints (all `requireAuth` + `resolveApiKey`, 300/min):

| Method | Path                                   | Description                                                         |
| ------ | -------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/genres/:type`                    | Genre list (`movie` or `series`) — `[{ id, name }]`                 |
| GET    | `/api/languages`                       | Language list — `[{ iso_639_1, english_name, name }]`               |
| GET    | `/api/original-languages`              | Original language list                                              |
| GET    | `/api/countries`                       | Country list — `[{ iso_3166_1, english_name }]`                     |
| GET    | `/api/certifications/:type`            | Content ratings by country                                          |
| GET    | `/api/watch-providers/:type?region=US` | Streaming providers — `[{ provider_id, provider_name, logo_path }]` |
| GET    | `/api/watch-regions`                   | Available watch-provider regions                                    |

Static data (no auth):

| Method | Path                      | Description                                       |
| ------ | ------------------------- | ------------------------------------------------- |
| GET    | `/api/sort-options`       | Sort options                                      |
| GET    | `/api/list-types`         | List types (trending, popular, etc.)              |
| GET    | `/api/preset-catalogs`    | Pre-built catalog definitions                     |
| GET    | `/api/release-types`      | Movie release types                               |
| GET    | `/api/tv-statuses`        | TV show statuses                                  |
| GET    | `/api/tv-types`           | TV show types                                     |
| GET    | `/api/monetization-types` | Monetization types                                |
| GET    | `/api/tv-networks?query=` | TV networks (optionalAuth — search requires auth) |

---

## Search & Entity Lookup

All require `requireAuth` + `resolveApiKey`, 300/min.

| Method | Path                  | Query Params       | Response              |
| ------ | --------------------- | ------------------ | --------------------- |
| GET    | `/api/search/person`  | `query` (required) | `[{ id, name, ... }]` |
| GET    | `/api/search/company` | `query` (required) | `[{ id, name, ... }]` |
| GET    | `/api/search/keyword` | `query` (required) | `[{ id, name }]`      |
| GET    | `/api/person/:id`     | —                  | `{ id, name }`        |
| GET    | `/api/company/:id`    | —                  | `{ id, name }`        |
| GET    | `/api/keyword/:id`    | —                  | `{ id, name }`        |
| GET    | `/api/network/:id`    | —                  | `{ id, name, logo }`  |

---

## Preview

| Method | Path           | Rate Limit | Auth                        |
| ------ | -------------- | ---------- | --------------------------- |
| POST   | `/api/preview` | 300/min    | requireAuth + resolveApiKey |

Live preview of discover results during catalog configuration.

**Request:**

```json
{
  "type": "movie",
  "filters": {
    "genre": [28, 12],
    "voteAverageGte": 7,
    "sortBy": "popularity.desc"
  },
  "page": 1
}
```

**Response:**

```json
{
  "metas": [{ "id": "tmdb:12345", "name": "...", "poster": "...", "type": "movie" }],
  "totalResults": 500,
  "totalPages": 25,
  "page": 1,
  "previewEmpty": false
}
```

---

## Validation & Stats

| Method | Path                | Auth | Description                                                           |
| ------ | ------------------- | ---- | --------------------------------------------------------------------- |
| POST   | `/api/validate-key` | none | Validate a TMDB API key — `{ valid: boolean, error? }`                |
| GET    | `/api/status`       | none | Version, build info, uptime, database/cache type, user/catalog counts |
| GET    | `/api/stats`        | none | Public user/catalog counts — `{ users, catalogs, addonVariant }`      |

---

## Source-specific APIs

All routes below require bearer authentication (`requireAuth`). Source
implementations determine additional credentials; not every route uses TMDB
`resolveApiKey`. Preview request/response shapes are source-specific.

| Method | Path                           |
| ------ | ------------------------------ |
| POST   | `/api/imdb/preview`            |
| GET    | `/api/imdb/search`             |
| GET    | `/api/imdb/list/:id/validate`  |
| GET    | `/api/imdb/search/people`      |
| GET    | `/api/imdb/search/companies`   |
| GET    | `/api/imdb/search/suggestions` |
| POST   | `/api/anilist/preview`         |
| GET    | `/api/anilist/studios`         |
| POST   | `/api/mal/preview`             |
| POST   | `/api/kitsu/preview`           |
| POST   | `/api/simkl/preview`           |

## Source credentials

| Method | Path                      | Auth                          |
| ------ | ------------------------- | ----------------------------- |
| POST   | `/api/source-key`         | `requireAuth + resolveApiKey` |
| GET    | `/api/source-keys`        | `requireAuth + resolveApiKey` |
| POST   | `/api/validate-mal-key`   | `requireAuth`                 |
| POST   | `/api/validate-simkl-key` | `requireAuth`                 |
| POST   | `/api/validate-tvdb-key`  | `requireAuth`                 |

Source-key storage accepts MAL and Simkl credentials. An instance can also
supply `MAL_CLIENT_ID` or `SIMKL_CLIENT_ID`. TVDB artwork credentials use the
authenticated configuration flow, not a TVDB environment variable.
See [environment settings](environment.md) for instance-level source options.

## Marketplace

| Method | Path                                | Auth            |
| ------ | ----------------------------------- | --------------- |
| GET    | `/api/marketplace/search`           | Optional bearer |
| GET    | `/api/marketplace/:id`              | Optional bearer |
| POST   | `/api/marketplace/reconcile`        | `requireAuth`   |
| GET    | `/api/marketplace/reconcile/status` | `requireAuth`   |
| POST   | `/api/marketplace/publish`          | `requireAuth`   |
| POST   | `/api/marketplace/:id/unpublish`    | `requireAuth`   |
| POST   | `/api/marketplace/:id/install`      | `requireAuth`   |
| POST   | `/api/marketplace/:id/like`         | `requireAuth`   |
| DELETE | `/api/marketplace/:id/like`         | `requireAuth`   |

Authenticated operations also enforce their applicable ownership/configuration
checks; a valid token alone is not permission to change another user's catalog.

## Stremio Addon Protocol

The configured manifest is generated from saved catalogs, sources, types and
protocol extras, not a fixed TMDB-only catalog list. The root
`GET /manifest.json` is a configuration entry point with no advertised resources
or content types. Install a configured `/:userId/manifest.json`.

Configured addon requests need no bearer header, but the saved configuration's
TMDB key must remain valid. Confirmed invalid keys produce `401 INVALID_API_KEY`
before serving cached successful content. Bare `/catalog/...` and `/meta/...`
paths return `404 CONFIG_REQUIRED` for the named unsupported routes.
Other unsupported paths can return an ordinary 404 or be rejected by ingress.

These endpoints implement the [Stremio addon protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md). No authentication required — config is resolved from the `userId` path segment.

Rate limit: 1000/min. All responses include ETag headers for caching.

| Method | Path                                            | Description                                                 |
| ------ | ----------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/:userId/manifest.json`                        | Addon manifest with user's catalogs, types, genre filters   |
| GET    | `/:userId/catalog/:type/:catalogId.json`        | Catalog listing                                             |
| GET    | `/:userId/catalog/:type/:catalogId/:extra.json` | Catalog with pagination/filters (`skip`, `genre`, `search`) |
| GET    | `/:userId/meta/:type/:id.json`                  | Full metadata for a title                                   |
| GET    | `/:userId/meta/:type/:id/:extra.json`           | Metadata with display language options                      |

**Catalog Response:**

```json
{
  "metas": [
    {
      "id": "tt1234567",
      "name": "Movie Title",
      "type": "movie",
      "poster": "https://image.tmdb.org/...",
      "imdbRating": "7.5",
      "year": "2026",
      "genres": ["Action", "Adventure"]
    }
  ],
  "cacheMaxAge": 300,
  "staleRevalidate": 600
}
```

**Meta Response:**

```json
{
  "meta": {
    "id": "tt1234567",
    "name": "Movie Title",
    "type": "movie",
    "poster": "https://...",
    "background": "https://...",
    "logo": "https://...",
    "description": "...",
    "genres": ["Action"],
    "imdbRating": "7.5",
    "year": "2026",
    "runtime": "120 min",
    "cast": ["Actor One", "Actor Two"],
    "director": ["Director Name"],
    "links": [{ "name": "Action", "category": "Genres", "url": "stremio://..." }]
  }
}
```

---

## Operational

| Method | Path | Description |
| ------ | --------- | ---------------------------------------------------------------- | ------------- |
| GET | `/health` | Runtime diagnostics; 503 while starting or shutting down, 200 for healthy or degraded operation |
| GET | `/ready` | Readiness probe — `{ ready: boolean, cacheWarming: "in_progress" | "complete" }` |

---

## Rate Limit Summary

| Tier   | Limit        | Applies To                           |
| ------ | ------------ | ------------------------------------ |
| Global | 300 req/min  | All routes                           |
| API    | 300 req/min  | `/api/*` (stacks with global)        |
| Strict | 60 req/min   | Auth login/verify, config writes     |
| Addon  | 1000 req/min | `/:userId/*` Stremio protocol routes |

## Error Responses

All errors return JSON:

```json
{
  "error": "Human-readable error message",
  "code": "OPTIONAL_ERROR_CODE"
}
```

| Status | Meaning                                                   |
| ------ | --------------------------------------------------------- |
| 400    | Bad request (validation failure)                          |
| 401    | Unauthorized (missing/invalid/expired token)              |
| 403    | Forbidden (not the config owner)                          |
| 404    | Not found                                                 |
| 429    | Rate limited                                              |
| 500    | Internal server error                                     |
| 503    | Service unavailable (circuit breaker open, shutting down) |
