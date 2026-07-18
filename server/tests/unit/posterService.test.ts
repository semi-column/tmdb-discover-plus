import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generatePosterUrl,
  generateBackdropUrl,
  isValidPosterConfig,
  createArtworkOptions,
  applyArtworkOverridesSync,
  checkPosterExists,
  applyArtworkOverridesToMetaPreviews,
  requiresAsyncArtworkResolution,
  validateTvdbApiKeyAuthorization,
} from '../../src/services/artworkService.ts';

describe('generatePosterUrl', () => {
  it('returns RPDB URL using imdbId when available', () => {
    const url = generatePosterUrl({
      apiKey: 'key123',
      service: 'rpdb',
      tmdbId: 550,
      type: 'movie',
      imdbId: 'tt0137523',
    });
    expect(url).toBe(
      'https://api.ratingposterdb.com/key123/imdb/poster-default/tt0137523.jpg?fallback=true'
    );
  });

  it('falls back to tmdbId when no imdbId', () => {
    const url = generatePosterUrl({
      apiKey: 'key123',
      service: 'rpdb',
      tmdbId: 550,
      type: 'movie',
    });
    expect(url).toBe(
      'https://api.ratingposterdb.com/key123/tmdb/poster-default/movie-550.jpg?fallback=true'
    );
  });

  it('uses series prefix for series type', () => {
    const url = generatePosterUrl({
      apiKey: 'key123',
      service: 'topPosters',
      tmdbId: 1399,
      type: 'series',
    });
    expect(url).toContain('/tmdb/poster-default/series-1399.jpg');
  });

  it('supports custom URL pattern placeholders', () => {
    const url = generatePosterUrl({
      service: 'customUrl',
      customUrlPattern: 'https://img.example.com/{type}/{rating_id}?lang={language_short}',
      tmdbId: 1399,
      type: 'series',
      language: 'en-US',
    });
    expect(url).toBe('https://img.example.com/series/series-1399?lang=en');
  });

  it('returns null for custom URL pattern with unresolved placeholder', () => {
    const url = generatePosterUrl({
      service: 'customUrl',
      customUrlPattern: 'https://img.example.com/{imdb_id}.jpg',
      tmdbId: 1399,
      type: 'series',
    });
    expect(url).toBeNull();
  });

  it('returns null for service=none', () => {
    expect(
      generatePosterUrl({ apiKey: 'key', service: 'none', tmdbId: 1, type: 'movie' })
    ).toBeNull();
  });

  it('returns null without apiKey', () => {
    expect(generatePosterUrl({ apiKey: '', service: 'rpdb', tmdbId: 1, type: 'movie' })).toBeNull();
  });

  it('returns null without any ID', () => {
    expect(
      generatePosterUrl({ apiKey: 'key', service: 'rpdb', tmdbId: 0, type: 'movie' })
    ).toBeNull();
  });
});

describe('generateBackdropUrl', () => {
  it('returns backdrop URL using imdbId', () => {
    const url = generateBackdropUrl({
      apiKey: 'key123',
      service: 'rpdb',
      tmdbId: 550,
      type: 'movie',
      imdbId: 'tt0137523',
    });
    expect(url).toContain('/imdb/backdrop-default/tt0137523.jpg');
  });

  it('returns null for service=none', () => {
    expect(
      generateBackdropUrl({ apiKey: 'key', service: 'none', tmdbId: 1, type: 'movie' })
    ).toBeNull();
  });
});

describe('isValidPosterConfig', () => {
  it('returns true for valid config', () => {
    expect(isValidPosterConfig({ apiKey: 'key', service: 'rpdb' })).toBe(true);
  });

  it('returns true for fanart config with apiKey', () => {
    expect(isValidPosterConfig({ apiKey: 'fanartkey123456', service: 'fanart' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidPosterConfig(null)).toBe(false);
  });

  it('returns false for service=none', () => {
    expect(isValidPosterConfig({ apiKey: 'key', service: 'none' })).toBe(false);
  });

  it('returns false for empty apiKey', () => {
    expect(isValidPosterConfig({ apiKey: '', service: 'rpdb' })).toBe(false);
  });

  it('returns false for fanart config without apiKey', () => {
    expect(isValidPosterConfig({ apiKey: '', service: 'fanart' })).toBe(false);
  });

  it('returns true for custom URL service with pattern and no apiKey', () => {
    expect(
      isValidPosterConfig({
        service: 'customUrl',
        customUrlPattern: 'https://img.example.com/{rating_id}.jpg',
      })
    ).toBe(true);
  });
});

describe('createArtworkOptions', () => {
  const mockDecrypt = (s: string) => (s === 'encrypted_key' ? 'decrypted_key' : null);

  it('returns PosterOptions when valid', () => {
    const result = createArtworkOptions(
      { artwork: { poster: { provider: 'rpdb', apiKeyEncrypted: 'encrypted_key' } } },
      mockDecrypt
    ).poster;
    expect(result).toEqual({ apiKey: 'decrypted_key', service: 'rpdb' });
  });

  it('returns null for no preferences', () => {
    expect(createArtworkOptions(null, mockDecrypt).poster).toBeNull();
  });

  it('returns null for service=none', () => {
    expect(
      createArtworkOptions(
        { artwork: { poster: { provider: 'none', apiKeyEncrypted: 'encrypted_key' } } },
        mockDecrypt
      ).poster
    ).toBeNull();
  });

  it('returns null when decrypt fails', () => {
    expect(
      createArtworkOptions(
        { artwork: { poster: { provider: 'rpdb', apiKeyEncrypted: 'bad_key' } } },
        mockDecrypt
      ).poster
    ).toEqual({ apiKey: 't0-free-rpdb', service: 'rpdb' });
  });

  it('uses free RPDB key when no encrypted key is provided', () => {
    expect(
      createArtworkOptions({ artwork: { poster: { provider: 'rpdb' } } }, mockDecrypt).poster
    ).toEqual({
      apiKey: 't0-free-rpdb',
      service: 'rpdb',
    });
  });

  it('does not auto-fill TOP Posters key when no encrypted key is provided', () => {
    expect(
      createArtworkOptions({ artwork: { poster: { provider: 'topPosters' } } }, mockDecrypt).poster
    ).toBeNull();
  });

  it('returns custom URL options without encrypted key', () => {
    const result = createArtworkOptions(
      {
        artwork: {
          poster: {
            provider: 'customUrl',
            customUrlPattern: 'https://img.example.com/{rating_id}.jpg',
          },
        },
      },
      mockDecrypt
    ).poster;

    expect(result).toEqual({
      service: 'customUrl',
      customUrlPattern: 'https://img.example.com/{rating_id}.jpg',
    });
  });

  it('returns fanart options when encrypted key is available', () => {
    const result = createArtworkOptions(
      { artwork: { poster: { provider: 'fanart', apiKeyEncrypted: 'encrypted_key' } } },
      mockDecrypt
    ).poster;

    expect(result).toEqual({ apiKey: 'decrypted_key', service: 'fanart' });
  });
});

describe('requiresAsyncArtworkResolution', () => {
  it('returns true when poster provider is fanart', () => {
    expect(
      requiresAsyncArtworkResolution({
        poster: { service: 'fanart', apiKey: 'fanartkey123456' },
        backdrop: null,
        logo: null,
        landscape: null,
        episode: null,
      })
    ).toBe(true);
  });
});

describe('applyArtworkOverridesToMetaPreviews', () => {
  it('keeps native poster when TMDB provider cannot resolve an ID-backed poster', () => {
    const resolved = applyArtworkOverridesSync(
      { type: 'anime', imdbId: null, tmdbId: 0 },
      {
        poster: 'https://cdn.myanimelist.net/images/anime/123/456.jpg',
      },
      {
        poster: { service: 'tmdb' },
        backdrop: null,
        logo: null,
        landscape: null,
        episode: null,
      }
    );

    expect(resolved.poster).toBe('https://cdn.myanimelist.net/images/anime/123/456.jpg');
  });

  it('applies RPDB preview poster overrides (sync providers)', async () => {
    const metas = [
      {
        id: 'tt0137523',
        imdbId: 'tt0137523',
        type: 'movie',
        name: 'Fight Club',
        poster: 'https://images.metahub.space/poster/medium/tt0137523/img',
        background: null,
        fanart: null,
        landscapePoster: null,
      },
    ];

    const result = await applyArtworkOverridesToMetaPreviews(metas as any, {
      poster: { service: 'rpdb', apiKey: 'preview-rpdb-key' },
      backdrop: null,
      logo: null,
      landscape: null,
      episode: null,
    });

    expect(result[0]?.poster).toBe(
      'https://api.ratingposterdb.com/preview-rpdb-key/imdb/poster-default/tt0137523.jpg?fallback=true'
    );
  });

  it('falls back to TMDB poster when IMDb provider has no native artwork in strict mode', async () => {
    const metas = [
      {
        id: 'tmdb:550',
        tmdbId: 550,
        imdbId: 'tt0137523',
        imdb_id: 'tt0137523',
        type: 'movie',
        name: 'Fight Club',
        poster: 'https://image.tmdb.org/t/p/w500/example.jpg',
        background: null,
        fanart: null,
        landscapePoster: null,
      },
    ];

    const result = await applyArtworkOverridesToMetaPreviews(
      metas as any,
      {
        poster: { service: 'imdb' },
        backdrop: null,
        logo: null,
        landscape: null,
        episode: null,
      },
      { strictPoster: true }
    );

    expect(result[0]?.poster).toBe('https://image.tmdb.org/t/p/w500/example.jpg');
  });

  it('keeps native poster in strict mode when fanart lookup misses', async () => {
    const metas = [
      {
        id: 'tmdb:550',
        tmdbId: 550,
        imdbId: 'tt0137523',
        imdb_id: 'tt0137523',
        type: 'movie',
        name: 'Fight Club',
        poster: 'https://image.tmdb.org/t/p/w500/native-poster.jpg',
        background: null,
        fanart: null,
        landscapePoster: null,
      },
    ];

    const result = await applyArtworkOverridesToMetaPreviews(
      metas as any,
      {
        poster: { service: 'fanart', apiKey: 'fanartkey123456' },
        backdrop: null,
        logo: null,
        landscape: null,
        episode: null,
      },
      { strictPoster: true }
    );

    expect(result[0]?.poster).toBe('https://image.tmdb.org/t/p/w500/native-poster.jpg');
  });

  it('falls back to metahub in strict mode when fanart lookup misses and native poster is absent', async () => {
    const metas = [
      {
        id: 'tmdb:550',
        tmdbId: 550,
        imdbId: 'tt0137523',
        imdb_id: 'tt0137523',
        type: 'movie',
        name: 'Fight Club',
        poster: null,
        background: null,
        fanart: null,
        landscapePoster: null,
      },
    ];

    const result = await applyArtworkOverridesToMetaPreviews(
      metas as any,
      {
        poster: { service: 'fanart', apiKey: 'fanartkey123456' },
        backdrop: null,
        logo: null,
        landscape: null,
        episode: null,
      },
      { strictPoster: true }
    );

    expect(result[0]?.poster).toBe('https://images.metahub.space/poster/medium/tt0137523/img');
  });

  it('uses TMDB fallback instead of non-TMDB native poster when selected provider misses', async () => {
    const metas = [
      {
        id: 'tmdb:550',
        tmdbId: 550,
        imdbId: 'tt0137523',
        imdb_id: 'tt0137523',
        type: 'movie',
        name: 'Fight Club',
        poster: 'https://m.media-amazon.com/images/M/native-imdb.jpg',
        background: null,
        fanart: null,
        landscapePoster: null,
      },
    ];

    const result = await applyArtworkOverridesToMetaPreviews(
      metas as any,
      {
        poster: { service: 'fanart', apiKey: 'fanartkey123456' },
        backdrop: null,
        logo: null,
        landscape: null,
        episode: null,
      },
      { strictPoster: true }
    );

    expect(result[0]?.poster).toBe('https://images.metahub.space/poster/medium/tt0137523/img');
  });
});

describe('checkPosterExists', () => {
  const fetchMock = vi.fn();
  const trustedPosterBase = 'https://api.ratingposterdb.com';

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns true for a valid image response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => (h === 'content-type' ? 'image/jpeg' : null) },
    });
    const result = await checkPosterExists(`${trustedPosterBase}/poster-valid-1.jpg`);
    expect(result).toBe(true);
  });

  it('returns false for a 404 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
    });
    const result = await checkPosterExists(`${trustedPosterBase}/poster-404.jpg`);
    expect(result).toBe(false);
  });

  it('returns false when content-type is not an image', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => (h === 'content-type' ? 'text/html' : null) },
    });
    const result = await checkPosterExists(`${trustedPosterBase}/poster-html.jpg`);
    expect(result).toBe(false);
  });

  it('returns false when content-length is too small', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) => {
          if (h === 'content-type') return 'image/jpeg';
          if (h === 'content-length') return '50';
          return null;
        },
      },
    });
    const result = await checkPosterExists(`${trustedPosterBase}/poster-tiny.jpg`);
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    const result = await checkPosterExists(`${trustedPosterBase}/poster-network-err.jpg`);
    expect(result).toBe(false);
  });

  it('caches positive results', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => (h === 'content-type' ? 'image/jpeg' : null) },
    });
    const url = `${trustedPosterBase}/poster-cache-pos.jpg`;
    await checkPosterExists(url);
    await checkPosterExists(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches negative results', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, headers: { get: () => null } });
    const url = `${trustedPosterBase}/poster-cache-neg.jpg`;
    await checkPosterExists(url);
    await checkPosterExists(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns false for untrusted host and does not call fetch', async () => {
    const result = await checkPosterExists('https://example.com/poster-blocked.jpg');
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('validateTvdbApiKeyAuthorization', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns valid true when TVDB login succeeds with token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { token: 'tvdb-token' } }),
    });

    const result = await validateTvdbApiKeyAuthorization('tvdb_valid_key_123456');
    expect(result).toEqual({
      valid: true,
      invalidKey: false,
      error: null,
      statusCode: 200,
    });
  });

  it('flags invalid key for 401/403 responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    const result = await validateTvdbApiKeyAuthorization('tvdb_invalid_key_123456');
    expect(result.valid).toBe(false);
    expect(result.invalidKey).toBe(true);
    expect(result.statusCode).toBe(401);
  });

  it('treats non-auth upstream errors as non-invalidKey failures', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await validateTvdbApiKeyAuthorization('tvdb_maybe_valid_key_123456');
    expect(result.valid).toBe(false);
    expect(result.invalidKey).toBe(false);
    expect(result.statusCode).toBe(500);
  });

  it('treats network failures as non-invalidKey failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    const result = await validateTvdbApiKeyAuthorization('tvdb_network_case_123456');
    expect(result.valid).toBe(false);
    expect(result.invalidKey).toBe(false);
    expect(result.error).toContain('Failed to reach TVDB API');
  });
});
