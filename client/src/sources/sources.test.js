import { describe, it, expect } from 'vitest';
import { TMDB_SOURCE } from './tmdb.source';
import { IMDB_SOURCE } from './imdb.source';
import { TRAKT_SOURCE } from './trakt.source';
import { getSource, getAllSources } from './index';

const IMDB_ONLY_SAMPLE = {
  imdbRatingMin: 7,
  totalVotesMin: 500,
  awardsWon: ['emmy'],
  rankedLists: ['TOP_250'],
  creditedNames: ['nm0000129'],
  companies: ['co0071326'],
  certificates: ['US:R'],
  plot: 'heist',
  filmingLocations: ['London'],
  withData: ['TRIVIA'],
  inTheatersLat: 51.5,
  inTheatersLong: -0.1,
  inTheatersRadius: 50000,
};

const TMDB_ONLY_SAMPLE = {
  voteCountMin: 1000,
  watchProviders: [8, 9],
  watchRegion: 'US',
  withPeople: '1234,5678',
  withCompanies: '33',
  withKeywords: '9836',
  tvStatus: 'Returning Series',
  tvType: 'Scripted',
  datePreset: 'last_30_days',
  releaseTypes: [3],
  includeVideo: true,
};

describe('TMDB_SOURCE descriptor', () => {
  it('has correct id and defaultSortBy', () => {
    expect(TMDB_SOURCE.id).toBe('tmdb');
    expect(TMDB_SOURCE.defaultSortBy).toBe('popularity.desc');
  });

  it('cleanFiltersOnSwitch strips all IMDb-only keys', () => {
    const result = TMDB_SOURCE.cleanFiltersOnSwitch({
      ...IMDB_ONLY_SAMPLE,
      sortBy: 'popularity.desc',
    });
    for (const key of Object.keys(IMDB_ONLY_SAMPLE)) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.sortBy).toBe('popularity.desc');
  });

  it('cleanFiltersOnSwitch preserves shared TMDB keys', () => {
    const result = TMDB_SOURCE.cleanFiltersOnSwitch({
      sortBy: 'popularity.desc',
      genres: [28],
      yearFrom: 2010,
    });
    expect(result.sortBy).toBe('popularity.desc');
    expect(result.genres).toEqual([28]);
    expect(result.yearFrom).toBe(2010);
  });

  it('computeActiveChips returns no chips for empty filters', () => {
    const chips = TMDB_SOURCE.computeActiveChips({}, { contentType: 'movie' });
    expect(chips).toEqual([]);
  });

  it('computeActiveChips reports non-default sort chip', () => {
    const chips = TMDB_SOURCE.computeActiveChips(
      { sortBy: 'vote_average.desc' },
      {
        contentType: 'movie',
        sortOptions: { movie: [{ value: 'vote_average.desc', label: 'Rating' }] },
      }
    );
    expect(chips.find((c) => c.key === 'sortBy')?.label).toContain('Rating');
  });

  it('computeActiveChips hides unknown sort keys for current type', () => {
    const chips = TMDB_SOURCE.computeActiveChips(
      { sortBy: 'release_date.asc' },
      {
        contentType: 'series',
        sortOptions: { series: [{ value: 'first_air_date.desc', label: 'First Air Date' }] },
      }
    );

    expect(chips.find((c) => c.key === 'sortBy')).toBeUndefined();
  });

  it('computeActiveChips does not report default popularity sort', () => {
    const chips = TMDB_SOURCE.computeActiveChips(
      { sortBy: 'popularity.desc' },
      { contentType: 'movie' }
    );
    expect(chips.find((c) => c.key === 'sortBy')).toBeUndefined();
  });

  it('computeActiveChips reports genres chip', () => {
    const chips = TMDB_SOURCE.computeActiveChips(
      { genres: [28] },
      { contentType: 'movie', genres: { movie: [{ id: 28, name: 'Action' }] } }
    );
    expect(chips.find((c) => c.key === 'genres')?.label).toContain('Action');
  });

  it('computeActiveChips reports watchProviders chip', () => {
    const chips = TMDB_SOURCE.computeActiveChips(
      { watchProviders: [8, 9] },
      { contentType: 'movie' }
    );
    expect(chips.find((c) => c.key === 'watchProviders')?.label).toContain('2');
  });
});

describe('IMDB_SOURCE descriptor', () => {
  it('has correct id and defaultSortBy', () => {
    expect(IMDB_SOURCE.id).toBe('imdb');
    expect(IMDB_SOURCE.defaultSortBy).toBe('POPULARITY');
  });

  it('cleanFiltersOnSwitch strips all TMDB-only keys', () => {
    const result = IMDB_SOURCE.cleanFiltersOnSwitch({ ...TMDB_ONLY_SAMPLE, sortBy: 'POPULARITY' });
    for (const key of Object.keys(TMDB_ONLY_SAMPLE)) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.sortBy).toBe('POPULARITY');
  });

  it('cleanFiltersOnSwitch preserves shared IMDb keys', () => {
    const result = IMDB_SOURCE.cleanFiltersOnSwitch({
      sortBy: 'POPULARITY',
      genres: ['Action'],
      imdbRatingMin: 7,
    });
    expect(result.sortBy).toBe('POPULARITY');
    expect(result.genres).toEqual(['Action']);
    expect(result.imdbRatingMin).toBe(7);
  });

  it('computeActiveChips returns no chips for empty filters', () => {
    const chips = IMDB_SOURCE.computeActiveChips({}, { contentType: 'movie' });
    expect(chips).toEqual([]);
  });

  it('computeActiveChips reports non-default sort chip', () => {
    const chips = IMDB_SOURCE.computeActiveChips(
      { sortBy: 'USER_RATING' },
      { contentType: 'movie', imdbSortOptions: [{ value: 'USER_RATING', label: 'User Rating' }] }
    );
    expect(chips.find((c) => c.key === 'sortBy')?.label).toContain('User Rating');
  });

  it('computeActiveChips does not report default POPULARITY sort', () => {
    const chips = IMDB_SOURCE.computeActiveChips(
      { sortBy: 'POPULARITY' },
      { contentType: 'movie' }
    );
    expect(chips.find((c) => c.key === 'sortBy')).toBeUndefined();
  });

  it('computeActiveChips reports awardsWon chip', () => {
    const chips = IMDB_SOURCE.computeActiveChips(
      { awardsWon: ['emmy', 'golden_globe'] },
      { contentType: 'series' }
    );
    expect(chips.find((c) => c.key === 'awardsWon')?.label).toContain('2');
  });

  it('computeActiveChips does not report rankedLists for series', () => {
    const chips = IMDB_SOURCE.computeActiveChips(
      { rankedLists: ['TOP_250'] },
      { contentType: 'series' }
    );
    expect(chips.find((c) => c.key === 'rankedLists')).toBeUndefined();
  });

  it('computeActiveChips reports rankedLists for movie', () => {
    const chips = IMDB_SOURCE.computeActiveChips(
      { rankedLists: ['TOP_250'] },
      { contentType: 'movie' }
    );
    expect(chips.find((c) => c.key === 'rankedLists')).toBeDefined();
  });
});

describe('source registry', () => {
  it('getSource returns TMDB for tmdb id', () => {
    expect(getSource('tmdb').id).toBe('tmdb');
  });

  it('getSource returns IMDb for imdb id', () => {
    expect(getSource('imdb').id).toBe('imdb');
  });

  it('getSource returns TMDB for undefined', () => {
    expect(getSource(undefined).id).toBe('tmdb');
  });

  it('getSource falls back to TMDB for unknown id', () => {
    expect(getSource('unknown').id).toBe('tmdb');
  });

  it('getAllSources returns all registered sources', () => {
    const all = getAllSources();
    expect(all.map((s) => s.id)).toContain('tmdb');
    expect(all.map((s) => s.id)).toContain('imdb');
  });
});

describe('TRAKT_SOURCE descriptor', () => {
  it('does not persist list type defaults', () => {
    expect(Object.prototype.hasOwnProperty.call(TRAKT_SOURCE.defaultFilters, 'traktListType')).toBe(
      false
    );
    expect(Object.prototype.hasOwnProperty.call(TRAKT_SOURCE.defaultFilters, 'traktPeriod')).toBe(
      false
    );
  });

  it('does not add a list chip when list type is omitted', () => {
    const chips = TRAKT_SOURCE.computeActiveChips({}, {});
    expect(chips.find((chip) => chip.key === 'traktListType')).toBeUndefined();
  });

  it('shows calendar date-order chip only for non-default ordering', () => {
    const chips = TRAKT_SOURCE.computeActiveChips(
      {
        traktListType: 'calendar',
        traktCalendarSort: 'asc',
      },
      {}
    );

    expect(chips.find((chip) => chip.key === 'traktCalendarSort')?.label).toContain('Ascending');

    const defaultCalendarChips = TRAKT_SOURCE.computeActiveChips(
      {
        traktListType: 'calendar',
        traktCalendarSort: 'desc',
      },
      {}
    );
    expect(defaultCalendarChips.find((chip) => chip.key === 'traktCalendarSort')).toBeUndefined();

    const defaultChips = TRAKT_SOURCE.computeActiveChips(
      {
        traktListType: 'recently_aired',
        traktCalendarSort: 'desc',
      },
      {}
    );
    expect(defaultChips.find((chip) => chip.key === 'traktCalendarSort')).toBeUndefined();
  });
});
