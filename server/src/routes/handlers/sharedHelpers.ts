import type { UserConfig, ArtworkOptions, ContentType } from '../../types/index.ts';
import { createArtworkOptions, resolveContentType } from '../../services/artworkService.ts';
import { decrypt } from '../../utils/encryption.ts';
import { normalizeBaseUrl } from '../../constants.ts';

/**
 * Builds the per-request artwork options bundle used by source handlers.
 * Encapsulates the decrypt-on-read for user-supplied artwork API keys
 * so every source treats malformed ciphertext identically (no key).
 */
export function buildArtworkOptions(
  userConfig: UserConfig,
  type?: ContentType,
  source?: string
): ArtworkOptions {
  return createArtworkOptions(
    userConfig.preferences || null,
    (encrypted) => {
      try {
        return decrypt(encrypted);
      } catch {
        return null;
      }
    },
    resolveContentType(type || 'movie', source)
  );
}

/**
 * URLs of the static placeholder posters/backdrops served by the addon.
 * Derived once per request from the base URL so the manifest, catalog,
 * and meta responses all agree on the same fallback host.
 */
export function getPlaceholderUrls(baseUrl: string): {
  posterPlaceholder: string;
  backdropPlaceholder: string;
} {
  const base = normalizeBaseUrl(baseUrl);
  return {
    posterPlaceholder: `${base}/placeholder-poster.svg`,
    backdropPlaceholder: `${base}/placeholder-thumbnail.svg`,
  };
}
