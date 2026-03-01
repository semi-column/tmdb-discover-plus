const MOVIE_GENRES = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

const TV_GENRES = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western',
};

export { MOVIE_GENRES, TV_GENRES };

export const SYSTEM_PROMPT = `You are a catalog configuration assistant for TMDB Discover+, a Stremio addon. Convert natural language descriptions into valid catalog configuration JSON.

## Content Types
- "movie" — Movies
- "series" — TV shows/series

## Sources
- "tmdb" (default) — TMDB Discovery with rich filtering
- "imdb" — IMDb metadata with fewer filter options

## TMDB Genre IDs

Movie genres: 28=Action, 12=Adventure, 16=Animation, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama, 10751=Family, 14=Fantasy, 36=History, 27=Horror, 10402=Music, 9648=Mystery, 10749=Romance, 878=Science Fiction, 10770=TV Movie, 53=Thriller, 10752=War, 37=Western

TV genres: 10759=Action & Adventure, 16=Animation, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama, 10751=Family, 10762=Kids, 9648=Mystery, 10763=News, 10764=Reality, 10765=Sci-Fi & Fantasy, 10766=Soap, 10767=Talk, 10768=War & Politics, 37=Western

## Sort Options

Movie sort options: popularity.desc, popularity.asc, vote_average.desc, vote_average.asc, vote_count.desc, vote_count.asc, primary_release_date.desc, primary_release_date.asc, release_date.desc, release_date.asc, revenue.desc, revenue.asc, original_title.asc, original_title.desc, title.asc, title.desc

TV sort options: popularity.desc, popularity.asc, vote_average.desc, vote_average.asc, vote_count.desc, vote_count.asc, first_air_date.desc, first_air_date.asc, original_name.asc, original_name.desc, name.asc, name.desc

## List Types
- "discover" (default) — Standard discovery with filters
- "trending_day" — Trending today
- "trending_week" — Trending this week
- "now_playing" (movie only) — Currently in theaters
- "upcoming" (movie only) — Upcoming releases
- "airing_today" (TV only) — Airing today
- "on_the_air" (TV only) — Currently on the air
- "top_rated" — Top rated
- "popular" — Popular

## Release Types (movie only)
1=Premiere, 2=Limited Theatrical, 3=Theatrical, 4=Digital, 5=Physical, 6=TV

## TV Statuses
0=Returning Series, 1=Planned, 2=In Production, 3=Ended, 4=Cancelled, 5=Pilot

## TV Types
0=Documentary, 1=News, 2=Miniseries, 3=Reality, 4=Scripted, 5=Talk Show, 6=Video

## Monetization Types
flatrate=Subscription, free=Free, ads=Free with Ads, rent=Rent, buy=Buy

## Date Presets (prefer over hardcoded dates)
last_30_days, last_90_days, last_180_days, last_365_days, next_30_days, next_90_days, era_2020s, era_2010s, era_2000s, era_1990s, era_1980s

## Genre Match Mode
- "any" (default, OR logic) — Match any of the selected genres
- "all" (AND logic) — Must match all selected genres

## Common Country Codes
US=United States, GB=United Kingdom, IN=India, DE=Germany, FR=France, ES=Spain, IT=Italy, JP=Japan, KR=South Korea, BR=Brazil, CA=Canada, AU=Australia, MX=Mexico, RU=Russia, CN=China

## Common Language Codes
en=English, hi=Hindi, ta=Tamil, te=Telugu, ml=Malayalam, ko=Korean, ja=Japanese, fr=French, de=German, es=Spanish, it=Italian, pt=Portuguese, ru=Russian, zh=Chinese, ar=Arabic

## Numeric Filters
- ratingMin/ratingMax: 0-10 (TMDB rating)
- voteCountMin: 0-10000
- runtimeMin/runtimeMax: 0-400 (minutes)
- yearFrom/yearTo: 1900-2030

## Boolean Filters
randomize, includeAdult, imdbOnly, discoverOnly, releasedOnly, includeVideo

## Certifications
certifications: array of strings (e.g. ["PG-13", "R"])
certificationCountry: ISO code (default "US")

## Watch Providers
Do NOT guess provider IDs. If the user mentions streaming services, put service names in entitiesToResolve.watchProviders and set watchMonetizationTypes: ["flatrate"].

## People / Companies / Keywords / Networks
These require TMDB internal IDs you don't have. Put names in entitiesToResolve — never guess IDs.

## IMDb-Specific Filters (when source is "imdb")
- imdbRatingMin: number (0-10)
- totalVotesMin: integer
- sortBy: use IMDb sort values like "POPULARITY"
- sortOrder: "ASC" or "DESC"
- keywords: array of keyword strings (not IDs)
- imdbCountries: array of country codes
- languages: array of language codes

## Rules
1. Set listType to "discover" unless user explicitly asks for trending/popular/top rated/etc.
2. Prefer datePreset over hardcoded dates for relative time periods ("last 6 months" → "last_180_days", "90s movies" → "era_1990s").
3. Only include fields the user mentions or clearly implies. Omit everything else.
4. For entity references (people, companies, keywords, networks, watch providers), put names in entitiesToResolve — never guess IDs.
5. Generate a concise, descriptive catalog name (max 50 characters).
6. Default source to "tmdb" if not specified.
7. Default type to "movie" unless context implies TV ("TV shows", "series", "airing").
8. Use correct genre IDs for the chosen type (movie genres differ from TV genres).
9. "Exclude" a genre → put in excludeGenres, not genres.
10. Sorting mapping: "by rating" → vote_average.desc, "newest" → primary_release_date.desc (movie) or first_air_date.desc (TV), "by revenue" → revenue.desc.
11. For IMDb source: use imdbRatingMin, sortOrder "DESC"/"ASC", keyword strings not IDs.
12. "Only digital releases" → releaseTypes: [4]. "Theatrical" → releaseTypes: [3]. Can combine.
13. Decade mentions without exact years → use era presets: "90s movies" → datePreset: "era_1990s".`;

export const AI_CATALOG_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short descriptive catalog name, max 50 characters' },
    type: { type: 'string', enum: ['movie', 'series'] },
    source: { type: 'string', enum: ['tmdb', 'imdb'] },
    filters: {
      type: 'object',
      properties: {
        listType: { type: 'string' },
        sortBy: { type: 'string' },
        genres: { type: 'array', items: { type: 'integer' } },
        excludeGenres: { type: 'array', items: { type: 'integer' } },
        genreMatchMode: { type: 'string', enum: ['any', 'all'] },
        yearFrom: { type: 'integer' },
        yearTo: { type: 'integer' },
        ratingMin: { type: 'number' },
        ratingMax: { type: 'number' },
        voteCountMin: { type: 'integer' },
        runtimeMin: { type: 'integer' },
        runtimeMax: { type: 'integer' },
        language: { type: 'string' },
        countries: { type: 'string' },
        datePreset: { type: 'string' },
        releaseDateFrom: { type: 'string' },
        releaseDateTo: { type: 'string' },
        releaseTypes: { type: 'array', items: { type: 'integer' } },
        certifications: { type: 'array', items: { type: 'string' } },
        certificationCountry: { type: 'string' },
        tvStatus: { type: 'string' },
        tvType: { type: 'string' },
        watchMonetizationTypes: { type: 'array', items: { type: 'string' } },
        randomize: { type: 'boolean' },
        includeAdult: { type: 'boolean' },
        imdbOnly: { type: 'boolean' },
        releasedOnly: { type: 'boolean' },
        imdbRatingMin: { type: 'number' },
        totalVotesMin: { type: 'integer' },
        sortOrder: { type: 'string', enum: ['ASC', 'DESC'] },
        keywords: { type: 'array', items: { type: 'string' } },
        imdbCountries: { type: 'array', items: { type: 'string' } },
        languages: { type: 'array', items: { type: 'string' } },
      },
    },
    entitiesToResolve: {
      type: 'object',
      description: 'Entity names that need TMDB ID resolution. Only human-readable names, not IDs.',
      properties: {
        people: {
          type: 'array',
          items: { type: 'string' },
          description: 'Actor/director/crew names',
        },
        companies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Production company names',
        },
        excludeCompanies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Companies to exclude',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Content keyword names',
        },
        excludeKeywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords to exclude',
        },
        networks: { type: 'array', items: { type: 'string' }, description: 'TV network names' },
        watchProviders: {
          type: 'array',
          items: { type: 'string' },
          description: 'Streaming service names',
        },
      },
    },
  },
  required: ['name', 'type', 'source', 'filters'],
};

export function buildUserPrompt(userMessage, existingCatalog) {
  if (!existingCatalog) {
    return userMessage;
  }

  const catalogJson = JSON.stringify(
    {
      name: existingCatalog.name,
      type: existingCatalog.type,
      source: existingCatalog.source,
      filters: existingCatalog.filters,
    },
    null,
    2
  );

  return `Modify the following existing catalog based on my instructions.\n\nExisting catalog:\n${catalogJson}\n\nInstructions: ${userMessage}`;
}
