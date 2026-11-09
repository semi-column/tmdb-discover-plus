# Observability remediation report

Date: 2026-11-01

## Shared admission lifecycle and contention (November 7)

The contention reproduction generated 1,100 acquisition EVALs in 551 ms with
100 waiters for one full configuration. This proves polling amplification, not
the cause of the two post-deployment admission timeouts.

- Only the FIFO head for each configuration attempts Redis admission. Once
  global exhaustion is observed, configurations rotate through a single shared
  probe every 50 ms per process. Local queue changes/releases wake waiting work;
  the bounded polling fallback observes releases by other replicas. No Pub/Sub
  infrastructure or new dependency is needed. Queue bounds still include late
  commands until cleanup settles, but cancelled callers that sent no command
  free their local queue entries immediately.
- Lua acquisition remains atomic against the same global/configuration keys.
  Limits (60 global, 6/configuration), opportunistic reservations, five-second
  wait budget, 30-second leases and fail-closed outage policy are unchanged.
  Denial results distinguish global/configuration capacity for rejection logs;
  HTTP response shapes are unchanged. Acquisition-command duration is recorded
  separately as `addon_admission_redis`. No new Redis commands or ACL permissions
  are required.
- A permit's conservative local validity uses a monotonic clock from command
  start, minus a 1% margin. Delayed grants are released, not used. Expiry aborts
  active work even while renewal is pending; renewal cannot revive locally lost
  ownership. Completion also checks expiry before returning, covering delayed
  timer execution after a process pause.
- Cleanup-only shared-admission errors are explicitly logged without replacing
  the work's result or original error. Raw release callers still see rejection;
  orphaned capacity expires under the existing lease. Lease loss during work,
  including provider-masked aborts, still rejects the result.

Caller timeout is not proof of command cancellation: transmitted node-redis
commands can execute later. Late-grant cleanup and the existing hard deadline
are retained; ambiguous acquisitions are never replayed. Mixed application
versions use identical keys and grant semantics; an older client treats the new
global-denial code as a denial too.

These are load-control leases, not durable exclusive-write locks. Redis state
loss/eviction or failover can lose permits. Local FIFO/rotation is not a global
distributed fairness guarantee. The underlying production Redis delay still
requires server/network evidence; no limits or timeouts were raised to hide it.

Sources: [Redis production guidance](https://redis.io/docs/latest/develop/clients/nodejs/produsage/),
[node-redis command cancellation](https://github.com/redis/node-redis/blob/redis@6.0.0/docs/command-options.md),
[Redis lease validity](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/),
[expiring semaphore permits](https://redisson.pro/docs/data-and-services/locks-and-synchronizers/#permitexpirablesemaphore).

## Follow-up safeguards from the November 6 traces

- Legacy Trakt catalogs use the existing TMDB filter rules and publish as TMDB,
  preserving collection/studio IDs. Publication validates the enabled clone's
  selection, including disabled origins. Reconciliation logs and skips invalid
  projections without deleting existing entries. Already-damaged entries need
  republishing from a valid original; missing IDs are never guessed.
- Marketplace install validation returns `400 VALIDATION_ERROR`, not a storage
  `500`. Invalid entries or existing target catalogs leave the target and install
  counter unchanged. Genuine persistence failures still return `500`.
- TMDB API search rejects queries longer than 500 Unicode code points before
  cache lookup, pacing or HTTP. Valid queries are unchanged, not truncated.
- AniList local queue/deadline exhaustion is identified separately from provider
  `429`, and cannot create a 15-minute provider-error cache entry. Existing cached
  errors expire normally. Shared pacing, provider cooldowns, wait budgets and
  compatible degraded catalog responses remain unchanged.
- Artwork existence checks reuse the same URL's outcome within one response.
  Transient failure is retried on the next request; deadlines, fallback artwork,
  credential scopes and cross-request negative caching are unchanged.
- Season mismatch and batch-fallback warnings include expected/received counts.
  Snapshot completeness, stale-season fallback, enrichment budgets and TTLs are
  unchanged.
- Admin caching analytics/storage failures are logged and returned as explicit
  `historyErrors`; each available result and the TTL inventory remain visible.
  Missing analytics are not represented as zero rates. Live-store failures
  still fail explicitly; no database index or query-timeout changes were made.

Invalid credentials/selections require user action. Provider timeouts, genuine
quota exhaustion, changing episode counts and Redis/network delays remain
external or unproven causes: these safeguards do not claim to eliminate them.

## Redis failover crash and shutdown follow-up (2026-11-04, not deployed)

The request-rate Redis client had no `error` listener. A socket-close event
therefore escalated to `uncaughtException`, independently of the recovering
shared-admission client. The listener now attaches **before connect**, logs
socket errors, and lets node-redis retain its existing reconnect behavior.
The owned client is destroyed on failed startup and during shutdown. Request
limits, prefixes, headers, and existing initial-memory fallback are unchanged;
a runtime Redis outage does not silently switch shared limits to memory.

Shutdown now runs once across repeated signals/exceptions. It stops accepting
connections, explicitly ends admin Live Tail streams (including pending backlog
loads), and allows ordinary active HTTP requests **five seconds** to drain.
Remaining HTTP connections are then closed. Independent cleanup stages run in
parallel with **five-second** bounds and named duration/failure logs. An
uncaught exception or incomplete cleanup exits nonzero; a successful normal
stop exits zero. The existing 30-second watchdog remains a final safety net,
not the normal wait for asynchronous cleanup. Slow in-flight requests may be
terminated during shutdown; normal request deadlines are unchanged.

Observability gets one second for a final best-effort flush, then closes history
and live stores independently with three-second bounds. Redis live/subscriber
connections are destroyed rather than awaiting an offline queued `QUIT`.
Timed-out flushes may lose unpersisted telemetry; this is logged, not treated as
successful persistence. The incident logs do not identify which stage caused
the historical shutdown stall; the stream/flush/close weaknesses were reproduced
or directly verified, without claiming a single proven stall cause.

Validation:

- `npm --prefix server test`: **102 files passed; 1,126 tests passed, 54
  skipped**. The skipped tests require optional PostgreSQL/Mongo backends (36)
  or a local Redis executable (18). No production service was used.
- New runnable regressions cover socket error logging, startup cleanup,
  preserved rate prefixes, repeated/fatal signals, exact five-/ten-second
  drain/cleanup thresholds, late rejection, real HTTP streams, actual admin
  backlog races, and stalled observability flush/store closure.
- `npm --prefix server run typecheck` and `git diff --check`: passed.
- Two native Node 24 processes survived simultaneous **real TCP socket
  closure**, logged request-rate client errors, and reconnected to a disposable
  RESP test fixture. This verifies transport event handling, not Redis data
  persistence or a production failover.
- Native Node 24 startup/readiness and normal SIGTERM shutdown passed with
  memory backends and outbound fetch disabled; shutdown took 6 ms locally.
- Production Node 22 container validation remains unrun (Docker unavailable).
- No production deployment or production Redis failover was performed.

## Follow-up remediation (2026-11-04, not deployed)

The historical 02:00-09:30 browser interval was investigated read-only. Its TMDB
"429 retry" group actually contained three **500** retries from one request;
new fingerprints distinguish provider statuses and nested error metadata.
Historical fingerprints, counts, and triage states are not rewritten. Admin
labels explicitly identify all-time message/stack samples.

Implemented safeguards:

- TMDB page 501 and later return exhausted catalogs without an upstream call;
  locally paginated collections stop repeating their last page. Valid random
  catalogs and other providers retain their own pagination.
- Shared retries stop on deterministic 4xx, combine cancellation/deadline
  signals, and retain typed quota exhaustion without a final unnecessary sleep.
  AniList admits **every attempt** through one Redis-coordinated 2.1-second
  spacing/cooldown gate, or a bounded local gate in no-Redis mode. Redis mode
  remains fail-closed and recovers through the existing admission connection.
- AniList rejects GraphQL error/null/partial-page responses explicitly. Complete
  search pages use existing cache/coalescing with hashed effective-input keys.
- Invalid credentials, missing media, cancellation, and quota exhaustion do
  not trip the shared provider circuit breakers as availability failures.
- Concurrent TMDB credential validation and TVDB login are coalesced per
  credential, with cancellation-safe healthy-waiter recovery.
- Catalog error fallbacks retain their compatible empty body but are
  `no-store` and marked `X-Catalog-Status: degraded` (or TMDB `not-found`).
  Series results missing primary season data retain IMDb supplementation,
  carry a non-serialized incomplete marker through coalescing, and cannot
  overwrite complete cached metadata. Their HTTP/body cache hints disable
  caching. Existing cached results expire normally; no bulk cache flush occurs.
- Work-admission rejections log queue versus wait versus Redis failure.
  Genre warnings include mapping source/type/counts and bounded numeric IDs,
  without mutating filters or logging whole configurations.
- Artwork rejection remains credential/operation-scoped. Optional-feature
  guidance explains Top Posters Premium/enabled logos and TVDB PIN limitations.
  Existing native fallbacks, probe deadlines, and legacy artwork URLs remain.

Provider references: [AniList quota](https://docs.anilist.co/guide/rate-limiting),
[GraphQL errors](https://docs.anilist.co/guide/graphql/errors),
[TMDB errors](https://developer.themoviedb.org/docs/errors),
[Top Posters API](https://top-posters.com/openapi.json),
[RPDB reference](https://rpdb.apidoc.io/), and
[TVDB login contract](https://thetvdb.github.io/v4-api/swagger.yml).

Canonical artwork URL migration, subscriber-PIN plumbing, automatic saved
configuration repair, and global artwork suppression remain deferred: the
historical data does not establish safe causes/contracts for these changes.
Limits, timeouts, and TTLs were not raised. No production setting was changed.

Roll out independently reviewable changes, preserving existing authentication,
result IDs/order, native fallbacks, and negative-cache behavior. The new AniList
budget only coordinates upgraded replicas; mixed-version replicas still bypass
it. Coordinate the participating replicas rather than adding an uncontrolled
extra canary. Watch content degradation as well as HTTP status, and roll back on
uncaught errors/restarts, lost fallback, auth isolation failure, stuck admission,
or comparable latency regression.

Validation completed locally:

| Command                                                                                                  | Result                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm --prefix server test`                                                                               | 97 files; 1,132 passed, 36 skipped. The skips are opt-in PostgreSQL/Mongo history contracts, not Redis admission tests.                                                  |
| `npm --prefix server test -- tests/unit/catalogGenreHandlers.test.ts tests/unit/sharedAdmission.test.ts` | 76 passed, none skipped; includes two-replica quota spacing, cooldown, outage/recovery, cancellation, queue bounds, shutdown, and degraded metadata HTTP/cache behavior. |
| `npm --prefix client test`                                                                               | 27 files, 167 passed; existing jsdom `scrollTo` notices.                                                                                                                 |
| `npm --prefix server run typecheck`                                                                      | Passed, including the erasable-only TypeScript constraint.                                                                                                               |
| `npm --prefix client run lint`                                                                           | Passed with five existing warnings in unchanged files.                                                                                                                   |
| `npm --prefix client run build`                                                                          | Passed.                                                                                                                                                                  |
| `git diff --check`                                                                                       | Passed.                                                                                                                                                                  |

Server tests ran with memory cache/storage, empty provider/database URLs, and
`ADMISSION_REDIS_SERVER` pointing to a privately built Redis binary. The tests
own/start/stop their disposable Redis; no production Redis was used. Native
stripped-TypeScript route/provider imports also passed on local Node 24 with
dotenv loading and network calls disabled. **The production Node 22 container
build was not run:** Docker is unavailable locally. Production rollout and
post-deploy observation are still required; test results do not guarantee a
crash-free deployment.

## Status and confidence

Implemented and tested in the working tree; **not deployed**. Production was accessed read-only.
Reproductions below use synthetic fixtures and isolated databases, not destructive experiments
against production. Production improvement must be measured after rollout.

The investigation corrected several recommendations from the review:

- The root manifest demonstrably advertised unsupported endpoints. That does **not** prove it
  caused every configuration-less request; old installations and third-party integrations can
  continue making them after the manifest changes.
- A busy hashed IP is not proof of abuse. No arbitrary client/IP block was added.
- Search needed correct pagination, not arbitrary truncation of enrichment or results.
- Aborted aggregate metadata could be cached, but its TTL was **24 hours**, not 14 days.
  The 14-day TTL applies to completed-season data.
- First-seen fingerprints do not prove new regressions. Historical groups were not bulk-resolved.
- Exact percentiles cost computation. Fewer SQL statements do not prove lower latency.

## Application failures

| Issue                                              | Root cause and conclusive evidence                                                                                                                                                                 | Fix and reason                                                                                                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration-less metadata 404s                   | The root manifest advertised catalog/meta and `tt`/TMDB prefixes without a configuration; the corresponding configuration-less handlers do not exist. Tests compare root and configured manifests. | Root manifest no longer advertises unsupported resources and requires configuration. Configured manifests preserve their resources and prefixes. No default provider key or silent fallback was introduced.                               |
| Hundreds of upstream calls for search              | A deterministic search fixture returned **329 results on page one**, enriching far more than one page.                                                                                             | Stable 20-result pagination. Tests retrieve all 329 results without duplicates, rather than discarding matches or applying an arbitrary request-wide call cap.                                                                            |
| Excess series fetches                              | A 35-season fixture demonstrated redundant individual TMDB season requests.                                                                                                                        | Reuse batched season responses and existing cached data. Fixture: **35 TMDB calls reduced to 2**, while preserving **37 IMDb augmentation calls**. Removed the unrelated 50-season result ceiling rather than silently truncating series. |
| Work continues after cancellation; poisoned caches | Tests reproduced partial-result and negative-cache writes after cancellation, including shared/coalesced work.                                                                                     | Abort-aware transports, throttle queues, retries and loops; aborted work throws and cannot populate caches. Healthy coalesced callers can retry/recover; a cancelled waiter does not cancel a healthy producer.                           |
| Invalid collections silently appear empty          | Missing/invalid IDs were treated as successful empty results.                                                                                                                                      | Classified `400 / VALIDATION_ERROR` on addon requests and POST preview, including repeated requests. Warnings carry `user_config`; validation happens before upstream work.                                                               |
| Artwork disappears or causes unnecessary work      | Six HEAD/cache cases reproduced unsupported methods, access failures cached as absence, and duplicate provider work.                                                                               | One bounded ranged GET after HEAD 401/405/501, with body cancellation; transient/authentication failures are not cached as confirmed absence. Reuse Fanart/TVDB payloads across artwork kinds and remove duplicate resolution.            |

Relevant regression tests:
[search](../server/tests/unit/comprehensiveSearch.test.ts),
[series](../server/tests/unit/seriesEpisodeMerge.test.ts),
[cancellation/cache](../server/tests/unit/requestCancellation.test.ts),
[transport cancellation](../server/tests/unit/upstreamCancellation.test.ts),
[artwork](../server/tests/unit/posterService.test.ts),
[preview validation](../server/tests/unit/collectionPreview.test.ts).

## Observability correctness

| Issue                                         | Root cause and evidence                                                                                                                                            | Fix                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Misleading headline/provider percentiles      | History used histogram ceilings while advertising exact percentiles. On 50,000 durations, the old p95 was **60,000ms** instead of **47,500ms**.                    | Exact stored-row percentiles across PostgreSQL, MongoDB and memory. Explicit approximation flags remain for live histogram fallback; UI formatting follows those flags. Sampling and bounded-history caveats remain visible.                                                 |
| Weighted totals drift                         | PostgreSQL `REAL` accumulation produced **66,657** rather than **66,667** in a reproducible fixture.                                                               | Higher-precision aggregation and normalization; coverage includes weighted traffic and consistent totals.                                                                                                                                                                    |
| Expensive, inconsistent overview reads        | Six separate PostgreSQL statements could observe different snapshots and competed for a small pool.                                                                | One PostgreSQL statement/one physical scan per selected partition; MongoDB reduced from six to two aggregations. A 50,000-distinct-duration test caught a naive Mongo facet exceeding 100MB; replaced with streaming aggregation.                                            |
| Log bursts undercounted                       | Raw event detail was capped at 50 per fingerprint/flush; overview counted sampled rows as occurrences. An 80-event, two-minute fixture reproduces the discrepancy. | Occurrence weights retain full represented counts, grouped by fingerprint, minute, route and classification. Tests assert 80 total and minute counts `[60, 20]`, with correct route totals. Sampled request attribution and sub-minute boundaries remain explicitly limited. |
| Stacks and causes missing                     | Call sites discarded Error objects; extraction handled `error.stack` but not `err` or `reason`.                                                                    | Preserve Error objects at hot call sites, extract all supported fields, retain bounded cause chains, and redact before capture. Old message-only events remain unrecoverable.                                                                                                |
| User configuration faults bury app problems   | Known invalid-key/missing-collection events were undifferentiated logs.                                                                                            | Separate `user_config` metadata/counts/filter, with a configuration drilldown from request traces. Historical unknown classifications remain unknown. No real HTTP failures are excluded or hidden.                                                                          |
| Fingerprint change looks like new defects     | Fingerprint input changed in 2.12.1, splitting old/new identities.                                                                                                 | Remove the misleading “new in version” claim, explain first-observed fingerprint semantics, and provide related-history search. Preserve historical counts, fingerprints and triage states instead of inventing a migration or resolving unverified bugs.                    |
| Cancellation counted as provider timeout      | Local real-undici reproduction: timeout emits `TimeoutError`; explicit cancellation emits `AbortError`. Both were marked timed out.                                | Separate cancellation from timeout/failure across collectors, all history stores and UI. Outbound call counts now start when attempts are created, not only when headers arrive.                                                                                             |
| Missing hourly cache/instance data            | Collector populated minute cache/instance fields but omitted corresponding hourly fields.                                                                          | Populate both resolutions; regression verifies hourly cache hit rate and instance totals.                                                                                                                                                                                    |
| Old short custom ranges show zero on fallback | Resolution was selected by interval width, while live minute retention expires by age.                                                                             | Use retained hourly buckets for old live windows. Invalid/custom-empty ranges return 400, not a silently substituted hour. History keeps its available fine resolution.                                                                                                      |
| Weak request exploration                      | No total, duration upper bound, fan-out filter, or stable alternate sorting.                                                                                       | Stored-match totals, `maxMs`, `minUpstreamCalls`, direct config-hash filter, stable pagination/sorting across all three stores. Subsequent UI pages retain the first page’s exact time bounds.                                                                               |
| Unhelpful client labels                       | Specific supplied user agents fell through generic rules.                                                                                                          | Recognize Nuvio, AIOStreams and Omni before generic clients. Missing user-agent data remains honestly “No user-agent”; it is not guessed.                                                                                                                                    |
| Search terms/provider keys in telemetry       | Search text was embedded in Stremio path extras. RPDB/Top Posters credentials can occupy short, nonhex path segments missed by generic masking.                    | Redact search extras, sensitive log messages/causes and known credential-bearing provider path segments before new capture. No secret values were copied into tests or this report.                                                                                          |

[History regression suite and benchmark notes](../server/tests/unit/observabilityHistoryBackends.test.ts)
include real PostgreSQL/MongoDB execution, setup instructions and the baseline used.
[Collector regressions](../server/tests/unit/observability.test.ts) cover counts, redaction,
classification, fallback ranges and cancellation.

### Performance caveat

The local 50,000-row PostgreSQL median went from approximately **58ms to 98ms** when exact
computation was added. This is a correctness/round-trip improvement, **not a demonstrated CPU
speedup**. The production 24-hour query previously took about 4.4 seconds; its new latency has not
been measured. Polling no longer stacks concurrent requests. Rollup tables were not added blindly:
they would require a separate exact-percentile/retention design and production profiling.

## Operational and UI improvements

- **4xx visibility:** separate response-rate card and attention signal; unmatched-route and rejected
  response presets. A clean 5xx count no longer makes a 25% 4xx window appear healthy.
- **Incident windows:** historical threshold breaches with direct time-bounded request drilldowns.
  At least 20 requests per bucket; 5xx >1%, 4xx >5%, or slow >15%. These are investigation signals,
  not assertions that every 4xx is an outage.
- **Unattended detection:** checks run every minute without an open browser over five completed
  minutes, including upstream 429s. Five-minute shared deduplication, bounded HTTPS delivery and
  retry after failure. Notification requests are excluded from capture to prevent alert feedback.
  A malformed webhook is surfaced without disabling collection/local health logging.
- **Start annotations:** explicit process-start timestamps on new samples; labelled estimates for
  historical samples. Dashed chart markers and a text list. A restart is not automatically labelled
  a deployment.
- **Collector scope:** per-instance loss/failure details, explicit responding-pod scope, and visible
  missing/stale data. Stats are snapshotted, not mutable references to future counters.
- **Stale instances:** hidden by default; optional last-day view. Live roster entries expire after
  24 hours without deleting retained historical samples.
- **Charts:** update existing uPlot instances instead of recreating them every poll; shared error
  sparkline scale; no interpolation across missing values. Fixed desktop card crowding.
- **Time selection:** chart drag selection plus keyboard-accessible native date/time inputs.
  Slow-response links use the configured threshold.
- **Trace honesty:** show overlapping upstream-time semantics, time-to-headers limitations and
  missing dependency rows; clamp waterfall bars to their track. Detailed database/cache/queue spans
  are not fabricated from unexplained request latency.
- **Storage isolation:** optional dedicated `OBS_REDIS_URL`, with fail-closed dedicated-store
  connection behavior and documented password rotation when moving revocation stores.

## Verification

| Check                                                                                                                                            | Result                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL=silent npm test --prefix server -- --reporter=dot`                                                                                    | **878 passed, 28 skipped**, 84 test files.                                                                                                                           |
| `cd server && npm test -- tests/unit/observabilityHistory.test.ts tests/unit/observabilityHistoryBackends.test.ts` with disposable database URLs | **65 passed**, using isolated PostgreSQL 16, MongoDB 7 and memory. Containers stopped/removed afterward.                                                             |
| `npm test --prefix client -- src/admin`                                                                                                          | **26 passed**, 5 files.                                                                                                                                              |
| `npm run typecheck --prefix server`                                                                                                              | Passed.                                                                                                                                                              |
| `npm run build --prefix client`                                                                                                                  | Passed.                                                                                                                                                              |
| `npm run lint --prefix client -- src/admin`                                                                                                      | No errors; 5 existing warnings outside admin in SearchInput/useAuth/useConfig.                                                                                       |
| `git diff --check`                                                                                                                               | Passed.                                                                                                                                                              |
| Real browser, built local UI with synthetic API responses                                                                                        | Charts rendered; exact p95/4xx warning/start marker visible; drag updates custom interval; two native date controls; no horizontal page overflow at 390px or 1440px. |

The first admin-auth suite run exposed local allowlist contamination rather than an application
regression. Its fixture now explicitly isolates the allowlist and dedicated Redis setting.
Chronicle was not exposed by available tools; session-history queries found no workaround.
Direct reproductions resolved the test/browser blockers instead of assuming their causes.

## External limits and deployment actions

1. **Deploy before judging production results.** Apply normal history migrations on startup; then
   check search pagination, configured clients, collector coverage, and 24h/7d query latency.
   Previously poisoned cache entries are not retroactively reconstructed: allow their existing
   TTLs to expire or invalidate verified affected entries. Do not flush every cache and create a
   new upstream traffic surge.
2. **Configure notifications.** Set an operator-owned HTTPS `OBS_ALERT_WEBHOOK_URL` or keep local
   logging. The generic JSON payload needs an adapter for Slack/Discord-specific schemas.
   No external destination was invented or contacted during testing.
3. **Provider credentials/capacity remain external.** A read-only production one-hour sample
   contained RPDB 403s and Top Posters 401/405/429s plus transport failures. Correct credentials,
   subscription/access and provider limits cannot be repaired locally. Unsupported HEAD now has
   a bounded GET alternative; definitive access failures remain visible and transient failures
   do not become cached “not found” results.
4. **No blanket traffic block.** Existing bare-manifest installations may need refresh or
   reconfiguration. Track the residual 404s by route/client; volume alone did not establish abuse.
5. **Use a separate noeviction Redis if isolation is needed.** Another logical DB in the same
   Redis does not isolate eviction. Rotate admin password/hash when moving the revocation store.
6. **Old losses cannot be recreated.** Missing stacks, dropped rows, old unweighted log counts and
   old cancellation labels stay limited. Previously captured sensitive paths expire under normal
   retention; inspect access and rotate affected provider credentials if necessary. No historical
   data was silently purged.
7. **The stale-replicaset explanation was not proven.** A delayed heartbeat does not establish
   staging/production DB sharing. Deployment inventory and datastore configuration need an
   operator-side check; the UI now reports freshness/scope without inventing that explanation.

Runtime settings and semantics are documented in [environment.md](./environment.md).
