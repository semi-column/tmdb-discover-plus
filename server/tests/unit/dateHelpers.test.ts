import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDynamicDatePreset } from '../../src/utils/dateHelpers.ts';

describe('resolveDynamicDatePreset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  it('returns original filters when no datePreset', () => {
    const filters = { genres: [28], sortBy: 'popularity.desc' };
    expect(resolveDynamicDatePreset(filters, 'movie')).toEqual(filters);
  });

  it('returns empty object for null/undefined input', () => {
    expect(resolveDynamicDatePreset(null, 'movie')).toEqual({});
    expect(resolveDynamicDatePreset(undefined, 'movie')).toEqual({});
  });

  it('resolves last_30_days for movies', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'last_30_days' }, 'movie');
    expect(result.releaseDateFrom).toBe('2025-05-16');
    expect(result.releaseDateTo).toBe('2025-06-15');
    expect(result.datePreset).toBeUndefined();
  });

  it('resolves last_30_days for series using airDate fields', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'last_30_days' }, 'series');
    expect(result.airDateFrom).toBe('2025-05-16');
    expect(result.airDateTo).toBe('2025-06-15');
  });

  it('resolves last_90_days', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'last_90_days' }, 'movie');
    expect(result.releaseDateFrom).toBe('2025-03-17');
    expect(result.releaseDateTo).toBe('2025-06-15');
  });

  it('resolves this_year', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'this_year' }, 'movie');
    // Start of year may shift by timezone (local midnight → UTC conversion)
    expect(result.releaseDateFrom).toMatch(/^202[45]-/);
    expect(result.releaseDateTo).toBe('2025-06-15');
  });

  it('resolves last_year', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'last_year' }, 'movie');
    expect(result.releaseDateFrom).toBe('2024-01-01');
    expect(result.releaseDateTo).toBe('2024-12-31');
  });

  it('resolves next_30_days', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'next_30_days' }, 'movie');
    expect(result.releaseDateFrom).toBe('2025-06-15');
    expect(result.releaseDateTo).toBe('2025-07-15');
  });

  it('resolves upcoming for movies', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'upcoming' }, 'movie');
    expect(result.releaseDateFrom).toBe('2025-06-15');
    expect(result.releaseDateTo).toBe('2025-12-15');
  });

  it('ignores upcoming for series', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'upcoming' }, 'series');
    expect(result.airDateFrom).toBeUndefined();
    expect(result.airDateTo).toBeUndefined();
  });

  it('preserves other filter fields', () => {
    const result = resolveDynamicDatePreset(
      { datePreset: 'last_30_days', genres: [28], sortBy: 'vote_average.desc' },
      'movie'
    );
    expect(result.genres).toEqual([28]);
    expect(result.sortBy).toBe('vote_average.desc');
  });

  it('ignores unknown presets', () => {
    const result = resolveDynamicDatePreset({ datePreset: 'unknown_preset' }, 'movie');
    expect(result.datePreset).toBeUndefined();
    expect(result.releaseDateFrom).toBeUndefined();
  });
});
