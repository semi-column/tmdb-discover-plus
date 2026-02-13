import { http, HttpResponse } from 'msw';

const TMDB_BASE = 'https://api.themoviedb.org/3';

const movieGenres = [
  { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' }, { id: 14, name: 'Fantasy' }, { id: 27, name: 'Horror' },
  { id: 878, name: 'Science Fiction' }, { id: 53, name: 'Thriller' },
];

const tvGenres = [
  { id: 10759, name: 'Action & Adventure' }, { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' }, { id: 10765, name: 'Sci-Fi & Fantasy' },
];

export const tmdbHandlers = [
  http.get(`${TMDB_BASE}/genre/movie/list`, () => {
    return HttpResponse.json({ genres: movieGenres });
  }),

  http.get(`${TMDB_BASE}/genre/tv/list`, () => {
    return HttpResponse.json({ genres: tvGenres });
  }),

  http.get(`${TMDB_BASE}/discover/movie`, ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    return HttpResponse.json({
      page,
      total_pages: 5,
      total_results: 100,
      results: [
        { id: 550, title: 'Fight Club', popularity: 61.4, vote_average: 8.4, poster_path: '/poster.jpg', release_date: '1999-10-15', genre_ids: [18, 53] },
        { id: 680, title: 'Pulp Fiction', popularity: 55.2, vote_average: 8.5, poster_path: '/poster2.jpg', release_date: '1994-09-10', genre_ids: [53, 80] },
      ],
    });
  }),

  http.get(`${TMDB_BASE}/discover/tv`, ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    return HttpResponse.json({
      page,
      total_pages: 3,
      total_results: 60,
      results: [
        { id: 1396, name: 'Breaking Bad', popularity: 150.3, vote_average: 8.9, poster_path: '/bb.jpg', first_air_date: '2008-01-20', genre_ids: [18, 80] },
      ],
    });
  }),

  http.get(`${TMDB_BASE}/search/movie`, ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    return HttpResponse.json({
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [
        { id: 550, title: query || 'Mock Movie', popularity: 50, vote_average: 8.0, poster_path: '/mock.jpg', release_date: '2000-01-01', genre_ids: [28] },
      ],
    });
  }),

  http.get(`${TMDB_BASE}/search/tv`, ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    return HttpResponse.json({
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [
        { id: 1396, name: query || 'Mock Show', popularity: 50, vote_average: 8.0, poster_path: '/mock.jpg', first_air_date: '2000-01-01', genre_ids: [18] },
      ],
    });
  }),

  http.get(`${TMDB_BASE}/search/multi`, ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    return HttpResponse.json({
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [
        { id: 550, title: query || 'Mock Result', media_type: 'movie', popularity: 50, vote_average: 8.0, poster_path: '/mock.jpg', release_date: '2000-01-01', genre_ids: [28] },
      ],
    });
  }),

  http.get(`${TMDB_BASE}/movie/:id`, ({ params }) => {
    return HttpResponse.json({
      id: Number(params.id),
      title: 'Mock Movie',
      overview: 'A mock movie for testing',
      popularity: 50,
      vote_average: 8.0,
      poster_path: '/mock.jpg',
      release_date: '2000-01-01',
      runtime: 120,
      genres: [{ id: 28, name: 'Action' }],
      credits: { cast: [{ name: 'Test Actor', character: 'Hero' }], crew: [] },
    });
  }),

  http.get(`${TMDB_BASE}/tv/:id`, ({ params }) => {
    return HttpResponse.json({
      id: Number(params.id),
      name: 'Mock Show',
      overview: 'A mock show for testing',
      popularity: 50,
      vote_average: 8.0,
      poster_path: '/mock.jpg',
      first_air_date: '2000-01-01',
      genres: [{ id: 18, name: 'Drama' }],
      credits: { cast: [{ name: 'Test Actor' }], crew: [] },
    });
  }),

  http.get(`${TMDB_BASE}/movie/:id/external_ids`, ({ params }) => {
    return HttpResponse.json({
      id: Number(params.id),
      imdb_id: `tt${String(params.id).padStart(7, '0')}`,
    });
  }),

  http.get(`${TMDB_BASE}/tv/:id/external_ids`, ({ params }) => {
    return HttpResponse.json({
      id: Number(params.id),
      imdb_id: `tt${String(params.id).padStart(7, '0')}`,
    });
  }),

  http.get(`${TMDB_BASE}/find/:id`, ({ params }) => {
    return HttpResponse.json({
      movie_results: [{ id: 550, title: 'Fight Club' }],
      tv_results: [],
    });
  }),

  http.get(`${TMDB_BASE}/trending/:mediaType/:timeWindow`, () => {
    return HttpResponse.json({
      page: 1,
      total_pages: 5,
      total_results: 100,
      results: [
        { id: 550, title: 'Trending Movie', popularity: 100, vote_average: 8.0, poster_path: '/t.jpg', release_date: '2025-01-01', genre_ids: [28] },
      ],
    });
  }),

  http.get(`${TMDB_BASE}/configuration`, () => {
    return HttpResponse.json({
      images: {
        base_url: 'http://image.tmdb.org/t/p/',
        secure_base_url: 'https://image.tmdb.org/t/p/',
        poster_sizes: ['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'],
      },
    });
  }),
];
