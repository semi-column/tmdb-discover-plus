import diagnosticsChannel from 'node:diagnostics_channel';
import { config } from '../../config.ts';
import { getRequestLiveState, type RequestObsState } from '../../utils/requestContext.ts';
import { INSTANCE_ID } from './identity.ts';
import type { UpstreamEvent } from './types.ts';

interface UndiciRequest {
  origin?: string | URL;
  method?: string;
  path?: string;
}

interface Pending {
  started: number;
  ts: number;
  requestId: string;
  obs: RequestObsState | undefined;
}

const HOST_PROVIDERS: Array<[RegExp, string]> = [
  [/^api\.themoviedb\.org$/, 'tmdb'],
  [/(^|\.)themoviedb\.org$/, 'tmdb-web'],
  [/^graphql\.anilist\.co$/, 'anilist'],
  [/^api\.jikan\.moe$/, 'jikan'],
  [/(^|\.)myanimelist\.net$/, 'mal'],
  [/(^|\.)kitsu\.(io|app)$/, 'kitsu'],
  [/(^|\.)simkl\.(com|in)$/, 'simkl'],
  [/(^|\.)ratingposterdb\.com$/, 'rpdb'],
  [/(^|\.)fanart\.tv$/, 'fanart'],
  [/(^|\.)thetvdb\.com$/, 'tvdb'],
  [/(^|\.)openstreetmap\.org$/, 'geo'],
  [/(^|\.)imdb\.com$/, 'imdb-web'],
  [/(^|\.)github(usercontent)?\.com$/, 'github'],
];

export function providerForHost(host: string): string {
  const imdbHost = config.imdbApi.apiHost
    ?.replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
  if (imdbHost && host === imdbHost) return 'imdb';
  for (const [pattern, name] of HOST_PROVIDERS) if (pattern.test(host)) return name;
  return host || 'unknown';
}

export function templateUpstreamPath(rawPath: string): string {
  const pathname = rawPath.split('?')[0];
  return (
    pathname
      .split('/')
      .map((seg, i) => {
        // Keep a leading API version like /3/ (TMDB) intact.
        if (/^\d+$/.test(seg) && !(i === 1 && seg.length <= 2)) return ':id';
        if (/^tt\d+$/.test(seg)) return ':imdbId';
        if (/^[0-9a-f-]{16,}$/i.test(seg)) return ':hash';
        if (seg.length > 40) return ':long';
        return seg;
      })
      .join('/')
      .slice(0, 200) || '/'
  );
}

function hostOf(origin: string | URL | undefined): string {
  if (!origin) return '';
  try {
    return (origin instanceof URL ? origin : new URL(String(origin))).hostname;
  } catch {
    return '';
  }
}

/**
 * Captures every outbound fetch() via undici's diagnostics channels, so no
 * provider client needs changes. Duration is time-to-response-headers.
 */
export function startUpstreamCapture(record: (event: UpstreamEvent) => void): () => void {
  const pending = new WeakMap<object, Pending>();

  const onCreate = (message: unknown) => {
    const { request } = message as { request: UndiciRequest };
    const state = getRequestLiveState();
    pending.set(request, {
      started: performance.now(),
      ts: Date.now(),
      requestId: state?.requestId ?? '',
      obs: state?.obs,
    });
  };

  const finish = (request: UndiciRequest, status: number, error: unknown) => {
    const entry = pending.get(request);
    if (!entry) return;
    pending.delete(request);
    const durationMs = Math.round(performance.now() - entry.started);
    const host = hostOf(request.origin);
    const err = error as { name?: string; message?: string; code?: string } | null;
    const timedOut =
      !!err &&
      (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.code ?? ''));
    if (entry.obs) {
      entry.obs.upstreamCalls++;
      entry.obs.upstreamMs += durationMs;
    }
    record({
      ts: entry.ts,
      requestId: entry.requestId,
      instance: INSTANCE_ID,
      provider: providerForHost(host),
      host,
      method: request.method ?? 'GET',
      path: templateUpstreamPath(request.path ?? ''),
      status,
      durationMs,
      error: err
        ? `${err.name ?? 'Error'}: ${err.message ?? ''}`
            .replace(/([?&](?:api_key|apikey|key|token|client_id)=)[^&\s]+/gi, '$1[REDACTED]')
            .slice(0, 300)
        : '',
      timedOut,
    });
  };

  const onHeaders = (message: unknown) => {
    const { request, response } = message as {
      request: UndiciRequest;
      response: { statusCode: number };
    };
    finish(request, response.statusCode, null);
  };

  const onError = (message: unknown) => {
    const { request, error } = message as { request: UndiciRequest; error: unknown };
    finish(request, 0, error);
  };

  diagnosticsChannel.subscribe('undici:request:create', onCreate);
  diagnosticsChannel.subscribe('undici:request:headers', onHeaders);
  diagnosticsChannel.subscribe('undici:request:error', onError);

  return () => {
    diagnosticsChannel.unsubscribe('undici:request:create', onCreate);
    diagnosticsChannel.unsubscribe('undici:request:headers', onHeaders);
    diagnosticsChannel.unsubscribe('undici:request:error', onError);
  };
}
