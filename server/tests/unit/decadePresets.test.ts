import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDynamicDatePreset } from '../../src/utils/dateHelpers.ts';

describe('resolveDynamicDatePreset — decade presets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  it('resolves era_2020s for movies', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'era_2020s' }, 'movie');
    expect(result.releaseDateFrom).toBe('2020-01-01');
    expect(result.releaseDateTo).toBe('2029-12-31');
    expect(result.datePreset).toBeUndefined();
  });

  it('resolves era_2010s for movies', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'era_2010s' }, 'movie');
    expect(result.releaseDateFrom).toBe('2010-01-01');
    expect(result.releaseDateTo).toBe('2019-12-31');
  });

  it('resolves era_2000s for movies', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'era_2000s' }, 'movie');
    expect(result.releaseDateFrom).toBe('2000-01-01');
    expect(result.releaseDateTo).toBe('2009-12-31');
  });

  it('resolves era_1990s for movies', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'era_1990s' }, 'movie');
    expect(result.releaseDateFrom).toBe('1990-01-01');
    expect(result.releaseDateTo).toBe('1999-12-31');
  });

  it('resolves era_1980s for movies', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'era_1980s' }, 'movie');
    expect(result.releaseDateFrom).toBe('1980-01-01');
    expect(result.releaseDateTo).toBe('1989-12-31');
  });

  it('resolves era_2020s for series using airDate fields', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'era_2020s' }, 'series');
    expect(result.airDateFrom).toBe('2020-01-01');
    expect(result.airDateTo).toBe('2029-12-31');
    expect(result.releaseDateFrom).toBeUndefined();
  });

  it('resolves era_1990s for series using airDate fields', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'era_1990s' }, 'series');
    expect(result.airDateFrom).toBe('1990-01-01');
    expect(result.airDateTo).toBe('1999-12-31');
  });

  it('preserves other filter fields alongside decade preset', () => {
    const result = resolveDynamicDatePreset(
      { datePreset: 'era_2010s', genres: [28], sortBy: 'vote_average.desc' },
      'movie'
    );
    expect(result.genres).toEqual([28]);
    expect(result.sortBy).toBe('vote_average.desc');
    expect(result.releaseDateFrom).toBe('2010-01-01');
  });
});
