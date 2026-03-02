import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeAIResponse, validateGeminiKey, generateCatalog } from './gemini';

describe('sanitizeAIResponse', () => {
  it('passes through a valid movie catalog', () => {
    const input = {
      name: 'Action Hits',
      type: 'movie',
      source: 'tmdb',
      filters: {
        genres: [28, 53],
        sortBy: 'popularity.desc',
        listType: 'discover',
        voteCountMin: 100,
      },
    };
    const result = sanitizeAIResponse(input);
    expect(result.name).toBe('Action Hits');
    expect(result.type).toBe('movie');
    expect(result.source).toBe('tmdb');
    expect(result.filters.genres).toEqual([28, 53]);
    expect(result.filters.sortBy).toBe('popularity.desc');
  });

  it('passes through a valid series catalog', () => {
    const input = {
      name: 'Korean Dramas',
      type: 'series',
      source: 'tmdb',
      filters: {
        genres: [18],
        language: 'ko',
        sortBy: 'vote_average.desc',
      },
    };
    const result = sanitizeAIResponse(input);
    expect(result.type).toBe('series');
    expect(result.filters.genres).toEqual([18]);
  });

  it('strips invalid genre IDs for the type', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { genres: [28, 10759] },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.genres).toEqual([28]);
  });

  it('clamps numeric values to valid ranges', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: {
        ratingMin: -5,
        ratingMax: 15,
        voteCountMin: 99999,
        runtimeMin: -10,
        runtimeMax: 600,
        yearFrom: 1800,
        yearTo: 2100,
      },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.ratingMax).toBe(10);
    expect(result.filters.voteCountMin).toBe(10000);
    expect(result.filters.runtimeMax).toBe(400);
    // yearFrom 1800 clamps to 1900, then stripped as <=1900 boundary hallucination
    expect(result.filters.yearFrom).toBeUndefined();
    expect(result.filters.yearTo).toBe(2030);
    // ratingMin -5 clamps to 0, then stripped as zero-value
    expect(result.filters.ratingMin).toBeUndefined();
    // runtimeMin -10 clamps to 0, then stripped as zero-value
    expect(result.filters.runtimeMin).toBeUndefined();
  });

  it('strips null values from nullable schema fields', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: {
        sortBy: 'primary_release_date.desc',
        genres: [28],
        yearFrom: null,
        yearTo: null,
        ratingMin: null,
        voteCountMin: null,
        language: null,
        countries: null,
      },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.sortBy).toBe('primary_release_date.desc');
    expect(result.filters.genres).toEqual([28]);
    expect(result.filters.yearFrom).toBeUndefined();
    expect(result.filters.yearTo).toBeUndefined();
    expect(result.filters.ratingMin).toBeUndefined();
    expect(result.filters.voteCountMin).toBeUndefined();
    expect(result.filters.language).toBeUndefined();
    expect(result.filters.countries).toBeUndefined();
  });

  it('strips yearFrom/yearTo at 1900 boundary (AI hallucination)', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: {
        sortBy: 'primary_release_date.desc',
        yearFrom: 0,
        yearTo: 0,
      },
    };
    const result = sanitizeAIResponse(input);
    // 0 clamps to 1900, then stripped as boundary hallucination
    expect(result.filters.yearFrom).toBeUndefined();
    expect(result.filters.yearTo).toBeUndefined();
    expect(result.filters.sortBy).toBe('primary_release_date.desc');
  });

  it('strips unknown filter keys', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { genres: [28], unknownKey: 'value', fakeFilter: true },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.unknownKey).toBeUndefined();
    expect(result.filters.fakeFilter).toBeUndefined();
    expect(result.filters.genres).toEqual([28]);
  });

  it('strips invalid sortBy values', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { sortBy: 'invalid_sort.desc' },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.sortBy).toBeUndefined();
  });

  it('strips movie-only fields from series catalogs', () => {
    const input = {
      name: 'Test',
      type: 'series',
      source: 'tmdb',
      filters: { releaseTypes: [3, 4], certifications: ['PG-13'] },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.releaseTypes).toBeUndefined();
    expect(result.filters.certifications).toBeUndefined();
  });

  it('strips series-only fields from movie catalogs', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { tvStatus: '0', tvType: '4' },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.tvStatus).toBeUndefined();
    expect(result.filters.tvType).toBeUndefined();
  });

  it('truncates name to 50 characters', () => {
    const input = {
      name: 'A'.repeat(100),
      type: 'movie',
      source: 'tmdb',
      filters: {},
    };
    const result = sanitizeAIResponse(input);
    expect(result.name.length).toBe(50);
  });

  it('throws on missing type', () => {
    expect(() => sanitizeAIResponse({ name: 'Test', source: 'tmdb', filters: {} })).toThrow();
  });

  it('throws on invalid type', () => {
    expect(() =>
      sanitizeAIResponse({ name: 'Test', type: 'anime', source: 'tmdb', filters: {} })
    ).toThrow(/Invalid content type/);
  });

  it('defaults source to tmdb if invalid', () => {
    const result = sanitizeAIResponse({
      name: 'Test',
      type: 'movie',
      source: 'netflix',
      filters: {},
    });
    expect(result.source).toBe('tmdb');
  });

  it('preserves entitiesToResolve when present', () => {
    const input = {
      name: 'Nolan Films',
      type: 'movie',
      source: 'tmdb',
      filters: {},
      entitiesToResolve: {
        people: ['Christopher Nolan'],
        watchProviders: ['Netflix'],
      },
    };
    const result = sanitizeAIResponse(input);
    expect(result.entitiesToResolve.people).toEqual(['Christopher Nolan']);
    expect(result.entitiesToResolve.watchProviders).toEqual(['Netflix']);
  });

  it('strips empty entity arrays', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: {},
      entitiesToResolve: { people: [], keywords: ['action'] },
    };
    const result = sanitizeAIResponse(input);
    expect(result.entitiesToResolve.people).toBeUndefined();
    expect(result.entitiesToResolve.keywords).toEqual(['action']);
  });

  it('throws on null response', () => {
    expect(() => sanitizeAIResponse(null)).toThrow();
  });

  it('throws on missing filters', () => {
    expect(() => sanitizeAIResponse({ name: 'Test', type: 'movie', source: 'tmdb' })).toThrow(
      /missing filters/
    );
  });

  it('validates releaseTypes range', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { releaseTypes: [0, 3, 7, 4], region: 'US' },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.releaseTypes).toEqual([3, 4]);
  });

  it('strips releaseTypes when region is missing', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { releaseTypes: [3, 4] },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.releaseTypes).toBeUndefined();
  });

  it('validates datePreset values', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { datePreset: 'invalid_preset' },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.datePreset).toBeUndefined();
  });

  it('validates watchMonetizationTypes', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { watchMonetizationTypes: ['flatrate', 'invalid', 'buy'] },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.watchMonetizationTypes).toEqual(['flatrate', 'buy']);
  });

  it('defaults to discover for invalid list type', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { listType: 'airing_today' },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.listType).toBe('discover');
  });

  it('forces listType to discover even for valid non-discover types', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { listType: 'trending_week' },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.listType).toBe('discover');
  });

  it('converts decade year ranges to era presets', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { yearFrom: 2010, yearTo: 2019 },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.datePreset).toBe('era_2010s');
    expect(result.filters.yearFrom).toBeUndefined();
    expect(result.filters.yearTo).toBeUndefined();
  });

  it('keeps yearFrom/yearTo when they do not match a decade range', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { yearFrom: 2015, yearTo: 2018 },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.datePreset).toBeUndefined();
    expect(result.filters.yearFrom).toBe(2015);
    expect(result.filters.yearTo).toBe(2018);
  });

  it('strips recent year range when sorting by release date', () => {
    const currentYear = new Date().getFullYear();
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: {
        sortBy: 'primary_release_date.desc',
        yearFrom: currentYear - 1,
        yearTo: currentYear,
      },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.yearFrom).toBeUndefined();
    expect(result.filters.yearTo).toBeUndefined();
    expect(result.filters.sortBy).toBe('primary_release_date.desc');
  });

  it('keeps intentional year range even when sorting by release date', () => {
    const input = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: {
        sortBy: 'primary_release_date.desc',
        yearFrom: 2015,
        yearTo: 2018,
      },
    };
    const result = sanitizeAIResponse(input);
    expect(result.filters.yearFrom).toBe(2015);
    expect(result.filters.yearTo).toBe(2018);
  });
});

describe('validateGeminiKey', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns valid true on 200 response', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200 });
    const result = await validateGeminiKey('test-key');
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid on 403 response', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await validateGeminiKey('bad-key');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns invalid on network error', async () => {
    globalThis.fetch.mockRejectedValue(new Error('Network error'));
    const result = await validateGeminiKey('test-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('connect');
  });

  it('returns invalid for empty key', async () => {
    const result = await validateGeminiKey('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });
});

describe('generateCatalog', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed catalog on successful generation', async () => {
    const mockResponse = {
      name: 'Sci-Fi Hits',
      type: 'movie',
      source: 'tmdb',
      filters: { genres: [878], sortBy: 'popularity.desc' },
    };
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(mockResponse) }] } }],
      }),
    });

    const result = await generateCatalog('test-key', 'sci-fi movies');
    expect(result.name).toBe('Sci-Fi Hits');
    expect(result.filters.genres).toEqual([878]);
  });

  it('throws on 429 rate limit', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(generateCatalog('key', 'test')).rejects.toThrow(/rate limited/i);
  });

  it('throws on 401/403 invalid key', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(generateCatalog('key', 'test')).rejects.toThrow(/invalid or expired/i);
  });

  it('includes system prompt and schema in request body', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    name: 'Test',
                    type: 'movie',
                    source: 'tmdb',
                    filters: {},
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    await generateCatalog('test-key', 'action movies');

    const callBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(callBody.system_instruction).toBeDefined();
    expect(callBody.generationConfig.response_mime_type).toBe('application/json');
    expect(callBody.generationConfig.response_json_schema).toBeDefined();
    expect(callBody.contents[0].parts[0].text).toBe('action movies');
  });

  it('includes existing catalog in user message for edit mode', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    name: 'Updated',
                    type: 'movie',
                    source: 'tmdb',
                    filters: {},
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const existing = { name: 'Old', type: 'movie', source: 'tmdb', filters: { genres: [28] } };
    await generateCatalog('test-key', 'add comedy', existing);

    const callBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(callBody.contents[0].parts[0].text).toContain('Modify the following existing catalog');
    expect(callBody.contents[0].parts[0].text).toContain('add comedy');
  });

  it('handles malformed JSON in response gracefully', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'not valid json' }] } }],
      }),
    });

    await expect(generateCatalog('key', 'test')).rejects.toThrow(/unexpected response/i);
  });
});
