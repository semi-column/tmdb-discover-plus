import { MARKETPLACE_RANKING, MARKETPLACE_PAGINATION } from '../../constants.ts';
import type {
  MarketplaceEntry,
  MarketplaceSearchFacets,
  MarketplaceSort,
} from '../../types/index.ts';

const { W_TEXT, W_FUZZY, W_FACET, W_POP, POP_INSTALLS_WEIGHT, POP_LIKES_WEIGHT } =
  MARKETPLACE_RANKING;
const { DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE } = MARKETPLACE_PAGINATION;

/** Series-typed entries from these sources also match the `anime` facet (legacy alias). */
export const LEGACY_ANIME_SOURCES = ['anilist', 'mal', 'kitsu', 'simkl'] as const;

/** Strips combining marks left over from `normalize('NFKD')` plus control chars. */
const DIACRITIC_AND_CONTROL_RE = new RegExp('[\\p{Mn}\\p{Cc}]', 'gu');

/** Lowercase, strip diacritics + control chars, collapse whitespace. */
export function normalizeText(value: string): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(DIACRITIC_AND_CONTROL_RE, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Classic Levenshtein edit distance with a rolling two-row buffer. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Normalized 0..1 Levenshtein similarity ratio (1 = identical). */
export function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Substring-aware fuzzy similarity between a catalog name and the query, on a
 * 0.00-1.00 scale. A normalized substring match scores 1.0; otherwise the best
 * Levenshtein ratio over a sliding window of the query length is returned, which
 * gives typo tolerance while keeping the single 0.70 inclusion gate meaningful.
 */
export function nameSimilarity(name: string, query: string): number {
  const a = normalizeText(name);
  const b = normalizeText(query);
  if (!a || !b) return 0;
  if (a.includes(b)) return 1;
  if (b.length >= a.length) return levenshteinRatio(a, b);

  let best = 0;
  for (let i = 0; i + b.length <= a.length; i++) {
    const ratio = levenshteinRatio(a.slice(i, i + b.length), b);
    if (ratio > best) best = ratio;
    if (best >= 1) break;
  }
  return best;
}

/**
 * Weighted text relevance over name (highest), tags, genres, and description.
 * Returns a normalized 0..1 value so the name signal always outranks the others.
 */
export function textRelevance(entry: MarketplaceEntry, query: string): number {
  const nq = normalizeText(query);
  if (!nq) return 0;
  const tokens = nq.split(' ').filter(Boolean);

  const fields: Array<{ text: string; weight: number }> = [
    { text: normalizeText(entry.name), weight: 1.0 },
    { text: normalizeText((entry.tags ?? []).join(' ')), weight: 0.5 },
    { text: normalizeText((entry.genres ?? []).join(' ')), weight: 0.4 },
    { text: normalizeText(entry.description ?? ''), weight: 0.3 },
  ];

  let totalWeight = 0;
  let accumulated = 0;
  for (const field of fields) {
    totalWeight += field.weight;
    const phraseHit = field.text.includes(nq) ? 1 : 0;
    const tokenHit = tokens.length
      ? tokens.filter((t) => field.text.includes(t)).length / tokens.length
      : 0;
    accumulated += field.weight * Math.max(phraseHit, tokenHit);
  }
  return totalWeight > 0 ? accumulated / totalWeight : 0;
}

/** Fraction of query tokens overlapping the entry's facet tokens (0..1). */
export function facetOverlap(entry: MarketplaceEntry, query: string): number {
  const nq = normalizeText(query);
  if (!nq) return 0;
  const tokens = nq.split(' ').filter(Boolean);
  if (!tokens.length) return 0;

  const facetText = normalizeText(
    [entry.source, entry.type, ...(entry.genres ?? []), ...(entry.filterFacets ?? [])].join(' ')
  );
  const hits = tokens.filter((t) => facetText.includes(t)).length;
  return hits / tokens.length;
}

/** Log-dampened popularity boost from installs + likes. */
export function popularityBoost(entry: MarketplaceEntry): number {
  const installs = Math.max(0, entry.engagement?.installs ?? 0);
  const likes = Math.max(0, entry.engagement?.likes ?? 0);
  return Math.log10(1 + installs) * POP_INSTALLS_WEIGHT + Math.log10(1 + likes) * POP_LIKES_WEIGHT;
}

/** Composite relevance score per the design's Search & Matching Strategy. */
export function compositeScore(entry: MarketplaceEntry, query: string): number {
  return (
    W_TEXT * textRelevance(entry, query) +
    W_FUZZY * nameSimilarity(entry.name, query) +
    W_FACET * facetOverlap(entry, query) +
    W_POP * popularityBoost(entry)
  );
}

/** Facet match: source allow-list, type (with legacy-anime alias), and genre allow-list. */
export function matchesFacets(entry: MarketplaceEntry, facets?: MarketplaceSearchFacets): boolean {
  if (!facets) return true;
  if (facets.source) {
    const allowedSources = Array.isArray(facets.source) ? facets.source : [facets.source];
    if (!allowedSources.includes(entry.source)) return false;
  }
  if (facets.type) {
    const directMatch = entry.type === facets.type;
    const legacyAnimeMatch =
      facets.type === 'anime' &&
      entry.type === 'series' &&
      (LEGACY_ANIME_SOURCES as readonly string[]).includes(entry.source);
    if (!directMatch && !legacyAnimeMatch) return false;
  }
  if (facets.genres && facets.genres.length) {
    const entryGenres = new Set((entry.genres ?? []).map((g) => normalizeText(g)));
    for (const genre of facets.genres) {
      if (!entryGenres.has(normalizeText(genre))) return false;
    }
  }
  return true;
}

export function resolveSort(sort: MarketplaceSort | undefined, hasQuery: boolean): MarketplaceSort {
  if (sort) return sort;
  return hasQuery ? 'relevance' : 'trending';
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(limit)));
}

export function toTime(value: Date | string | undefined): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Sort matches by the active sort mode with a stable marketplaceId tiebreak. */
export function sortMatches(
  entries: MarketplaceEntry[],
  sort: MarketplaceSort,
  query: string
): MarketplaceEntry[] {
  const scored = entries.map((entry) => ({
    entry,
    score: sort === 'relevance' ? compositeScore(entry, query) : 0,
  }));

  scored.sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case 'relevance':
        cmp = b.score - a.score;
        break;
      case 'popular':
        cmp = b.entry.engagement.likes - a.entry.engagement.likes;
        if (cmp === 0) cmp = b.entry.engagement.installs - a.entry.engagement.installs;
        break;
      case 'most-installed':
        cmp = b.entry.engagement.installs - a.entry.engagement.installs;
        break;
      case 'newest':
        cmp = toTime(b.entry.publishedAt) - toTime(a.entry.publishedAt);
        break;
      case 'trending':
        cmp = b.entry.engagement.trendingScore - a.entry.engagement.trendingScore;
        break;
    }
    if (cmp !== 0) return cmp;
    // Deterministic secondary ordering: marketplaceId ascending.
    if (a.entry.marketplaceId < b.entry.marketplaceId) return -1;
    if (a.entry.marketplaceId > b.entry.marketplaceId) return 1;
    return 0;
  });

  return scored.map((s) => s.entry);
}
