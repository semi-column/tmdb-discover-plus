import { describe, expect, it } from 'vitest';
import { filterUnknownGenreMetas, hasKnownGenre } from '../../src/utils/catalogGenreFilter.ts';

describe('catalog genre filter', () => {
  it.each([
    { genres: undefined },
    { genres: [] },
    { genres: [''] },
    { genres: ['Unknown'] },
    { genres: ['unknown genre'] },
    { genres: ['N/A'] },
    { genres: ['none'] },
  ])('treats $genres as having no known genre', ({ genres }) => {
    expect(hasKnownGenre({ genres })).toBe(false);
  });

  it.each([
    { genres: ['Drama'] },
    { genres: ['Animation'] },
    { genres: ['Unknown', 'Drama'] },
    { genres: ['  custom provider genre  '] },
  ])('keeps metas with a usable provider genre: $genres', ({ genres }) => {
    expect(hasKnownGenre({ genres })).toBe(true);
  });

  it('preserves all metas when disabled and only removes unknown ones when enabled', () => {
    const metas = [
      { id: 'unknown', genres: [] },
      { id: 'known', genres: ['Drama'] },
    ];
    expect(filterUnknownGenreMetas(metas, false)).toEqual(metas);
    expect(filterUnknownGenreMetas(metas, true)).toEqual([metas[1]]);
  });
});
