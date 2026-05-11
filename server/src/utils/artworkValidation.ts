import type { PosterServiceType } from '../types/index.ts';

export type ArtworkProviderForValidation = PosterServiceType | 'metahub' | null | undefined;

const PROVIDERS_REQUIRING_API_KEY = new Set<ArtworkProviderForValidation>(['tvdb', 'fanart']);

export const DEFAULT_FREE_ARTWORK_API_KEYS = Object.freeze({
  rpdb: 't0-free-rpdb',
});

export function getDefaultFreeArtworkApiKey(provider: ArtworkProviderForValidation): string | null {
  if (!provider || typeof provider !== 'string') return null;
  return (
    DEFAULT_FREE_ARTWORK_API_KEYS[provider as keyof typeof DEFAULT_FREE_ARTWORK_API_KEYS] || null
  );
}

export function isDefaultFreeArtworkApiKey(
  provider: ArtworkProviderForValidation,
  rawKey: string | null | undefined
): boolean {
  const expected = getDefaultFreeArtworkApiKey(provider);
  if (!expected) return false;
  return String(rawKey || '').trim() === expected;
}

const GENERIC_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface ArtworkApiKeyValidationResult {
  valid: boolean;
  normalizedKey: string;
  error: string | null;
}

export function artworkProviderRequiresApiKey(provider: ArtworkProviderForValidation): boolean {
  return PROVIDERS_REQUIRING_API_KEY.has(provider || null);
}

export function validateArtworkProviderApiKey(
  provider: ArtworkProviderForValidation,
  rawKey: string | null | undefined,
  opts?: { required?: boolean }
): ArtworkApiKeyValidationResult {
  const normalizedKey = String(rawKey || '').trim();
  const required = Boolean(opts?.required);

  if (!normalizedKey) {
    return {
      valid: !required,
      normalizedKey: '',
      error: required ? 'API key is required for this provider' : null,
    };
  }

  if (/\s/.test(normalizedKey)) {
    return {
      valid: false,
      normalizedKey,
      error: 'API key cannot contain spaces',
    };
  }

  if (!GENERIC_KEY_PATTERN.test(normalizedKey)) {
    return {
      valid: false,
      normalizedKey,
      error: 'API key contains invalid characters',
    };
  }

  if (provider === 'tvdb') {
    const valid = normalizedKey.length >= 16 && normalizedKey.length <= 128;
    return {
      valid,
      normalizedKey,
      error: valid ? null : 'TVDB API key must be 16-128 characters',
    };
  }

  if (provider === 'fanart') {
    const valid = normalizedKey.length >= 16 && normalizedKey.length <= 128;
    return {
      valid,
      normalizedKey,
      error: valid ? null : 'Fanart API key must be 16-128 characters',
    };
  }

  if (provider === 'rpdb' || provider === 'topPosters') {
    const valid = normalizedKey.length >= 8 && normalizedKey.length <= 128;
    return {
      valid,
      normalizedKey,
      error: valid ? null : 'API key must be 8-128 characters',
    };
  }

  const valid = normalizedKey.length <= 128;
  return {
    valid,
    normalizedKey,
    error: valid ? null : 'API key must be 128 characters or less',
  };
}
