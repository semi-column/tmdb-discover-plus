/**
 * ConfigEncryption — Isolated encryption/decryption of stored secrets.
 *
 * Single responsibility: turn raw keys into ciphertext and back.
 * No persistence, no validation beyond format — that belongs in
 * configRepository and configService respectively.
 */
import { encrypt, decrypt } from '../utils/encryption.ts';
import { createLogger } from '../utils/logger.ts';
import type {
  UserConfig,
  ArtworkSettings,
  ArtworkSourceConfig,
  ArtContentType,
  ArtKind,
} from '../types/index.ts';

const log = createLogger('configEncryption');

// ─── TMDB API Key ─────────────────────────────────────────

export function decryptTmdbApiKey(config: UserConfig | null): string | null {
  if (!config?.tmdbApiKeyEncrypted) return null;
  try {
    return decrypt(config.tmdbApiKeyEncrypted) || null;
  } catch (err) {
    log.error('Failed to decrypt TMDB API key', { error: (err as Error).message });
    return null;
  }
}

export function encryptTmdbApiKey(rawKey: string): string | null {
  try {
    return encrypt(rawKey);
  } catch (err) {
    log.error('Failed to encrypt TMDB API key', { error: (err as Error).message });
    return null;
  }
}

// ─── Source-Specific Keys ─────────────────────────────────

export function decryptMalClientId(config: UserConfig | null): string | null {
  if (!config?.malClientIdEncrypted) return null;
  try {
    return decrypt(config.malClientIdEncrypted) || null;
  } catch (err) {
    log.error('Failed to decrypt MAL client ID', { error: (err as Error).message });
    return null;
  }
}

export function decryptSimklApiKey(config: UserConfig | null): string | null {
  if (!config?.simklApiKeyEncrypted) return null;
  try {
    return decrypt(config.simklApiKeyEncrypted) || null;
  } catch (err) {
    log.error('Failed to decrypt Simkl API key', { error: (err as Error).message });
    return null;
  }
}

export function decryptTraktClientId(config: UserConfig | null): string | null {
  if (!config?.traktClientIdEncrypted) return null;
  try {
    return decrypt(config.traktClientIdEncrypted) || null;
  } catch (err) {
    log.error('Failed to decrypt Trakt Client ID', { error: (err as Error).message });
    return null;
  }
}

// ─── Artwork Keys ─────────────────────────────────────────

export function decryptArtworkKey(config: UserConfig | null, artworkType: ArtKind): string | null {
  const artwork = config?.preferences?.artwork;
  if (!artwork) return null;

  let encryptedValue: string | undefined;

  const ART_CONTENT_TYPES: ArtContentType[] = ['movie', 'series', 'anime'];
  if (ART_CONTENT_TYPES.some((ct) => ct in artwork)) {
    const settings = artwork as ArtworkSettings;
    encryptedValue =
      settings.movie?.[artworkType]?.apiKeyEncrypted ||
      settings.series?.[artworkType]?.apiKeyEncrypted ||
      settings.anime?.[artworkType]?.apiKeyEncrypted;
  } else {
    encryptedValue = (artwork as Record<string, ArtworkSourceConfig>)[artworkType]?.apiKeyEncrypted;
  }

  if (!encryptedValue) return null;

  try {
    return decrypt(encryptedValue) || null;
  } catch (err) {
    log.error('Failed to decrypt artwork API key', {
      artworkType,
      error: (err as Error).message,
    });
    return null;
  }
}
