import fetch from 'node-fetch';
import { createLogger } from '../utils/logger.ts';
import { config as appConfig } from '../config.ts';
import { TIMEOUTS, metahubUrl } from '../constants.ts';
import type {
  ContentType,
  PosterOptions,
  PosterServiceType,
  PosterUrlOptions,
  ArtworkOptions,
  ArtworkSourceConfig,
  ArtworkSettings,
  ArtContentType,
  ArtKind,
  ContentTypeArtwork,
  ArtworkOptionsMap,
  StremioMetaPreview,
} from '../types/index.ts';

const log = createLogger('artworkService');

export type ArtworkKind = 'poster' | 'backdrop' | 'logo' | 'landscape' | 'episode';

export type ArtworkProvider = PosterServiceType;

export type ArtworkProviderConfig = PosterOptions;

export interface ArtworkContext {
  tmdbId?: number | string;
  imdbId?: string | null;
  type: ContentType;
  language?: string | null;
  englishArtOnly?: boolean;
  originalLangFallback?: boolean;
  season?: number;
  episode?: number;
}

export interface ResolvedArtwork {
  poster: string | null;
  backdrop: string | null;
  logo: string | null;
  landscape: string | null;
  episode: string | null;
}

export type NativeArtworkUrls = Partial<Record<ArtworkKind, string | null>>;

interface ArtworkProviderDefinition {
  id: ArtworkProvider;
  supportedKinds: Set<ArtworkKind>;
  requiresApiKey: boolean;
  resolve(context: ArtworkContext, kind: ArtworkKind, config: PosterOptions): string | null;
}

const RPDB_BASE_URL = 'https://api.ratingposterdb.com';
const TOP_POSTERS_BASE_URL = 'https://api.top-streaming.stream';
const TVDB_API_BASE_URL = 'https://api4.thetvdb.com/v4';
const FANART_API_BASE_URL = 'https://webservice.fanart.tv/v3';

const ARTWORK_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const ARTWORK_CHECK_NEGATIVE_TTL_MS = 60 * 60 * 1000;
const ARTWORK_CHECK_MAX_CACHE = 2000;
const ALLOWED_CHECK_HOSTS = new Set([
  'api.ratingposterdb.com',
  'api.top-streaming.stream',
  'image.tmdb.org',
  'assets.fanart.tv',
]);

interface ArtworkCheckEntry {
  exists: boolean;
  ts: number;
}

const artworkCheckCache = new Map<string, ArtworkCheckEntry>();

interface TvdbTokenEntry {
  token: string;
  ts: number;
}

const tvdbTokenCache = new Map<string, TvdbTokenEntry>();
const TVDB_TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000;

interface TvdbArtworkRecord {
  image?: string;
  thumbnail?: string;
  type?: number;
  language?: string;
  locale?: string;
}

interface FanartAssetRecord {
  id?: string | number;
  url?: string;
  likes?: string | number;
  lang?: string;
  season?: string;
}

interface FanartApiPayload {
  movieposter?: FanartAssetRecord[];
  moviebackground?: FanartAssetRecord[];
  hdmovielogo?: FanartAssetRecord[];
  movielogo?: FanartAssetRecord[];
  moviethumb?: FanartAssetRecord[];
  moviebanner?: FanartAssetRecord[];
  tvposter?: FanartAssetRecord[];
  showbackground?: FanartAssetRecord[];
  hdtvlogo?: FanartAssetRecord[];
  clearlogo?: FanartAssetRecord[];
  tvthumb?: FanartAssetRecord[];
  tvbanner?: FanartAssetRecord[];
  [key: string]: unknown;
}

export interface TvdbApiKeyAuthorizationResult {
  valid: boolean;
  invalidKey: boolean;
  error: string | null;
  statusCode?: number;
}

function evictStaleEntries(): void {
  if (artworkCheckCache.size <= ARTWORK_CHECK_MAX_CACHE) return;
  const now = Date.now();
  for (const [key, entry] of artworkCheckCache) {
    const ttl = entry.exists ? ARTWORK_CHECK_TTL_MS : ARTWORK_CHECK_NEGATIVE_TTL_MS;
    if (now - entry.ts > ttl) {
      artworkCheckCache.delete(key);
    }
  }
  if (artworkCheckCache.size > ARTWORK_CHECK_MAX_CACHE) {
    const excess = artworkCheckCache.size - ARTWORK_CHECK_MAX_CACHE;
    const keys = artworkCheckCache.keys();
    for (let i = 0; i < excess; i++) {
      const next = keys.next();
      if (!next.done) artworkCheckCache.delete(next.value);
    }
  }
}

export async function checkArtworkExists(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !ALLOWED_CHECK_HOSTS.has(parsed.hostname)) {
      return false;
    }
  } catch {
    return false;
  }

  const cached = artworkCheckCache.get(url);
  if (cached) {
    const ttl = cached.exists ? ARTWORK_CHECK_TTL_MS : ARTWORK_CHECK_NEGATIVE_TTL_MS;
    if (Date.now() - cached.ts < ttl) return cached.exists;
    artworkCheckCache.delete(url);
  }

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(TIMEOUTS.RPDB_FETCH_MS),
      redirect: 'follow',
    });

    if (!response.ok) {
      artworkCheckCache.set(url, { exists: false, ts: Date.now() });
      evictStaleEntries();
      return false;
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      artworkCheckCache.set(url, { exists: false, ts: Date.now() });
      evictStaleEntries();
      return false;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) < 100) {
      artworkCheckCache.set(url, { exists: false, ts: Date.now() });
      evictStaleEntries();
      return false;
    }

    artworkCheckCache.set(url, { exists: true, ts: Date.now() });
    evictStaleEntries();
    return true;
  } catch {
    artworkCheckCache.set(url, { exists: false, ts: Date.now() });
    evictStaleEntries();
    return false;
  }
}

function hasValidTmdbId(tmdbId: number | string | null | undefined): boolean {
  if (tmdbId === null || tmdbId === undefined) return false;
  const value = String(tmdbId).trim();
  return value.length > 0 && value !== '0';
}

function getTypePrefix(type: string): 'movie' | 'series' {
  return type === 'series' || type === 'anime' ? 'series' : 'movie';
}

function looksLikePoster(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('poster') || lower.includes('/posters/') || lower.includes('/poster/');
}

function looksLikeBackdrop(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('background') ||
    lower.includes('banner') ||
    lower.includes('fanart') ||
    lower.includes('/backgrounds/') ||
    lower.includes('/banners/')
  );
}

function looksLikeLogo(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('logo') || lower.includes('clearlogo');
}

function normalizeLanguageCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value || value === 'null' || value === 'undefined') return null;

  const iso3To2: Record<string, string> = {
    eng: 'en',
  };

  if (iso3To2[value]) return iso3To2[value];
  if (value.length === 2) return value;
  if (value.includes('-')) return value.split('-')[0];
  if (value.length === 3) return value;
  return value;
}

function isEnglishLike(lang: string | null): boolean {
  return lang === 'en' || lang === 'eng';
}

interface LanguageSelectionOptions {
  englishOnly: boolean;
  allowFallback: boolean;
}

function pickArtworkByKind(
  artworks: TvdbArtworkRecord[],
  kind: ArtworkKind,
  options: LanguageSelectionOptions
): string | null {
  if (!artworks.length) return null;

  const candidates = artworks
    .map((art) => {
      const url = art.image || art.thumbnail || '';
      const lang = normalizeLanguageCode(art.language || art.locale || null);
      return {
        url,
        lang,
      };
    })
    .filter((item): item is { url: string; lang: string | null } => Boolean(item.url));

  if (!candidates.length) return null;

  const preferredCandidates = options.englishOnly
    ? candidates.filter((candidate) => {
        const lang = candidate.lang;
        return isEnglishLike(lang) || !lang;
      })
    : candidates;

  const pool = preferredCandidates.length > 0 ? preferredCandidates : candidates;
  if (options.englishOnly && preferredCandidates.length === 0 && !options.allowFallback) {
    return null;
  }

  const urls = pool.map((candidate) => candidate.url);

  if (kind === 'logo') {
    return urls.find(looksLikeLogo) || urls[0] || null;
  }

  if (kind === 'backdrop' || kind === 'landscape') {
    return urls.find(looksLikeBackdrop) || urls[0] || null;
  }

  if (kind === 'poster') {
    return urls.find(looksLikePoster) || urls[0] || null;
  }

  // episode or unknown: best effort
  return urls[0] || null;
}

function normalizeFanartUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const normalized = String(url)
    .trim()
    .replace(/^http:\/\//i, 'https://');
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseFanartLikes(rawLikes: unknown): number {
  const parsed = Number(rawLikes);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rankFanartAsset(
  asset: FanartAssetRecord,
  preferredLanguage: string | null,
  preferredLanguageShort: string | null
): number {
  const lang = String(asset.lang || '')
    .trim()
    .toLowerCase();
  const likes = parseFanartLikes(asset.likes);

  let langScore = 1;
  if (preferredLanguage && lang === preferredLanguage) langScore = 6;
  else if (preferredLanguageShort && lang === preferredLanguageShort) langScore = 5;
  else if (lang === 'en') langScore = 4;
  else if (!lang || lang === '00') langScore = 3;

  return langScore * 1000 + likes;
}

function pickFanartAssetUrl(
  assets: FanartAssetRecord[] | null | undefined,
  language: string | null | undefined,
  options: LanguageSelectionOptions
): string | null {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  const preferredLanguage = String(language || '')
    .trim()
    .toLowerCase();
  const preferredLanguageShort = preferredLanguage.includes('-')
    ? preferredLanguage.split('-')[0]
    : preferredLanguage;

  const validAssets = assets
    .map((asset) => ({
      asset,
      normalizedUrl: normalizeFanartUrl(asset.url),
      score: rankFanartAsset(asset, preferredLanguage || null, preferredLanguageShort || null),
      lang: normalizeLanguageCode(asset.lang),
    }))
    .filter((item) => Boolean(item.normalizedUrl))
    .sort((a, b) => b.score - a.score);

  if (options.englishOnly) {
    const englishCandidates = validAssets.filter((item) => {
      const lang = item.lang;
      return isEnglishLike(lang) || !lang;
    });

    if (englishCandidates.length > 0) {
      return englishCandidates[0]?.normalizedUrl || null;
    }

    if (!options.allowFallback) {
      return null;
    }
  }

  return validAssets[0]?.normalizedUrl || null;
}

async function getTvdbToken(apiKey: string): Promise<string | null> {
  const now = Date.now();
  const cached = tvdbTokenCache.get(apiKey);
  if (cached && now - cached.ts < TVDB_TOKEN_TTL_MS) {
    return cached.token;
  }

  try {
    const response = await fetch(`${TVDB_API_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apikey: apiKey }),
      signal: AbortSignal.timeout(TIMEOUTS.RPDB_FETCH_MS),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { data?: { token?: string } };
    const token = payload?.data?.token;
    if (!token) return null;

    tvdbTokenCache.set(apiKey, { token, ts: now });
    return token;
  } catch {
    return null;
  }
}

export async function validateTvdbApiKeyAuthorization(
  rawApiKey: string
): Promise<TvdbApiKeyAuthorizationResult> {
  const apiKey = String(rawApiKey || '').trim();
  if (!apiKey) {
    return {
      valid: false,
      invalidKey: true,
      error: 'TVDB API key is required',
    };
  }

  try {
    const response = await fetch(`${TVDB_API_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apikey: apiKey }),
      signal: AbortSignal.timeout(TIMEOUTS.RPDB_FETCH_MS),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          invalidKey: true,
          error: 'TVDB rejected this API key',
          statusCode: response.status,
        };
      }

      return {
        valid: false,
        invalidKey: false,
        error: `TVDB API returned status ${response.status}`,
        statusCode: response.status,
      };
    }

    const payload = (await response.json()) as { data?: { token?: string } };
    const token = payload?.data?.token;
    if (!token) {
      return {
        valid: false,
        invalidKey: true,
        error: 'TVDB did not return a valid access token',
      };
    }

    const now = Date.now();
    tvdbTokenCache.set(apiKey, { token, ts: now });

    return {
      valid: true,
      invalidKey: false,
      error: null,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      valid: false,
      invalidKey: false,
      error: `Failed to reach TVDB API: ${(error as Error).message}`,
    };
  }
}

async function fetchTvdbJson<T>(path: string, token: string): Promise<T | null> {
  try {
    const response = await fetch(`${TVDB_API_BASE_URL}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUTS.RPDB_FETCH_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function resolveTvdbArtworkUrl(
  context: ArtworkContext,
  kind: ArtworkKind,
  apiKey: string
): Promise<string | null> {
  const imdbId = context.imdbId;
  if (!imdbId || !imdbId.startsWith('tt')) return null;

  const token = await getTvdbToken(apiKey);
  if (!token) return null;

  type SearchByRemoteIdPayload = {
    data?: Array<{
      series?: { id?: number; image?: string };
      movie?: { id?: number; image?: string };
    }>;
  };

  const searchPayload = await fetchTvdbJson<SearchByRemoteIdPayload>(
    `/search/remoteid/${encodeURIComponent(imdbId)}`,
    token
  );
  const first = searchPayload?.data?.[0];
  const tvdbMediaType: 'series' | 'movie' = context.type === 'movie' ? 'movie' : 'series';
  const record = tvdbMediaType === 'series' ? first?.series : first?.movie;
  const tvdbId = record?.id;
  if (!tvdbId) return null;

  const languageSelectionOptions: LanguageSelectionOptions = {
    englishOnly: Boolean(context.englishArtOnly),
    allowFallback: context.originalLangFallback !== false,
  };

  if (tvdbMediaType === 'series') {
    type SeriesArtworksPayload = {
      data?: { artworks?: TvdbArtworkRecord[] };
    };
    const seriesPayload = await fetchTvdbJson<SeriesArtworksPayload>(
      `/series/${tvdbId}/artworks`,
      token
    );
    const fromArtworks = pickArtworkByKind(
      seriesPayload?.data?.artworks || [],
      kind,
      languageSelectionOptions
    );
    if (fromArtworks) return fromArtworks;
  } else {
    type MovieExtendedPayload = {
      data?: { artworks?: TvdbArtworkRecord[]; image?: string };
    };
    const moviePayload = await fetchTvdbJson<MovieExtendedPayload>(
      `/movies/${tvdbId}/extended`,
      token
    );
    const fromArtworks = pickArtworkByKind(
      moviePayload?.data?.artworks || [],
      kind,
      languageSelectionOptions
    );
    if (fromArtworks) return fromArtworks;
    if (
      kind === 'poster' &&
      moviePayload?.data?.image &&
      (!languageSelectionOptions.englishOnly || languageSelectionOptions.allowFallback)
    ) {
      return moviePayload.data.image;
    }
  }

  if (languageSelectionOptions.englishOnly && !languageSelectionOptions.allowFallback) {
    return null;
  }

  return record?.image || null;
}

const FANART_MOVIE_KIND_FIELDS: Partial<Record<ArtworkKind, string[]>> = {
  poster: ['movieposter'],
  backdrop: ['moviebackground'],
  logo: ['hdmovielogo', 'movielogo'],
  landscape: ['moviethumb', 'moviebanner'],
};

const FANART_TV_KIND_FIELDS: Partial<Record<ArtworkKind, string[]>> = {
  poster: ['tvposter'],
  backdrop: ['showbackground'],
  logo: ['hdtvlogo', 'clearlogo'],
  landscape: ['tvthumb', 'tvbanner'],
};

async function fetchFanartPayload(path: string, apiKey: string): Promise<FanartApiPayload | null> {
  try {
    const response = await fetch(
      `${FANART_API_BASE_URL}/${path}?api_key=${encodeURIComponent(apiKey)}`,
      {
        headers: {
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUTS.RPDB_FETCH_MS),
      }
    );

    if (!response.ok) return null;

    return (await response.json()) as FanartApiPayload;
  } catch {
    return null;
  }
}

function getFanartLookupPaths(context: ArtworkContext): string[] {
  const imdbId = context.imdbId && context.imdbId.startsWith('tt') ? context.imdbId : null;
  const tmdbId = hasValidTmdbId(context.tmdbId) ? String(context.tmdbId).trim() : null;
  const isMovie = context.type === 'movie';

  const candidates = isMovie
    ? [tmdbId ? `movies/${tmdbId}` : null, imdbId ? `movies/${imdbId}` : null]
    : [imdbId ? `tv/${imdbId}` : null, tmdbId ? `tv/${tmdbId}` : null];

  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))));
}

async function resolveFanartArtworkUrl(
  context: ArtworkContext,
  kind: ArtworkKind,
  apiKey: string
): Promise<string | null> {
  if (kind === 'episode') return null;

  const fieldsMap = context.type === 'movie' ? FANART_MOVIE_KIND_FIELDS : FANART_TV_KIND_FIELDS;
  const kindFields = fieldsMap[kind] || [];
  if (kindFields.length === 0) return null;

  const lookupPaths = getFanartLookupPaths(context);
  if (lookupPaths.length === 0) return null;

  const languageSelectionOptions: LanguageSelectionOptions = {
    englishOnly: Boolean(context.englishArtOnly),
    allowFallback: context.originalLangFallback !== false,
  };

  for (const lookupPath of lookupPaths) {
    const payload = await fetchFanartPayload(lookupPath, apiKey);
    if (!payload) continue;

    for (const field of kindFields) {
      const candidateUrl = pickFanartAssetUrl(
        payload[field] as FanartAssetRecord[] | undefined,
        context.language,
        languageSelectionOptions
      );
      if (candidateUrl) return candidateUrl;
    }
  }

  return null;
}

function resolveExternalUrl(
  context: ArtworkContext,
  kind: ArtworkKind,
  baseUrl: string,
  apiKey: string
): string | null {
  const { tmdbId, imdbId, type } = context;

  if (!hasValidTmdbId(tmdbId) && !imdbId) return null;

  const rpdbKind = kind === 'landscape' ? 'backdrop' : kind;
  const fileExtension = rpdbKind === 'logo' ? 'png' : 'jpg';

  if (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt')) {
    return `${baseUrl}/${apiKey}/imdb/${rpdbKind}-default/${imdbId}.${fileExtension}?fallback=true`;
  }

  const prefix = getTypePrefix(type);
  return `${baseUrl}/${apiKey}/tmdb/${rpdbKind}-default/${prefix}-${tmdbId}.${fileExtension}?fallback=true`;
}

function resolveTopPostersUrl(
  context: ArtworkContext,
  kind: ArtworkKind,
  apiKey: string
): string | null {
  const { tmdbId, imdbId, type, season, episode } = context;
  const hasImdb = Boolean(imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt'));
  const hasTmdb = hasValidTmdbId(tmdbId);
  const tmdbIdStr = hasTmdb ? String(tmdbId).trim() : '';

  if (kind === 'poster') {
    if (hasImdb) {
      return `${TOP_POSTERS_BASE_URL}/${apiKey}/imdb/poster-default/${imdbId}.jpg?fallback=true`;
    }
    if (hasTmdb) {
      const prefix = getTypePrefix(type);
      return `${TOP_POSTERS_BASE_URL}/${apiKey}/tmdb/poster-default/${prefix}-${tmdbIdStr}.jpg?fallback=true`;
    }
    return null;
  }

  if (kind === 'logo') {
    if (hasImdb) {
      return `${TOP_POSTERS_BASE_URL}/${apiKey}/imdb/logo/${imdbId}.png?fallback=true`;
    }
    if (hasTmdb) {
      const prefix = getTypePrefix(type);
      return `${TOP_POSTERS_BASE_URL}/${apiKey}/tmdb/logo/${prefix}-${tmdbIdStr}.png?fallback=true`;
    }
    return null;
  }

  if (kind === 'episode') {
    const seasonNum = Number(season);
    const episodeNum = Number(episode);
    if (!Number.isInteger(seasonNum) || !Number.isInteger(episodeNum)) return null;
    if (seasonNum <= 0 || episodeNum <= 0) return null;
    if (type !== 'series' && type !== 'anime') return null;

    if (hasImdb) {
      return `${TOP_POSTERS_BASE_URL}/${apiKey}/imdb/thumbnail/${imdbId}/S${seasonNum}E${episodeNum}.jpg?fallback=true`;
    }

    if (hasTmdb) {
      return `${TOP_POSTERS_BASE_URL}/${apiKey}/tmdb/thumbnail/series-${tmdbIdStr}/S${seasonNum}E${episodeNum}.jpg?fallback=true`;
    }

    return null;
  }

  return null;
}

function resolveCustomUrl(
  context: ArtworkContext,
  kind: ArtworkKind,
  config: PosterOptions
): string | null {
  const pattern = config.customUrlPattern?.trim();
  if (!pattern) return null;

  const { tmdbId, imdbId, type, language, season, episode } = context;
  const typePrefix = getTypePrefix(type);
  const hasImdb = Boolean(imdbId && String(imdbId).startsWith('tt'));
  const hasTmdb = hasValidTmdbId(tmdbId);
  const tmdbIdStr = hasTmdb ? String(tmdbId).trim() : '';
  const imdbIdStr = hasImdb ? String(imdbId) : '';

  const ratingIdType = hasImdb ? 'imdb' : hasTmdb ? 'tmdb' : '';
  const ratingId = hasImdb ? imdbIdStr : hasTmdb ? `${typePrefix}-${tmdbIdStr}` : '';

  const lang = String(language || 'en').trim() || 'en';
  const langShort = lang.includes('-') ? lang.split('-')[0] : lang;
  const seasonStr = typeof season === 'number' && Number.isFinite(season) ? String(season) : '';
  const episodeStr = typeof episode === 'number' && Number.isFinite(episode) ? String(episode) : '';

  const replacements: Record<string, string> = {
    '{id}': imdbIdStr || tmdbIdStr,
    '{imdb_id}': imdbIdStr,
    '{tmdb_id}': tmdbIdStr,
    '{asset}': kind,
    '{asset_type}': kind,
    '{art_type}': kind,
    '{type}': type,
    '{type_prefix}': typePrefix,
    '{tmdb_type_id}': hasTmdb ? `${typePrefix}-${tmdbIdStr}` : '',
    '{rating_id_type}': ratingIdType,
    '{rating_id}': ratingId,
    '{language}': lang,
    '{language_short}': langShort,
    '{season}': seasonStr,
    '{episode}': episodeStr,
    '{season_number}': seasonStr,
    '{episode_number}': episodeStr,
    '{s}': seasonStr,
    '{e}': episodeStr,
    '{api_key}': config.apiKey || '',
    '{api_key_urlencoded}': config.apiKey ? encodeURIComponent(config.apiKey) : '',
  };

  const placeholdersInPattern = pattern.match(/\{[a-z_]+\}/g) || [];
  const unknownPlaceholder = placeholdersInPattern.find(
    (placeholder) => !(placeholder in replacements)
  );
  if (unknownPlaceholder) {
    log.debug('Unsupported custom artwork placeholder', { unknownPlaceholder });
    return null;
  }

  let resolved = pattern;
  for (const placeholder of placeholdersInPattern) {
    const value = replacements[placeholder] ?? '';
    if (!value) {
      log.debug('Missing value for custom artwork placeholder', { placeholder });
      return null;
    }
    resolved = resolved.split(placeholder).join(value);
  }

  try {
    const parsed = new URL(resolved);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const RPDB_SUPPORTED_KINDS: Set<ArtworkKind> = new Set(['poster', 'backdrop', 'logo', 'landscape']);
const TOP_POSTERS_SUPPORTED_KINDS: Set<ArtworkKind> = new Set(['poster', 'logo', 'episode']);
const FANART_SUPPORTED_KINDS: Set<ArtworkKind> = new Set([
  'poster',
  'backdrop',
  'logo',
  'landscape',
]);
const METAHUB_SUPPORTED_KINDS: Set<ArtworkKind> = new Set([
  'poster',
  'backdrop',
  'logo',
  'landscape',
]);
const ALL_KINDS: Set<ArtworkKind> = new Set(['poster', 'backdrop', 'logo', 'landscape', 'episode']);

const METAHUB_KIND_MAP: Partial<Record<ArtworkKind, 'poster' | 'background' | 'logo'>> = {
  poster: 'poster',
  backdrop: 'background',
  logo: 'logo',
  landscape: 'background',
};

const TMDB_NATIVE_HOSTS = new Set(['image.tmdb.org']);
const IMDB_NATIVE_HOSTS = new Set([
  'm.media-amazon.com',
  'imdb.com',
  'www.imdb.com',
  'images-na.ssl-images-amazon.com',
]);
const TVDB_NATIVE_HOSTS = new Set(['artworks.thetvdb.com', 'thetvdb.com', 'www.thetvdb.com']);

function getUrlHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isNativeFromProvider(url: string | null | undefined, service: PosterServiceType): boolean {
  const host = getUrlHostname(url);
  if (!host) return false;

  if (service === 'tmdb') return TMDB_NATIVE_HOSTS.has(host);
  if (service === 'imdb') return IMDB_NATIVE_HOSTS.has(host);
  if (service === 'tvdb') return TVDB_NATIVE_HOSTS.has(host);
  return false;
}

function getNativePreferredForService(
  nativeUrl: string | null | undefined,
  service: PosterServiceType
): string | null {
  if (!nativeUrl) return null;
  return isNativeFromProvider(nativeUrl, service) ? nativeUrl : null;
}

const rpdbProvider: ArtworkProviderDefinition = {
  id: 'rpdb',
  supportedKinds: RPDB_SUPPORTED_KINDS,
  requiresApiKey: true,
  resolve(context, kind, config) {
    if (!config.apiKey) return null;
    return resolveExternalUrl(context, kind, RPDB_BASE_URL, config.apiKey);
  },
};

const topPostersProvider: ArtworkProviderDefinition = {
  id: 'topPosters',
  supportedKinds: TOP_POSTERS_SUPPORTED_KINDS,
  requiresApiKey: true,
  resolve(context, kind, config) {
    if (!config.apiKey) return null;
    return resolveTopPostersUrl(context, kind, config.apiKey);
  },
};

const tmdbProvider: ArtworkProviderDefinition = {
  id: 'tmdb',
  supportedKinds: METAHUB_SUPPORTED_KINDS,
  requiresApiKey: false,
  resolve(context, kind) {
    const imdbId = context.imdbId;
    if (!imdbId || !imdbId.startsWith('tt')) return null;
    const metahubKind = METAHUB_KIND_MAP[kind];
    if (!metahubKind) return null;
    return metahubUrl(metahubKind, imdbId);
  },
};

const imdbProvider: ArtworkProviderDefinition = {
  id: 'imdb',
  supportedKinds: ALL_KINDS,
  requiresApiKey: false,
  resolve() {
    // IMDb is handled as a source preference in applyArtworkOverrides
    return null;
  },
};

const tvdbProvider: ArtworkProviderDefinition = {
  id: 'tvdb',
  supportedKinds: ALL_KINDS,
  requiresApiKey: false,
  resolve() {
    // TVDB is handled as a source preference in applyArtworkOverrides
    return null;
  },
};

const fanartProvider: ArtworkProviderDefinition = {
  id: 'fanart',
  supportedKinds: FANART_SUPPORTED_KINDS,
  requiresApiKey: true,
  resolve() {
    // Fanart is handled as an async provider in applyArtworkOverrides
    return null;
  },
};

const customUrlProvider: ArtworkProviderDefinition = {
  id: 'customUrl',
  supportedKinds: ALL_KINDS,
  requiresApiKey: false,
  resolve(context, kind, config) {
    return resolveCustomUrl(context, kind, config);
  },
};

const providerRegistry = new Map<ArtworkProvider, ArtworkProviderDefinition>([
  ['rpdb', rpdbProvider],
  ['topPosters', topPostersProvider],
  ['tmdb', tmdbProvider],
  ['imdb', imdbProvider],
  ['tvdb', tvdbProvider],
  ['fanart', fanartProvider],
  ['metahub' as ArtworkProvider, tmdbProvider], // backward compat alias
  ['customUrl', customUrlProvider],
]);

export function isValidArtworkConfig(config: PosterOptions | null): boolean {
  if (!config) return false;
  const { service, apiKey, customUrlPattern } = config;
  if (!service || service === 'none') return false;
  if (service === 'customUrl') return Boolean(customUrlPattern && customUrlPattern.trim());
  if (service === 'tmdb' || service === 'imdb' || service === ('metahub' as PosterServiceType))
    return true;
  return Boolean(apiKey);
}

export function resolveArtworkUrl(
  context: ArtworkContext,
  kind: ArtworkKind,
  config: PosterOptions | null
): string | null {
  if (!config || !isValidArtworkConfig(config)) return null;

  const definition = providerRegistry.get(config.service);
  if (!definition) return null;
  if (!definition.supportedKinds.has(kind)) return null;

  return definition.resolve(context, kind, config);
}

function metahubFallback(kind: ArtworkKind, imdbId: string | null | undefined): string | null {
  if (!imdbId || !imdbId.startsWith('tt')) return null;
  const metahubKind = METAHUB_KIND_MAP[kind];
  if (!metahubKind) return null;
  return metahubUrl(metahubKind, imdbId);
}

export interface ApplyArtworkOverridesOptions {
  checkExistence?: boolean;
}

export async function applyArtworkOverrides(
  context: ArtworkContext,
  nativeUrls: NativeArtworkUrls,
  artworkOptions: ArtworkOptions | null | undefined,
  options?: ApplyArtworkOverridesOptions
): Promise<ResolvedArtwork> {
  const shouldCheck = options?.checkExistence ?? false;
  const kinds: ArtworkKind[] = ['poster', 'backdrop', 'logo', 'landscape', 'episode'];

  const result: ResolvedArtwork = {
    poster: null,
    backdrop: null,
    logo: null,
    landscape: null,
    episode: null,
  };

  const effectiveContext: ArtworkContext = {
    ...context,
    englishArtOnly:
      context.englishArtOnly !== undefined
        ? context.englishArtOnly
        : Boolean(artworkOptions?.englishArtOnly),
    originalLangFallback:
      context.originalLangFallback !== undefined
        ? context.originalLangFallback
        : (artworkOptions?.originalLangFallback ?? true),
  };

  for (const kind of kinds) {
    const config = artworkOptions?.[kind] ?? null;
    const service = config?.service || 'none';
    let url: string | null = null;

    if (service !== 'none') {
      if (isValidArtworkConfig(config)) {
        let overrideUrl: string | null = null;
        if (service === 'tvdb') {
          if (config?.apiKey) {
            overrideUrl = await resolveTvdbArtworkUrl(effectiveContext, kind, config.apiKey);
          }
        } else if (service === 'fanart') {
          if (config?.apiKey) {
            overrideUrl = await resolveFanartArtworkUrl(effectiveContext, kind, config.apiKey);
          }
        } else {
          overrideUrl = resolveArtworkUrl(effectiveContext, kind, config);
        }
        if (overrideUrl) {
          if (config!.service === 'customUrl') {
            url = overrideUrl;
          } else if (shouldCheck && service !== 'tvdb' && service !== 'fanart') {
            const exists = await checkArtworkExists(overrideUrl);
            if (exists) url = overrideUrl;
          } else {
            url = overrideUrl;
          }
        }
      }

      if (!url && (service === 'imdb' || service === 'tvdb' || service === 'tmdb')) {
        url = getNativePreferredForService(nativeUrls[kind] ?? null, service);
      }

      // IMDb provider: if native IMDb artwork wasn't available, resolve via IMDb ID.
      if (!url && service === 'imdb') {
        url = metahubFallback(kind, effectiveContext.imdbId);
      }

      // TMDB provider: if native TMDB wasn't available, resolve from IMDb via Metahub
      if (!url && service === 'tmdb') {
        url = metahubFallback(kind, effectiveContext.imdbId);
      }

      // Fanart provider: if no fanart asset exists (or request fails), keep native artwork
      // to avoid blank posters/cards, then fallback to metahub when IMDb ID is available.
      if (!url && service === 'fanart') {
        url = nativeUrls[kind] ?? null;
        if (!url) {
          url = metahubFallback(kind, effectiveContext.imdbId);
        }
      }

      // Explicit provider selection is strict: do not silently fallback to another provider.
      result[kind] = url;
      continue;
    }

    // Default mode ('none'): TMDB-first, then source-native fallback.
    url = metahubFallback(kind, effectiveContext.imdbId);
    if (!url) {
      url = nativeUrls[kind] ?? null;
    }

    result[kind] = url;
  }

  return result;
}

export function applyArtworkOverridesSync(
  context: ArtworkContext,
  nativeUrls: NativeArtworkUrls,
  artworkOptions: ArtworkOptions | null | undefined
): ResolvedArtwork {
  const kinds: ArtworkKind[] = ['poster', 'backdrop', 'logo', 'landscape', 'episode'];

  const result: ResolvedArtwork = {
    poster: null,
    backdrop: null,
    logo: null,
    landscape: null,
    episode: null,
  };

  const effectiveContext: ArtworkContext = {
    ...context,
    englishArtOnly:
      context.englishArtOnly !== undefined
        ? context.englishArtOnly
        : Boolean(artworkOptions?.englishArtOnly),
    originalLangFallback:
      context.originalLangFallback !== undefined
        ? context.originalLangFallback
        : (artworkOptions?.originalLangFallback ?? true),
  };

  for (const kind of kinds) {
    const config = artworkOptions?.[kind] ?? null;
    const service = config?.service || 'none';
    let url: string | null = null;

    if (service !== 'none') {
      if (isValidArtworkConfig(config)) {
        const overrideUrl = resolveArtworkUrl(effectiveContext, kind, config);
        if (overrideUrl) url = overrideUrl;
      }

      if (!url && (service === 'imdb' || service === 'tvdb' || service === 'tmdb')) {
        url = getNativePreferredForService(nativeUrls[kind] ?? null, service);
      }

      // IMDb provider: if native IMDb artwork wasn't available, resolve via IMDb ID.
      if (!url && service === 'imdb') {
        url = metahubFallback(kind, effectiveContext.imdbId);
      }

      // TMDB provider: if native TMDB wasn't available, resolve from IMDb via Metahub
      if (!url && service === 'tmdb') {
        url = metahubFallback(kind, effectiveContext.imdbId);
      }

      // Fanart provider: keep native artwork when fanart does not resolve.
      if (!url && service === 'fanart') {
        url = nativeUrls[kind] ?? null;
        if (!url) {
          url = metahubFallback(kind, effectiveContext.imdbId);
        }
      }

      // Explicit provider selection is strict: do not silently fallback to another provider.
      result[kind] = url;
      continue;
    }

    // Default mode ('none'): TMDB-first, then source-native fallback.
    url = metahubFallback(kind, effectiveContext.imdbId);
    if (!url) {
      url = nativeUrls[kind] ?? null;
    }

    result[kind] = url;
  }

  return result;
}

// --- Legacy format detection & migration ---

const ART_KINDS: ArtKind[] = ['poster', 'backdrop', 'logo', 'landscape', 'episode'];
const ART_CONTENT_TYPES: ArtContentType[] = ['movie', 'series', 'anime'];

function isLegacyArtwork(artwork: unknown): artwork is Record<string, ArtworkSourceConfig> {
  if (!artwork || typeof artwork !== 'object') return false;
  const keys = Object.keys(artwork);
  // Legacy format has art-kind keys; new format has content-type keys
  return keys.some((k) => ART_KINDS.includes(k as ArtKind));
}

function migrateLegacyArtwork(legacy: Record<string, ArtworkSourceConfig>): ArtworkSettings {
  const contentTypeConfig: ContentTypeArtwork = {};
  for (const kind of ART_KINDS) {
    if (legacy[kind]) {
      contentTypeConfig[kind] = legacy[kind];
    }
  }
  // Apply same config to all content types
  return {
    movie: { ...contentTypeConfig },
    series: { ...contentTypeConfig },
    anime: { ...contentTypeConfig },
  };
}

function resolveArtworkSettings(
  artwork: ArtworkSettings | Record<string, ArtworkSourceConfig> | null | undefined
): ArtworkSettings | null {
  if (!artwork) return null;
  if (isLegacyArtwork(artwork)) return migrateLegacyArtwork(artwork);
  return artwork as ArtworkSettings;
}

function getContentTypeConfig(
  settings: ArtworkSettings,
  contentType: ArtContentType
): ContentTypeArtwork | undefined {
  return settings[contentType];
}

export function resolveContentType(type: ContentType, source?: string): ArtContentType {
  if (type === 'anime') return 'anime';
  if (source && ['anilist', 'mal', 'kitsu'].includes(source)) return 'anime';
  if (type === 'series') return 'series';
  return 'movie';
}

// --- createArtworkOptions (content-type-aware) ---

export function createArtworkOptions(
  preferences:
    | {
        artwork?: ArtworkSettings | Record<string, ArtworkSourceConfig>;
        apiKeysEncrypted?: Record<string, string>;
      }
    | null
    | undefined,
  decryptFn: (encrypted: string) => string | null,
  contentType?: ArtContentType
): ArtworkOptions {
  const artworkKinds: ArtKind[] = ART_KINDS;
  const result: ArtworkOptions = {
    poster: null,
    backdrop: null,
    logo: null,
    landscape: null,
    episode: null,
  };

  if (!preferences?.artwork) return result;

  const settings = resolveArtworkSettings(preferences.artwork);
  if (!settings) return result;

  result.englishArtOnly = Boolean(settings.englishArtOnly);
  result.originalLangFallback = settings.originalLangFallback ?? true;

  // Get config for the requested content type (default to movie)
  const ctConfig = getContentTypeConfig(settings, contentType || 'movie');
  if (!ctConfig) return result;

  for (const kind of artworkKinds) {
    const config = ctConfig[kind];
    if (!config) continue;

    const service = (config.provider || 'none') as PosterServiceType;
    if (service === 'none') continue;

    const customUrlPattern =
      typeof config.customUrlPattern === 'string' ? config.customUrlPattern.trim() : undefined;

    if (service === 'customUrl') {
      if (!customUrlPattern) continue;
      result[kind] = { service, customUrlPattern };
      continue;
    }

    // Providers with no API key requirement
    if (service === 'tmdb' || service === 'imdb' || service === ('metahub' as PosterServiceType)) {
      result[kind] = {
        service:
          service === ('metahub' as PosterServiceType) ? ('tmdb' as PosterServiceType) : service,
      };
      continue;
    }

    // Use global encrypted key if available, fallback to legacy nested encrypted key
    const encryptedKey = preferences?.apiKeysEncrypted?.[service] || config.apiKeyEncrypted;
    let apiKey = encryptedKey ? decryptFn(encryptedKey) : null;

    // Built-in defaults when user key is not provided
    if (!apiKey && service === 'rpdb') {
      apiKey = appConfig.rpdb.apiKey || 't0-free-rpdb';
    }
    if (!apiKey && service === 'topPosters') {
      apiKey = appConfig.topPosters.apiKey || null;
    }
    if (!apiKey && service === 'fanart') {
      apiKey = appConfig.fanart.apiKey || null;
    }

    if (!apiKey) continue;

    result[kind] = { service, apiKey, customUrlPattern };
  }

  return result;
}

// --- createArtworkOptionsMap (returns all content types at once) ---

export function createArtworkOptionsMap(
  preferences:
    | {
        artwork?: ArtworkSettings | Record<string, ArtworkSourceConfig>;
        apiKeysEncrypted?: Record<string, string>;
      }
    | null
    | undefined,
  decryptFn: (encrypted: string) => string | null
): ArtworkOptionsMap {
  const settings = resolveArtworkSettings(preferences?.artwork);

  return {
    movie: createArtworkOptions(preferences, decryptFn, 'movie'),
    series: createArtworkOptions(preferences, decryptFn, 'series'),
    anime: createArtworkOptions(preferences, decryptFn, 'anime'),
    englishArtOnly: settings?.englishArtOnly ?? false,
    originalLangFallback: settings?.originalLangFallback ?? true,
  };
}

// --- Resolve artwork options from map by content type ---

export function getArtworkForType(
  optionsMap: ArtworkOptionsMap | null | undefined,
  type: ContentType,
  source?: string
): ArtworkOptions | null {
  if (!optionsMap) return null;
  const ct = resolveContentType(type, source);
  return optionsMap[ct];
}

export function requiresAsyncArtworkResolution(
  artworkOptions: ArtworkOptions | null | undefined
): boolean {
  if (!artworkOptions) return false;
  const kinds: ArtworkKind[] = ['poster', 'backdrop', 'logo', 'landscape', 'episode'];
  return kinds.some(
    (kind) => artworkOptions[kind]?.service === 'tvdb' || artworkOptions[kind]?.service === 'fanart'
  );
}

function inferImdbIdFromMeta(meta: StremioMetaPreview): string | undefined {
  const candidate = meta.imdbId || meta.imdb_id || (meta.id?.startsWith('tt') ? meta.id : null);
  return candidate || undefined;
}

function inferTmdbIdFromMeta(meta: StremioMetaPreview): number | string | undefined {
  if (typeof meta.tmdbId === 'number' && meta.tmdbId > 0) return meta.tmdbId;
  if (typeof meta.tmdbId === 'string' && /^\d+$/.test(meta.tmdbId)) {
    return Number(meta.tmdbId);
  }
  return undefined;
}

interface MetaPreviewOverrideOptions {
  strictPoster?: boolean;
}

export async function applyArtworkOverridesToMetaPreviews(
  metas: StremioMetaPreview[],
  artworkOptions: ArtworkOptions | null | undefined,
  options: MetaPreviewOverrideOptions = {}
): Promise<StremioMetaPreview[]> {
  if (!artworkOptions || !Array.isArray(metas) || metas.length === 0) return metas;
  const strictPoster = Boolean(options.strictPoster);

  if (!requiresAsyncArtworkResolution(artworkOptions)) {
    return metas.map((meta) => {
      const context: ArtworkContext = {
        tmdbId: inferTmdbIdFromMeta(meta),
        imdbId: inferImdbIdFromMeta(meta),
        type: meta.type,
      };

      const nativeUrls: NativeArtworkUrls = {
        poster: meta.poster,
        backdrop: meta.background,
        logo: meta.logo || null,
        landscape: meta.landscapePoster || meta.fanart || meta.background,
      };

      const resolved = applyArtworkOverridesSync(context, nativeUrls, artworkOptions);
      const poster = strictPoster
        ? (resolved.poster ?? null)
        : resolved.poster || meta.poster || null;
      const backdrop = resolved.backdrop || meta.background || null;
      const landscape =
        resolved.landscape ||
        backdrop ||
        meta.landscapePoster ||
        meta.fanart ||
        meta.background ||
        null;

      return {
        ...meta,
        poster,
        background: backdrop,
        fanart: landscape,
        landscapePoster: landscape,
        logo: resolved.logo || meta.logo || undefined,
      };
    });
  }

  return Promise.all(
    metas.map(async (meta) => {
      const context: ArtworkContext = {
        tmdbId: inferTmdbIdFromMeta(meta),
        imdbId: inferImdbIdFromMeta(meta),
        type: meta.type,
      };

      const nativeUrls: NativeArtworkUrls = {
        poster: meta.poster,
        backdrop: meta.background,
        logo: meta.logo || null,
        landscape: meta.landscapePoster || meta.fanart || meta.background,
      };

      const resolved = await applyArtworkOverrides(context, nativeUrls, artworkOptions, {
        checkExistence: false,
      });

      const poster = strictPoster
        ? (resolved.poster ?? null)
        : resolved.poster || meta.poster || null;
      const backdrop = resolved.backdrop || meta.background || null;
      const landscape =
        resolved.landscape ||
        backdrop ||
        meta.landscapePoster ||
        meta.fanart ||
        meta.background ||
        null;

      return {
        ...meta,
        poster,
        background: backdrop,
        fanart: landscape,
        landscapePoster: landscape,
        logo: resolved.logo || meta.logo || undefined,
      };
    })
  );
}

export { checkArtworkExists as checkPosterExists, isValidArtworkConfig as isValidPosterConfig };

export function generatePosterUrl(options: PosterUrlOptions): string | null {
  const context: ArtworkContext = {
    tmdbId: options.tmdbId,
    imdbId: options.imdbId ?? undefined,
    type: options.type,
    language: options.language,
    season: options.season,
    episode: options.episode,
  };
  return resolveArtworkUrl(context, 'poster', options);
}

export function generateBackdropUrl(options: PosterUrlOptions): string | null {
  const context: ArtworkContext = {
    tmdbId: options.tmdbId,
    imdbId: options.imdbId ?? undefined,
    type: options.type,
    language: options.language,
    season: options.season,
    episode: options.episode,
  };
  return resolveArtworkUrl(context, 'backdrop', options);
}

export function generateLogoUrl(options: PosterUrlOptions): string | null {
  const context: ArtworkContext = {
    tmdbId: options.tmdbId,
    imdbId: options.imdbId ?? undefined,
    type: options.type,
    language: options.language,
    season: options.season,
    episode: options.episode,
  };
  return resolveArtworkUrl(context, 'logo', options);
}

export function generateEpisodeThumbnailUrl(options: PosterUrlOptions): string | null {
  const context: ArtworkContext = {
    tmdbId: options.tmdbId,
    imdbId: options.imdbId ?? undefined,
    type: options.type,
    language: options.language,
    season: options.season,
    episode: options.episode,
  };
  return resolveArtworkUrl(context, 'episode', options);
}

export const PosterService = {
  NONE: 'none',
  TMDB: 'tmdb',
  IMDB: 'imdb',
  TVDB: 'tvdb',
  FANART: 'fanart',
  RPDB: 'rpdb',
  TOP_POSTERS: 'topPosters',
  CUSTOM_URL: 'customUrl',
} as const;

export function createPosterOptions(
  preferences:
    | { artwork?: ArtworkSettings | Record<string, ArtworkSourceConfig> }
    | null
    | undefined,
  decryptFn: (encrypted: string) => string | null
): PosterOptions | null {
  return createArtworkOptions(preferences, decryptFn, 'movie').poster;
}
