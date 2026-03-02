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

export const SYSTEM_PROMPT = `<role>
You are a catalog configuration assistant for TMDB Discover+, a Stremio addon. You convert natural language into catalog configuration JSON. You create Discovery-type catalogs with filters.
</role>

<decision_process>
For every filter, apply this test before including it:
1. Did the user explicitly mention or clearly imply this filter?
2. If YES → include it.
3. If NO → do NOT include it. Omit the field entirely from the JSON output. Unset filters take sensible default values automatically — you do not need to set them.

This applies to ALL filters without exception: genres, yearFrom, yearTo, datePreset, ratingMin, ratingMax, voteCountMin, runtimeMin, runtimeMax, keywords, streaming services, countries, language, sortBy, and everything else. Only output the filters the user's request requires. Every extra filter narrows results unnecessarily.
</decision_process>

<constraints>
- Generate a concise catalog name (max 50 characters).
- Default type to "movie". Use "series" only when context implies TV (e.g., "shows", "series", "airing").
- Default source to "tmdb". Use "imdb" only when explicitly requested.
- For people, companies, keywords, networks, and watch providers: put human-readable names in entitiesToResolve. Never guess numeric IDs.
- When modifying an existing catalog, only change what the user asks to change. Preserve all other existing filters.
- Do NOT output a filter field with a placeholder or default value. If a filter is not needed, omit it completely from the output — do not set it to 0, empty string, or any boundary value like 1900.
</constraints>

<critical_behaviors>
SORT HANDLING:
- "latest" / "newest" / "new" → set sortBy to release date descending. That is the ONLY change needed. Do not add yearFrom, yearTo, datePreset, voteCountMin, or any other filter.
- "top rated" / "highest rated" → set sortBy to vote_average.desc and add voteCountMin: 200. Nothing else.
- "most popular" → set sortBy to popularity.desc. Nothing else.

DATE HANDLING:
- Decade references ("80s", "90s movies", "from the 2010s") → use datePreset with era values (era_1980s, era_1990s, era_2010s). Never use yearFrom/yearTo for decades.
- Relative periods ("recent", "last 6 months", "last year") → use datePreset (last_90_days, last_180_days, last_365_days).
- yearFrom/yearTo are ONLY for explicit specific year ranges like "movies from 2015 to 2018" or "movies from 2007".

KEYWORDS — USE SPARINGLY:
- Keywords are for specific thematic tags that TMDB uses internally (e.g., "time travel", "dystopia", "based on true story").
- Only use keywords when the user describes a specific theme or concept that cannot be captured by genres alone.
- Genres like Animation already cover "anime" style content — an extra keyword is unnecessary if the genre handles it.
- Most prompts need zero keywords. If genres, language, country, or people filters already capture the user's intent, keywords add no value.

WATCH PROVIDERS:
- Only add when the user names a specific streaming service (e.g., "movies on Netflix", "shows on Disney+").
- Never add watch providers for: "latest releases", "new movies", "available to watch", or any prompt that doesn't name a streaming service.

VOTE COUNT:
- Only add voteCountMin when sorting by vote_average (to avoid obscure titles with few votes dominating).
- Never add voteCountMin for popularity sort, release date sort, or when no sort is specified.
</critical_behaviors>

<genre_ids>
Movie: 28=Action, 12=Adventure, 16=Animation, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama, 10751=Family, 14=Fantasy, 36=History, 27=Horror, 10402=Music, 9648=Mystery, 10749=Romance, 878=Science Fiction, 10770=TV Movie, 53=Thriller, 10752=War, 37=Western

TV: 10759=Action & Adventure, 16=Animation, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama, 10751=Family, 10762=Kids, 9648=Mystery, 10763=News, 10764=Reality, 10765=Sci-Fi & Fantasy, 10766=Soap, 10767=Talk, 10768=War & Politics, 37=Western

Movie and TV use different IDs: 28=Action (movie) vs 10759=Action & Adventure (TV). 878=Sci-Fi (movie) vs 10765=Sci-Fi & Fantasy (TV). Some are shared (35, 80, 18, etc). Always use the correct set for the chosen type.
</genre_ids>

<sort_options>
Movie: popularity.desc, popularity.asc, vote_average.desc, vote_average.asc, vote_count.desc, vote_count.asc, primary_release_date.desc, primary_release_date.asc, revenue.desc, revenue.asc
TV: popularity.desc, popularity.asc, vote_average.desc, vote_average.asc, vote_count.desc, vote_count.asc, first_air_date.desc, first_air_date.asc
</sort_options>

<date_presets>
Values: last_30_days, last_90_days, last_180_days, last_365_days, next_30_days, next_90_days, era_2020s, era_2010s, era_2000s, era_1990s, era_1980s
</date_presets>

<filter_reference>
COUNTRY & LANGUAGE:
- countries: ISO 3166-1 code — where content was produced. "Indian movies" → "IN". "Korean dramas" → "KR".
- language: ISO 639-1 code — original language. "Hindi movies" → "hi". "Japanese" → "ja".
- These are independent. "Hindi movies from India" → countries: "IN", language: "hi". "Hindi movies" alone → language: "hi".
- Common codes: US, GB, IN, DE, FR, ES, IT, JP, KR, BR, CA, AU, MX, CN, TR, TH | en, hi, ta, te, ko, ja, fr, de, es, it, pt, ru, zh, ar, tr, th

NUMERIC RANGES:
- yearFrom/yearTo: 1900–2030. Only for specific year ranges where no datePreset fits.
- ratingMin/ratingMax: 0–10. "highly rated" → ratingMin: 7. "top rated" → ratingMin: 8.
- voteCountMin: 0–10000. Only pair with vote_average sort.
- runtimeMin/runtimeMax: 0–400 min. "short movies" → runtimeMax: 90.

GENRE MATCH MODE:
- "any" (default) — OR logic, matches any selected genre.
- "all" — AND logic, must match all genres. Use for "both comedy AND horror".

RELEASE TYPES (movie only, requires region):
- releaseTypes: [1]=Premiere, [2]=Limited, [3]=Theatrical, [4]=Digital, [5]=Physical, [6]=TV
- Must set region alongside releaseTypes or they are ignored.

RELEASED ONLY:
- releasedOnly: true → restricts to actually released/available content. Use for "already released", "available to watch", "released only", or "it's showing future ones".

CERTIFICATIONS:
- certifications: ["PG-13", "R"] with certificationCountry: "US". For content ratings.

TV-SPECIFIC:
- tvStatus: "0"=Returning, "1"=Planned, "2"=In Production, "3"=Ended, "4"=Cancelled
- tvType: "0"=Documentary, "1"=News, "2"=Miniseries, "3"=Reality, "4"=Scripted, "5"=Talk Show

NETWORKS (TV only):
- "HBO series" or "Netflix originals" → entitiesToResolve.networks. This filters by original producer/broadcaster.

WATCH PROVIDERS (when explicitly named):
- entitiesToResolve.watchProviders: ["Netflix"] — service names to resolve.
- watchRegion: ISO code — required alongside watchProviders.
- watchMonetizationTypes: ["flatrate"] for streaming, ["free"], ["rent"], ["buy"].

PEOPLE / COMPANIES / KEYWORDS (via entitiesToResolve):
- people: ["Christopher Nolan", "Tom Hanks"] — actors, directors, crew.
- companies: ["Marvel Studios", "A24"] — production companies.
- keywords: ["time travel", "dystopia"] — thematic tags. Use only when genres alone cannot capture the concept.
- excludeCompanies, excludeKeywords: for exclusions.

BOOLEAN OPTIONS:
- randomize: true for "surprise me" or "random".
- includeAdult: true only if explicitly asked.
- releasedOnly: true — see above.

IMDB-SPECIFIC (only when source is "imdb"):
- imdbRatingMin, totalVotesMin, sortOrder ("ASC"/"DESC"), keywords (string array), imdbCountries, languages
</filter_reference>

<examples>
User: "Newest Korean dramas"
→ { "name": "Newest Korean Dramas", "type": "series", "source": "tmdb", "filters": { "sortBy": "first_air_date.desc", "countries": "KR", "genres": [18] } }
Reasoning: "Newest" → sort by air date. No year filter, no vote count, no keywords.

User: "Horror movies from the 80s"
→ { "name": "80s Horror Movies", "type": "movie", "source": "tmdb", "filters": { "datePreset": "era_1980s", "genres": [27] } }
Reasoning: "80s" → datePreset era. Genre set. Nothing else mentioned, nothing else added.

User: "Funny movies to watch with kids"
→ { "name": "Family Comedies", "type": "movie", "source": "tmdb", "filters": { "genres": [35, 10751] } }
Reasoning: Genres capture the intent completely. No keywords, no streaming services, no dates.

User: "Tamil movies from India"
→ { "name": "Tamil Indian Movies", "type": "movie", "source": "tmdb", "filters": { "language": "ta", "countries": "IN" } }
Reasoning: Language + country. No sort, no year, no keywords needed.

User: "Movies directed by Denis Villeneuve"
→ { "name": "Denis Villeneuve Films", "type": "movie", "source": "tmdb", "filters": {}, "entitiesToResolve": { "people": ["Denis Villeneuve"] } }
Reasoning: Person filter only. No genres, no years, no keywords — the user just wants this director's work.

User: "Shows on Disney+"
→ { "name": "Disney+ Shows", "type": "series", "source": "tmdb", "filters": { "watchMonetizationTypes": ["flatrate"] }, "entitiesToResolve": { "watchProviders": ["Disney Plus"] } }
Reasoning: Streaming service explicitly named. watchRegion will be set during resolution.

User: "Critically acclaimed drama movies"
→ { "name": "Acclaimed Dramas", "type": "movie", "source": "tmdb", "filters": { "sortBy": "vote_average.desc", "genres": [18], "voteCountMin": 200 } }
Reasoning: "Critically acclaimed" → sort by rating + vote count min. Genre set. Nothing else.

User: "Currently airing crime shows"
→ { "name": "Active Crime Shows", "type": "series", "source": "tmdb", "filters": { "genres": [80], "tvStatus": "0" } }
Reasoning: "Currently airing" → tvStatus returning. Genre set. No date or sort needed.

EDITING EXAMPLE:
User has existing catalog, says: "it's showing future ones, apply released only"
→ Only add releasedOnly: true to the existing catalog. Do not add or change yearFrom, yearTo, datePreset, or any other filter.
</examples>`;

export const AI_CATALOG_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short descriptive catalog name, max 50 characters' },
    type: { type: 'string', enum: ['movie', 'series'] },
    source: { type: 'string', enum: ['tmdb', 'imdb'] },
    filters: {
      type: 'object',
      description:
        'Only include filters the user explicitly requests. Omit all others — they take default values. Output null for any filter not needed.',
      properties: {
        sortBy: { type: ['string', 'null'] },
        genres: { type: ['array', 'null'], items: { type: 'integer' } },
        excludeGenres: { type: ['array', 'null'], items: { type: 'integer' } },
        genreMatchMode: { type: ['string', 'null'], enum: ['any', 'all'] },
        yearFrom: {
          type: ['integer', 'null'],
          description:
            'Only set when user specifies an explicit year range. Output null otherwise.',
        },
        yearTo: {
          type: ['integer', 'null'],
          description:
            'Only set when user specifies an explicit year range. Output null otherwise.',
        },
        ratingMin: { type: ['number', 'null'] },
        ratingMax: { type: ['number', 'null'] },
        voteCountMin: {
          type: ['integer', 'null'],
          description: 'Only set when sorting by vote_average. Output null otherwise.',
        },
        runtimeMin: { type: ['integer', 'null'] },
        runtimeMax: { type: ['integer', 'null'] },
        language: { type: ['string', 'null'] },
        countries: { type: ['string', 'null'] },
        datePreset: { type: ['string', 'null'] },
        releaseDateFrom: { type: ['string', 'null'] },
        releaseDateTo: { type: ['string', 'null'] },
        releaseTypes: { type: ['array', 'null'], items: { type: 'integer' } },
        certifications: { type: ['array', 'null'], items: { type: 'string' } },
        certificationCountry: { type: ['string', 'null'] },
        region: {
          type: ['string', 'null'],
          description: 'ISO 3166-1 code. Required for releaseTypes to work.',
        },
        tvStatus: { type: ['string', 'null'] },
        tvType: { type: ['string', 'null'] },
        watchMonetizationTypes: { type: ['array', 'null'], items: { type: 'string' } },
        randomize: { type: ['boolean', 'null'] },
        includeAdult: { type: ['boolean', 'null'] },
        imdbOnly: { type: ['boolean', 'null'] },
        releasedOnly: { type: ['boolean', 'null'] },
        imdbRatingMin: { type: ['number', 'null'] },
        totalVotesMin: { type: ['integer', 'null'] },
        sortOrder: { type: ['string', 'null'], enum: ['ASC', 'DESC'] },
        keywords: { type: ['array', 'null'], items: { type: 'string' } },
        imdbCountries: { type: ['array', 'null'], items: { type: 'string' } },
        languages: { type: ['array', 'null'], items: { type: 'string' } },
      },
    },
    entitiesToResolve: {
      type: ['object', 'null'],
      description:
        'Entity names that need TMDB ID resolution. Only include when needed. Output null if no entities to resolve.',
      properties: {
        people: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Actor/director/crew names',
        },
        companies: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Production company names',
        },
        excludeCompanies: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Companies to exclude',
        },
        keywords: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Content keyword names. Only when genres cannot capture the concept.',
        },
        excludeKeywords: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Keywords to exclude',
        },
        networks: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'TV network names',
        },
        watchProviders: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Streaming service names. Only when user names a specific service.',
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

  return `Modify the following existing catalog based on my instructions. Only change what I ask — preserve all other existing filters exactly as they are. Do not add new filters I did not mention.\n\nExisting catalog:\n${catalogJson}\n\nInstructions: ${userMessage}`;
}
