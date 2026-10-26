const KNOWN_SOURCES = new Set(['tmdb', 'imdb', 'anilist', 'mal', 'kitsu', 'simkl']);

const MANIFEST_RE = /^\/([^/]+)\/manifest\.json$/;
const RESOURCE_RE = /^\/([^/]+)\/(catalog|meta)\/([^/]+)\/([^/]+?)(?:\/([^/]+?))?\.json$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RouteInfo {
  route: string;
  path: string;
  resource: string;
  source: string;
  contentType: string;
  catalogId: string;
  userId: string;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function sourceFromCatalogId(catalogId: string): string {
  const prefix = catalogId.split('-')[0];
  return KNOWN_SOURCES.has(prefix) ? prefix : 'tmdb';
}

export function sourceFromMetaId(metaId: string): string {
  if (/^tt\d+/.test(metaId)) return 'imdb';
  const prefix = metaId.split(':')[0];
  return KNOWN_SOURCES.has(prefix) ? prefix : 'other';
}

function genericTemplate(pathname: string): string {
  return (
    pathname
      .split('/')
      .map((seg) => {
        if (!seg) return seg;
        if (/^\d+$/.test(seg)) return ':id';
        if (/^tt\d+$/.test(seg)) return ':imdbId';
        if (UUID_RE.test(seg)) return ':uuid';
        if (seg.length >= 16 && /\d/.test(seg) && /^[\w-]+$/.test(seg)) return ':token';
        return seg;
      })
      .join('/') || '/'
  );
}

/**
 * Turns a concrete path into a low-cardinality route template and masks the
 * user's config id (it acts like a bearer secret in Stremio addon URLs).
 */
export function describePath(pathname: string, expressRoute?: string | null): RouteInfo {
  const empty = { resource: '', source: '', contentType: '', catalogId: '', userId: '' };

  const manifest = MANIFEST_RE.exec(pathname);
  if (manifest && !pathname.startsWith('/api/')) {
    return {
      ...empty,
      route: '/:userId/manifest.json',
      path: '/:user/manifest.json',
      resource: 'manifest',
      userId: safeDecode(manifest[1]),
    };
  }

  const resource = RESOURCE_RE.exec(pathname);
  if (resource && !pathname.startsWith('/api/')) {
    const [, userId, kind, type, id, extra] = resource;
    const decodedId = safeDecode(id);
    const idParam = kind === 'catalog' ? ':catalogId' : ':id';
    return {
      route: `/:userId/${kind}/:type/${idParam}${extra ? '/:extra' : ''}.json`,
      path: `/:user/${kind}/${type}/${id}${extra ? `/${extra}` : ''}.json`.slice(0, 400),
      resource: kind,
      source: kind === 'catalog' ? sourceFromCatalogId(decodedId) : sourceFromMetaId(decodedId),
      contentType: safeDecode(type).slice(0, 32),
      catalogId: kind === 'catalog' ? decodedId.slice(0, 128) : '',
      userId: safeDecode(userId),
    };
  }

  // null = Express matched no route (SPA fallback, scanners); keep those out of per-route stats.
  const route = expressRoute === null ? '(unmatched)' : expressRoute || genericTemplate(pathname);
  return {
    ...empty,
    route: route.slice(0, 200),
    path: maskUserSegments(pathname, expressRoute || genericTemplate(pathname)).slice(0, 400),
  };
}

function maskUserSegments(pathname: string, route: string): string {
  const pathSegs = pathname.split('/');
  const routeSegs = route.split('/');
  if (pathSegs.length !== routeSegs.length) return genericTemplate(pathname);
  return pathSegs.map((seg, i) => (/^:user/i.test(routeSegs[i]) ? ':user' : seg)).join('/');
}
