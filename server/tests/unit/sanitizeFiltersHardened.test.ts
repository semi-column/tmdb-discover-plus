import { describe, it, expect } from 'vitest';
import { sanitizeFilters } from '../../src/utils/validation.ts';

describe('sanitizeFilters — hardened allowlist', () => {
  it('passes through all newly added keys', () => {
    const result = sanitizeFilters({
      releaseDateFrom: '2024-01-01',
      releaseDateTo: '2024-12-31',
      airDateFrom: '2024-01-01',
      airDateTo: '2024-12-31',
      firstAirDateFrom: '2024-01-01',
      firstAirDateTo: '2024-12-31',
      firstAirDateYear: 2024,
      primaryReleaseYear: 2024,
      includeVideo: true,
      includeNullFirstAirDates: true,
      screenedTheatrically: true,
      excludeCompanies: '100,200',
      excludeKeywords: '50,60',
      region: 'US',
      timezone: 'America/New_York',
      genreMatchMode: 'all',
      voteCountMin: 100,
      watchMonetizationTypes: ['flatrate'],
      watchMonetizationType: 'flatrate',
      certification: 'PG-13',
      tvStatus: '0',
      tvType: '0',
      releasedOnly: true,
      discoverOnly: true,
    });

    expect(result.releaseDateFrom).toBe('2024-01-01');
    expect(result.releaseDateTo).toBe('2024-12-31');
    expect(result.airDateFrom).toBe('2024-01-01');
    expect(result.airDateTo).toBe('2024-12-31');
    expect(result.firstAirDateFrom).toBe('2024-01-01');
    expect(result.firstAirDateTo).toBe('2024-12-31');
    expect(result.firstAirDateYear).toBe(2024);
    expect(result.primaryReleaseYear).toBe(2024);
    expect(result.includeVideo).toBe(true);
    expect(result.includeNullFirstAirDates).toBe(true);
    expect(result.screenedTheatrically).toBe(true);
    expect(result.excludeCompanies).toBe('100,200');
    expect(result.excludeKeywords).toBe('50,60');
    expect(result.region).toBe('US');
    expect(result.timezone).toBe('America/New_York');
    expect(result.genreMatchMode).toBe('all');
    expect(result.voteCountMin).toBe(100);
    expect(result.releasedOnly).toBe(true);
    expect(result.discoverOnly).toBe(true);
    expect(result.tvStatus).toBe('0');
    expect(result.tvType).toBe('0');
  });

  it('strips prototype pollution keys', () => {
    const result = sanitizeFilters({ __proto__: 'evil', constructor: 'bad', genres: [28] });
    expect(result).not.toHaveProperty('__proto__');
    expect(result).not.toHaveProperty('constructor');
    expect(result.genres).toEqual([28]);
  });

  it('strips unknown keys', () => {
    const result = sanitizeFilters({
      api_key: 'steal-this',
      sortBy: 'popularity.desc',
      malicious: true,
    });
    expect(result).not.toHaveProperty('api_key');
    expect(result).not.toHaveProperty('malicious');
    expect(result.sortBy).toBe('popularity.desc');
  });

  describe('business rule enforcement', () => {
    it('removes orphaned certification (no country)', () => {
      const result = sanitizeFilters({ certification: 'PG-13' });
      expect(result).not.toHaveProperty('certification');
    });

    it('keeps certification when country is present', () => {
      const result = sanitizeFilters({
        certification: 'PG-13',
        certificationCountry: 'US',
      });
      expect(result.certification).toBe('PG-13');
      expect(result.certificationCountry).toBe('US');
    });

    it('removes orphaned certificationCountry (no cert values)', () => {
      const result = sanitizeFilters({ certificationCountry: 'US' });
      expect(result).not.toHaveProperty('certificationCountry');
    });

    it('keeps certificationCountry when certifications array is present', () => {
      const result = sanitizeFilters({
        certifications: ['PG-13', 'R'],
        certificationCountry: 'US',
      });
      expect(result.certificationCountry).toBe('US');
    });

    it('removes watchProviders when watchRegion is missing', () => {
      const result = sanitizeFilters({
        watchProviders: [8, 9],
        watchMonetizationTypes: ['flatrate'],
      });
      expect(result).not.toHaveProperty('watchProviders');
      expect(result).not.toHaveProperty('watchMonetizationTypes');
    });

    it('keeps watchProviders when watchRegion is present', () => {
      const result = sanitizeFilters({
        watchProviders: [8, 9],
        watchRegion: 'US',
      });
      expect(result.watchProviders).toEqual([8, 9]);
      expect(result.watchRegion).toBe('US');
    });

    it('caps voteCountMin at 10000', () => {
      const result = sanitizeFilters({ voteCountMin: 99999 });
      expect(result.voteCountMin).toBe(10000);
    });

    it('clamps ratingMin and ratingMax to 0-10', () => {
      const result = sanitizeFilters({ ratingMin: -5, ratingMax: 15 });
      expect(result.ratingMin).toBe(0);
      expect(result.ratingMax).toBe(10);
    });

    it('clamps runtimeMin and runtimeMax to 0-400', () => {
      const result = sanitizeFilters({ runtimeMin: -10, runtimeMax: 999 });
      expect(result.runtimeMin).toBe(0);
      expect(result.runtimeMax).toBe(400);
    });
  });
});
