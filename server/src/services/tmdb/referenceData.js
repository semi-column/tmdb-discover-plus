/**
 * Static reference data: list types, presets, sort options,
 * release types, TV statuses, TV types, monetization types,
 * and curated TV network lists.
 *
 * Pure data — no runtime dependencies.
 */

// ── Special list types (non-discover endpoints) ─────────────────────────────

export const LIST_TYPES = {
  movie: [
    { value: 'discover', label: '🔍 Custom Discover', description: 'Use filters below' },
    { value: 'trending_day', label: '🔥 Trending Today', description: 'Movies trending today' },
    {
      value: 'trending_week',
      label: '📈 Trending This Week',
      description: 'Movies trending this week',
    },
    { value: 'now_playing', label: '🎬 Now Playing', description: 'Currently in theaters' },
    { value: 'upcoming', label: '📅 Upcoming', description: 'Coming soon to theaters' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular movies' },
  ],
  series: [
    { value: 'discover', label: '🔍 Custom Discover', description: 'Use filters below' },
    { value: 'trending_day', label: '🔥 Trending Today', description: 'TV shows trending today' },
    {
      value: 'trending_week',
      label: '📈 Trending This Week',
      description: 'TV shows trending this week',
    },
    { value: 'airing_today', label: '📺 Airing Today', description: 'Episodes airing today' },
    { value: 'on_the_air', label: '📡 On The Air', description: 'Currently airing shows' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular shows' },
  ],
};

// ── Pre-built catalog presets (excludes 'discover') ─────────────────────────

export const PRESET_CATALOGS = {
  movie: [
    { value: 'trending_day', label: '🔥 Trending Today', description: 'Movies trending today' },
    {
      value: 'trending_week',
      label: '📈 Trending This Week',
      description: 'Movies trending this week',
    },
    { value: 'now_playing', label: '🎬 Now Playing', description: 'Currently in theaters' },
    { value: 'upcoming', label: '📅 Upcoming', description: 'Coming soon to theaters' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular movies' },
  ],
  series: [
    { value: 'trending_day', label: '🔥 Trending Today', description: 'TV shows trending today' },
    {
      value: 'trending_week',
      label: '📈 Trending This Week',
      description: 'TV shows trending this week',
    },
    { value: 'airing_today', label: '📺 Airing Today', description: 'Episodes airing today' },
    { value: 'on_the_air', label: '📡 On The Air', description: 'Currently airing shows' },
    { value: 'top_rated', label: '⭐ Top Rated', description: 'All-time highest rated' },
    { value: 'popular', label: '🌟 Popular', description: 'Currently popular shows' },
  ],
};

// ── Sort options for discover ───────────────────────────────────────────────

export const SORT_OPTIONS = {
  movie: [
    // Popularity
    { value: 'popularity.desc', label: 'Most Popular' },
    { value: 'popularity.asc', label: 'Least Popular' },
    // Ratings
    { value: 'vote_average.desc', label: 'Highest Rated' },
    { value: 'vote_average.asc', label: 'Lowest Rated' },
    { value: 'vote_count.desc', label: 'Most Votes' },
    { value: 'vote_count.asc', label: 'Least Votes' },
    // Release Date
    { value: 'primary_release_date.desc', label: 'Newest Releases' },
    { value: 'primary_release_date.asc', label: 'Oldest Releases' },
    { value: 'release_date.desc', label: 'Release Date (Newest)' },
    { value: 'release_date.asc', label: 'Release Date (Oldest)' },
    // Revenue
    { value: 'revenue.desc', label: 'Highest Revenue' },
    { value: 'revenue.asc', label: 'Lowest Revenue' },
    // Title
    { value: 'original_title.asc', label: 'Title A → Z' },
    { value: 'original_title.desc', label: 'Title Z → A' },
    { value: 'title.asc', label: 'Localized Title A → Z' },
    { value: 'title.desc', label: 'Localized Title Z → A' },
  ],
  series: [
    // Popularity
    { value: 'popularity.desc', label: 'Most Popular' },
    { value: 'popularity.asc', label: 'Least Popular' },
    // Ratings
    { value: 'vote_average.desc', label: 'Highest Rated' },
    { value: 'vote_average.asc', label: 'Lowest Rated' },
    { value: 'vote_count.desc', label: 'Most Votes' },
    { value: 'vote_count.asc', label: 'Least Votes' },
    // Air Date
    { value: 'first_air_date.desc', label: 'Newest First Aired' },
    { value: 'first_air_date.asc', label: 'Oldest First Aired' },
    // Name/Title
    { value: 'original_name.asc', label: 'Name A → Z' },
    { value: 'original_name.desc', label: 'Name Z → A' },
    { value: 'name.asc', label: 'Localized Name A → Z' },
    { value: 'name.desc', label: 'Localized Name Z → A' },
  ],
};

// ── Movie release types ─────────────────────────────────────────────────────

export const RELEASE_TYPES = [
  { value: 1, label: 'Premiere' },
  { value: 2, label: 'Limited Theatrical' },
  { value: 3, label: 'Theatrical' },
  { value: 4, label: 'Digital' },
  { value: 5, label: 'Physical' },
  { value: 6, label: 'TV' },
];

// ── TV show statuses ────────────────────────────────────────────────────────

export const TV_STATUSES = [
  { value: '0', label: 'Returning Series' },
  { value: '1', label: 'Planned' },
  { value: '2', label: 'In Production' },
  { value: '3', label: 'Ended' },
  { value: '4', label: 'Cancelled' },
  { value: '5', label: 'Pilot' },
];

// ── TV show types ───────────────────────────────────────────────────────────

export const TV_TYPES = [
  { value: '0', label: 'Documentary' },
  { value: '1', label: 'News' },
  { value: '2', label: 'Miniseries' },
  { value: '3', label: 'Reality' },
  { value: '4', label: 'Scripted' },
  { value: '5', label: 'Talk Show' },
  { value: '6', label: 'Video' },
];

// ── Watch monetization types ────────────────────────────────────────────────

export const MONETIZATION_TYPES = [
  { value: 'flatrate', label: 'Subscription (Netflix, Prime, etc.)' },
  { value: 'free', label: 'Free' },
  { value: 'ads', label: 'Free with Ads' },
  { value: 'rent', label: 'Rent' },
  { value: 'buy', label: 'Buy' },
];

// ── Popular TV Networks (curated list with TMDB IDs) ────────────────────────

export const TV_NETWORKS = [
  // Streaming
  { id: 213, name: 'Netflix', logo: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png' },
  { id: 1024, name: 'Amazon', logo: '/ifhbNuuVnlwYy5oXA5VIb2YR8AZ.png' },
  { id: 2739, name: 'Disney+', logo: '/gJ8VX6JSu3ciXHuC2dDGAo2lvwM.png' },
  { id: 2552, name: 'Apple TV+', logo: '/4KAy34EHvRM25Ih8wb82AuGU7zJ.png' },
  { id: 453, name: 'Hulu', logo: '/pqUTCleNUiTLAVlelGxUgWn1ELh.png' },
  { id: 3186, name: 'HBO Max', logo: '/aAb3CiOzSlBLMuIOVSGIrPC0fLF.png' },
  { id: 49, name: 'HBO', logo: '/tuomPhY2UtuPTqqFnKMVHvSb724.png' },
  { id: 2697, name: 'Paramount+', logo: '/xbhHHa1YgtpwhC8lb1NQ3ACVcLd.png' },
  { id: 4330, name: 'Peacock', logo: '/qlqLhLJoOlBpO6OFbDjpP3CrH01.png' },
  { id: 3353, name: 'Discovery+', logo: '/yxhnqf5i8I00lJkqNNj5JuHHqZ1.png' },
  { id: 6703, name: 'Zee5', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 3930, name: 'JioCinema', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 232, name: 'SonyLIV', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 3279, name: 'Voot', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 119, name: 'Amazon Prime Video', logo: '/ifhbNuuVnlwYy5oXA5VIb2YR8AZ.png' },
  // US Broadcast
  { id: 6, name: 'NBC', logo: '/o3OedEP0f9mfZr33jz2BfXOUK5.png' },
  { id: 2, name: 'ABC', logo: '/ndAvF4JLsliGreX87jAc9GdjmJY.png' },
  { id: 16, name: 'CBS', logo: '/nm8d7P7MJNiBLdgIzUK0gkuEA4r.png' },
  { id: 19, name: 'FOX', logo: '/1DSpHrWyOORkL9N2QHX7Adt31mQ.png' },
  { id: 71, name: 'The CW', logo: '/ge9hzeaU7nMtQ4PjkFlc68dGAJ9.png' },
  // Cable US
  { id: 174, name: 'AMC', logo: '/alqLicR1ZMHMaZGP3xRQxn9S7Oc.png' },
  { id: 67, name: 'Showtime', logo: '/Allse9kbjiP6ExaQrnSpIhkurEi.png' },
  { id: 318, name: 'Starz', logo: '/8GJjw3HHsAJYwIWKIPBPfqMxlEa.png' },
  { id: 29, name: 'USA Network', logo: '/g1e0H0Ka97IG5SaIx6kgiKzLFXA.png' },
  { id: 34, name: 'FX', logo: '/aexGjtcs42DgRtZh7zOxayiry4J.png' },
  { id: 54, name: 'History', logo: '/kxCeDqSFZyUMJg6VN5LBJWmPqb7.png' },
  { id: 64, name: 'Discovery', logo: '/og0TiNsq4y3F1UJqJJ3bWpvVzxs.png' },
  { id: 43, name: 'National Geographic', logo: '/q8uLFDz0PFm41X8SxPvXk8ED1Cd.png' },
  // UK
  { id: 4, name: 'BBC One', logo: '/mVn7xESaTNmjBUyUtGNvDQd3CT1.png' },
  { id: 332, name: 'BBC Two', logo: '/gaKcBUdBcbH7NxwMbRmVdRCJxSG.png' },
  { id: 26, name: 'Channel 4', logo: '/6ooPjtXufjsoskdJqj6pxuvHEno.png' },
  { id: 9, name: 'ITV', logo: '/ixVMBbREzK5tNsZqMNYIJ6Llp9M.png' },
  { id: 493, name: 'Sky Atlantic', logo: '/q2bwTL9OOlvSY3Ll4xjd6ADdMRH.png' },
  // India
  { id: 231, name: 'Star Plus', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 232, name: 'Sony Entertainment Television', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 237, name: 'Colors', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 234, name: 'Zee TV', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 3279, name: 'Hotstar', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  // Others
  { id: 1, name: 'Fuji TV', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 173, name: 'AT-X', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 98, name: 'TV Tokyo', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
  { id: 614, name: 'Crunchyroll', logo: '/l1NkV8Q1XPvDnKwLpRe9LNXjpEg.png' },
];
