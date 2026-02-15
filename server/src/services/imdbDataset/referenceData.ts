export const IMDB_SORT_OPTIONS = [
  { value: 'rating', label: '⭐ Highest Rated' },
  { value: 'votes', label: '🗳️ Most Votes' },
];

export const IMDB_PRESET_CATALOGS = {
  movie: [
    {
      value: 'top-rated-movies',
      label: '⭐ IMDB Top Rated Movies',
      description: 'Top rated movies from IMDB dataset',
      config: { type: 'movie', sortBy: 'rating', name: 'IMDB Top Rated Movies' },
    },
    {
      value: 'most-voted-movies',
      label: '🗳️ Most Voted Movies',
      description: 'Most voted movies on IMDB',
      config: { type: 'movie', sortBy: 'votes', name: 'IMDB Most Voted Movies' },
    },
  ],
  series: [
    {
      value: 'top-rated-series',
      label: '⭐ IMDB Top Rated Series',
      description: 'Top rated TV series from IMDB dataset',
      config: { type: 'series', sortBy: 'rating', name: 'IMDB Top Rated Series' },
    },
    {
      value: 'most-voted-series',
      label: '🗳️ Most Voted Series',
      description: 'Most voted TV series on IMDB',
      config: { type: 'series', sortBy: 'votes', name: 'IMDB Most Voted Series' },
    },
  ],
};
