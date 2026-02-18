import { describe, it, expect } from 'vitest';
import { getActiveFilterCount } from './catalogFilters.ts';

describe('getActiveFilterCount', () => {
  it('returns 0 for empty/null/undefined filters', () => {
    expect(getActiveFilterCount(null)).toBe(0);
    expect(getActiveFilterCount(undefined)).toBe(0);
    expect(getActiveFilterCount({})).toBe(0);
  });

  it('returns 0 for default-only filters', () => {
    expect(
      getActiveFilterCount({
        sortBy: 'popularity.desc',
        listType: 'discover',
        voteCountMin: 0,
        genreMatchMode: 'any',
        imdbOnly: false,
      })
    ).toBe(0);
  });

  it('counts non-default sortBy', () => {
    expect(getActiveFilterCount({ sortBy: 'vote_average.desc' })).toBe(1);
  });

  it('counts genres array', () => {
    expect(getActiveFilterCount({ genres: [28, 12] })).toBe(1);
  });

  it('does not count empty arrays', () => {
    expect(getActiveFilterCount({ genres: [], excludeGenres: [] })).toBe(0);
  });

  it('counts multiple active filters correctly', () => {
    expect(
      getActiveFilterCount({
        sortBy: 'vote_average.desc',
        genres: [28],
        ratingMin: 7,
        releaseDateFrom: '2020-01-01',
        releasedOnly: true,
      })
    ).toBe(5);
  });

  it('counts boolean true filters', () => {
    expect(
      getActiveFilterCount({
        includeAdult: true,
        randomize: true,
        releasedOnly: true,
      })
    ).toBe(3);
  });

  it('does not count false booleans', () => {
    expect(
      getActiveFilterCount({
        includeAdult: false,
        randomize: false,
      })
    ).toBe(0);
  });

  it('counts non-zero voteCountMin', () => {
    expect(getActiveFilterCount({ voteCountMin: 50 })).toBe(1);
  });
});
