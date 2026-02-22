interface CatalogFilters {
  sortBy?: string;
  listType?: string;
  voteCountMin?: number;
  genreMatchMode?: string;
  imdbOnly?: boolean;
  discoverOnly?: boolean;
  [key: string]: unknown;
}

const BASE_KEYS = new Set([
  'sortBy',
  'listType',
  'voteCountMin',
  'genreMatchMode',
  'imdbOnly',
  'discoverOnly',
]);

function isDefaultValue(key: string, value: unknown): boolean {
  if (key === 'sortBy') return value === 'popularity.desc' || !value;
  if (key === 'voteCountMin') return value === 0 || !value;
  if (key === 'genreMatchMode') return value === 'any' || !value;
  if (key === 'listType') return value === 'discover' || !value;
  if (key === 'imdbOnly') return !value;
  if (key === 'discoverOnly') return !value;
  return false;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return value !== 0;
  return true;
}

export function getActiveFilterCount(filters: CatalogFilters | undefined | null): number {
  if (!filters || typeof filters !== 'object') return 0;

  let count = 0;
  for (const [key, value] of Object.entries(filters)) {
    if (BASE_KEYS.has(key) && isDefaultValue(key, value)) continue;
    if (hasValue(value)) count++;
  }
  return count;
}
