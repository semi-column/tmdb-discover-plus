import { describe, it, expect } from 'vitest';
import { formatRuntime, generateSlug } from '../../src/services/tmdb/stremioMeta.ts';

describe('formatRuntime', () => {
  it('formats hours and minutes', () => {
    expect(formatRuntime(150)).toBe('2h30min');
  });
  it('formats hours only when no remainder', () => {
    expect(formatRuntime(120)).toBe('2h');
  });
  it('formats minutes only when less than 60', () => {
    expect(formatRuntime(45)).toBe('45min');
  });
  it('returns undefined for null/0/undefined', () => {
    expect(formatRuntime(null)).toBeUndefined();
    expect(formatRuntime(0)).toBeUndefined();
    expect(formatRuntime(undefined)).toBeUndefined();
  });
  it('handles edge case of exactly 60 minutes', () => {
    expect(formatRuntime(60)).toBe('1h');
  });
  it('handles single-digit remainder', () => {
    expect(formatRuntime(61)).toBe('1h1min');
  });
});

describe('generateSlug', () => {
  it('creates type/title-id slug', () => {
    expect(generateSlug('movie', 'The Matrix', 'tt0133093')).toBe('movie/the-matrix-tt0133093');
  });
  it('handles empty title', () => {
    expect(generateSlug('series', '', 'tt123')).toBe('series/-tt123');
  });
  it('handles null title', () => {
    expect(generateSlug('movie', null, 'id')).toBe('movie/-id');
  });
});
