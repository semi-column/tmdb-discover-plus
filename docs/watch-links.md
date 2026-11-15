# Viewing links in Stremio

The optional viewing-links feature shows where a movie or series is available,
using TMDB's JustWatch-powered provider data. It works alongside existing stream
addons and is disabled by default.

## Setup

1. In a TMDB movie or series catalog, select your **streaming country**.
2. For subscriptions you pay for, select the exact providers/plans and only the
   **Subscription (Netflix, Prime, etc.)** monetization option. You can keep
   other catalogs for free titles and rentals.
3. Enable **Global Settings → Where to Watch → Show viewing links in Stremio**.
4. Save the configuration and reinstall its addon in Stremio so the client
   reads the new stream resource.

Countries are collected from enabled TMDB movie/series Discover catalogs. Each country
keeps its own selected subscriptions. Disabled catalogs, other catalog sources,
and catalogs with mixed, free, rental, or unspecified monetization do not add
providers to the included set. The feature does not change your catalog filters.
Popular, trending, collection, and other list modes do not apply provider
filters, so any leftover provider settings in those modes are ignored.

## Viewing choices

- **INCLUDED** requires a current `flatrate` offer for an exact selected provider
  ID. Having a title in a subscription catalog alone does not qualify it.
- **FREE** and **FREE WITH ADS** use those respective offer categories.
- **RENT / BUY** costs extra, including Amazon Video rentals and Apple TV Store
  purchases. These do not count as Prime Video or Apple TV+ subscriptions.
- **MORE** opens all viewing options, including other services and plans.
- **CHECK** means availability could not be confirmed. It retains a manual
  title lookup and does not claim the title is included or unavailable.

Select the exact subscription tier in your catalogs. Netflix with ads, higher
Peacock tiers, Amazon Channels, and other separately listed packages are not
automatically substituted for a selected provider.

Buttons open the title's **TMDB viewing-options page**, using the selected
country. TMDB's API does not supply provider deep links or playback streams.
Choose the service on that page and use your subscription login there. This
addon does not sign into streaming accounts, test entitlements, or bypass DRM.
It does not change Stremio's existing trailer button.

Series offers describe the series as a whole. They do not verify every season
or episode. Episode requests are explicitly labeled **SERIES**, with a reminder
to confirm the episode and plan.

## Data and caching

Requests use TMDB's documented
[movie](https://developer.themoviedb.org/reference/movie-watch-providers) and
[TV](https://developer.themoviedb.org/reference/tv-series-watch-providers)
watch-provider endpoints through the existing TMDB client, credentials,
caching, and request limits. Availability data is provided by **JustWatch**.
The source's own update delays still apply.

IMDb IDs are resolved through TMDB's external-ID lookup, selecting the exact
media type. TMDB IDs and series episode IDs are also supported. Title-name
similarity is never used as an identity match.

Successful raw offer data and rendered stream responses expire after five
minutes by default (`CACHE_TTL_WATCH_LINKS`, seconds). Failed lookups are served
with `Cache-Control: no-store`. A failure after title resolution retains the
TMDB viewing page; an unresolved IMDb title links to its exact IMDb page.
Provider selection and labels are applied separately for each configuration.

## API

Configured addon route:

```text
GET /:userId/stream/movie/:id.json
GET /:userId/stream/series/:id.json
```

Supported IDs: `tt1234567`, `tmdb:123`, `tt1234567:1:2`, and `tmdb:123:1:2`.
Episode IDs are accepted only for series. The manifest advertises this resource
only when the feature is enabled and at least one streaming country is set.
Unknown configurations and invalid API keys retain the addon's existing
configuration and credential checks.
