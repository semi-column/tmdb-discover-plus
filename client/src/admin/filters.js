/**
 * Request filters live in the URL so every view and link shares them. Each dimension has an
 * "is" param (`route=…`) and an "is not" param (`notRoute=a,b`); the server accepts both.
 */
export const DIMENSIONS = [
  { key: 'route', label: 'Route', facet: 'route', mono: true },
  { key: 'status', label: 'Status', options: ['2xx', '3xx', '4xx', '5xx'] },
  {
    key: 'source',
    label: 'Source',
    options: ['tmdb', 'imdb', 'anilist', 'mal', 'kitsu', 'simkl', 'other'],
  },
  { key: 'resource', label: 'Resource', options: ['manifest', 'catalog', 'meta'] },
  {
    key: 'contentType',
    label: 'Content type',
    options: ['movie', 'series', 'anime', 'collection'],
  },
  { key: 'client', label: 'Client', facet: 'client' },
  { key: 'country', label: 'Country', facet: 'country' },
  { key: 'instance', label: 'Instance', facet: 'instance', mono: true },
  { key: 'method', label: 'Method', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] },
];

/** Single-value filters without an "is not" form. */
export const EXTRA_FILTERS = [
  { key: 'minMs', label: 'Duration ≥ (ms)', type: 'number' },
  { key: 'maxMs', label: 'Duration ≤ (ms)', type: 'number' },
  { key: 'minUpstreamCalls', label: 'Upstream calls ≥', type: 'number' },
  { key: 'q', label: 'Path contains' },
  { key: 'userId', label: 'Config ID', placeholder: 'raw ID, hashed server-side' },
  { key: 'userHash', label: 'Config hash' },
  { key: 'requestId', label: 'Request ID' },
  { key: 'errorsOnly', label: 'Errors only (5xx or logged error)', type: 'flag' },
];

export const notKey = (key) => `not${key[0].toUpperCase()}${key.slice(1)}`;

const ALL_KEYS = [
  ...DIMENSIONS.flatMap((d) => [d.key, notKey(d.key)]),
  ...EXTRA_FILTERS.map((f) => f.key),
];

export const splitList = (value) => (value ? value.split(',').filter(Boolean) : []);

/** The filter subset of the URL params, ready to send to the API. */
export function pickFilters(params) {
  return Object.fromEntries(ALL_KEYS.filter((k) => params[k]).map((k) => [k, params[k]]));
}

/** Adds an "is" or "is not" condition; "is" replaces, "is not" accumulates. */
export function addFilter(filters, key, value, exclude = false) {
  const name = notKey(key);
  const values = splitList(filters[name]);
  if (!exclude) {
    const others = values.filter((v) => v !== value);
    return { ...filters, [key]: value, [name]: others.join(',') || undefined };
  }
  return {
    ...filters,
    [key]: filters[key] === value ? undefined : filters[key],
    [name]: values.includes(value) ? filters[name] : [...values, value].join(','),
  };
}
