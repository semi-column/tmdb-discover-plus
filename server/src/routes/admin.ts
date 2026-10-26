import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.ts';
import { ADDON_VERSION } from '../version.ts';
import { createLogger } from '../utils/logger.ts';
import { strictRateLimit } from '../utils/rateLimit.ts';
import { sendError, ErrorCodes } from '../utils/AppError.ts';
import {
  ADMIN_COOKIE,
  adminCredentialSource,
  buildCookie,
  generateTotpSecret,
  isAdminEnabled,
  isIpAllowed,
  issueSession,
  readCookie,
  safeEqualStrings,
  verifyAdminPassword,
  verifySession,
  verifyTotp,
} from '../services/admin/auth.ts';
import { getCollectorStats, getHistory, getLiveStore } from '../services/observability/index.ts';
import {
  INSTANCE_ID,
  getClientIp,
  getColo,
  getCountry,
  hashIdentifier,
} from '../services/observability/identity.ts';
import { liveOverview, liveUpstreams, parseRange } from '../services/observability/liveQueries.ts';
import {
  parseErrorFilter,
  parseRequestFilter,
  type HistoryStore,
} from '../services/observability/history/types.ts';
import type { TailItem } from '../services/observability/types.ts';

const log = createLogger('admin');
const router = Router();

const LOCKOUT_WINDOW_SEC = 15 * 60;
const MAX_FAILS_PER_IP = 5;
const GLOBAL_SLOWDOWN_AFTER = 20;
const GLOBAL_SLOWDOWN_MS = 2000;
const EXPORT_LIMIT = 50_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isSecureRequest(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** Hide the whole admin surface when it isn't configured or the caller isn't allow-listed. */
function gate(req: Request, res: Response, next: NextFunction) {
  if (!isAdminEnabled() || !isIpAllowed(getClientIp(req))) {
    return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // Custom header forces a CORS preflight cross-origin, which our CORS config rejects (CSRF guard).
  if (req.headers['x-admin-request'] !== '1') {
    return sendError(res, 403, ErrorCodes.FORBIDDEN, 'Missing admin request header');
  }
  next();
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req.headers.cookie, ADMIN_COOKIE);
  const session = token ? verifySession(token) : null;
  if (!session) return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Not signed in');
  try {
    const live = await getLiveStore();
    if (await live.hasFlag(`admin:revoked:${session.jti}`)) {
      return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Session ended');
    }
  } catch {
    // Fail closed if we cannot check revocation.
    return sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'Session store unavailable');
  }
  res.locals.adminSession = session;
  next();
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const result = await fn(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (err) {
      log.error('Admin endpoint failed', { path: req.path, error: (err as Error).message });
      if (!res.headersSent) sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Query failed');
    }
  };
}

function requireHistory(res: Response): HistoryStore | null {
  const history = getHistory();
  if (!history) {
    sendError(res, 409, ErrorCodes.VALIDATION_ERROR, 'History is still starting up');
    return null;
  }
  return history;
}

const retention = () => config.observability.retentionDays;

router.use(gate);

// ---------- Auth ----------

router.get('/session', (req, res) => {
  const token = readCookie(req.headers.cookie, ADMIN_COOKIE);
  const session = token ? verifySession(token) : null;
  res.json({
    authenticated: !!session,
    totpRequired: !!config.admin.totpSecret,
  });
});

router.post(
  '/login',
  strictRateLimit,
  handle(async (req, res) => {
    const { username, password, totp } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1024) {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Username and password are required');
    }

    const live = await getLiveStore();
    const ipKey = `admin:fail:ip:${hashIdentifier(getClientIp(req))}`;
    const ipFails = await live.getCount(ipKey);
    if (ipFails >= MAX_FAILS_PER_IP) {
      res.setHeader('Retry-After', String(LOCKOUT_WINDOW_SEC));
      return sendError(
        res,
        429,
        ErrorCodes.FORBIDDEN,
        'Too many failed attempts. Try again later.'
      );
    }
    if ((await live.getCount('admin:fail:global')) >= GLOBAL_SLOWDOWN_AFTER) {
      await sleep(GLOBAL_SLOWDOWN_MS);
    }

    // Always run the password check so timing doesn't reveal whether the username matched.
    const passwordOk = await verifyAdminPassword(password);
    const userOk = safeEqualStrings(username, config.admin.username);
    const totpOk = config.admin.totpSecret
      ? typeof totp === 'string' && verifyTotp(config.admin.totpSecret, totp.trim())
      : true;

    if (!(passwordOk && userOk && totpOk)) {
      const fails = await live.incr(ipKey, LOCKOUT_WINDOW_SEC);
      await live.incr('admin:fail:global', LOCKOUT_WINDOW_SEC);
      log.warn('Admin login failed', { ipHash: hashIdentifier(getClientIp(req)), attempt: fails });
      return sendError(res, 401, ErrorCodes.UNAUTHORIZED, 'Invalid credentials');
    }

    await live.del(ipKey);
    const { token, maxAgeSec } = issueSession();
    res.setHeader('Set-Cookie', buildCookie(token, maxAgeSec, isSecureRequest(req)));
    log.info('Admin signed in', { ipHash: hashIdentifier(getClientIp(req)) });
    return { ok: true, expiresAt: Date.now() + maxAgeSec * 1000 };
  })
);

router.post(
  '/logout',
  handle(async (req, res) => {
    const token = readCookie(req.headers.cookie, ADMIN_COOKIE);
    const session = token ? verifySession(token) : null;
    if (session) {
      const ttl = Math.max(1, session.exp - Math.floor(Date.now() / 1000));
      await (await getLiveStore()).setFlag(`admin:revoked:${session.jti}`, ttl);
    }
    res.setHeader('Set-Cookie', buildCookie('', 0, isSecureRequest(req)));
    return { ok: true };
  })
);

// ---------- Everything below requires a session ----------

router.use(requireAdmin);

router.get(
  '/meta',
  handle(async () => {
    const history = getHistory();
    const live = await getLiveStore();
    return {
      version: ADDON_VERSION,
      instance: INSTANCE_ID,
      liveDriver: live.driver,
      persistence: history?.kind ?? 'none',
      capabilities: {
        // Without Redis, live data and the tail cover this instance only.
        sharedLive: live.driver === 'redis',
        history: history?.kind ?? null,
        approximatePercentiles: history?.approximatePercentiles ?? true,
        cloudflare: config.trustCloudflareHeaders,
        memoryCapacity: history?.kind === 'memory' ? config.observability.memoryEvents : null,
      },
      retentionDays: retention(),
      sampleRate: config.observability.sampleRate,
      slowMs: config.observability.slowMs,
      collector: getCollectorStats(),
      storage: history ? await history.storageInfo() : null,
    };
  })
);

router.get('/security', (req, res) => {
  res.json({
    credentialSource: adminCredentialSource(),
    totpEnabled: !!config.admin.totpSecret,
    allowList: config.admin.allowedIps,
    trustCloudflareHeaders: config.trustCloudflareHeaders,
  });
});

// Generated server-side but never stored: the admin copies it into ADMIN_TOTP_SECRET.
router.post('/security/totp', (req, res) => {
  res.json(generateTotpSecret());
});

router.get(
  '/overview',
  handle(async (req) => {
    const range = parseRange(req.query, retention());
    const live = await getLiveStore();
    const current = await liveOverview(live, range);
    const span = range.to - range.from;
    const previous = await liveOverview(live, {
      ...range,
      from: range.from - span,
      to: range.from,
    });
    return { ...current, previous: previous.totals };
  })
);

router.get(
  '/routes',
  handle(async (req, res) => {
    const history = requireHistory(res);
    if (!history) return;
    return history.routeStats(parseRange(req.query, retention()));
  })
);

router.get(
  '/requests',
  handle(async (req, res) => {
    const history = requireHistory(res);
    if (!history) return;
    const range = parseRange(req.query, retention());
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    return history.listRequests(range, parseRequestFilter(req.query), limit);
  })
);

router.get(
  '/requests/facets',
  handle(async (req, res) => {
    const history = requireHistory(res);
    if (!history) return;
    return history.requestFacets(parseRange(req.query, retention()));
  })
);

router.get(
  '/requests/:requestId',
  handle(async (req, res) => {
    const history = requireHistory(res);
    if (!history) return;
    return history.getTrace(String(req.params.requestId).slice(0, 128));
  })
);

router.get(
  '/errors',
  handle(async (req, res) => {
    const history = requireHistory(res);
    if (!history) return;
    const range = parseRange(req.query, retention());
    const groups = await history.listErrorGroups(range, parseErrorFilter(req.query));
    return { version: ADDON_VERSION, groups };
  })
);

router.get(
  '/errors/:fingerprint',
  handle(async (req, res) => {
    const history = requireHistory(res);
    if (!history) return;
    const result = await history.getErrorGroup(String(req.params.fingerprint).slice(0, 64));
    if (!result) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Error group not found');
    return result;
  })
);

router.patch(
  '/errors/:fingerprint',
  handle(async (req, res) => {
    const history = requireHistory(res);
    if (!history) return;
    const status = (req.body as { status?: unknown })?.status;
    if (typeof status !== 'string') {
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'status is required');
    }
    const ok = await history.setErrorStatus(String(req.params.fingerprint).slice(0, 64), status);
    if (!ok)
      return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid status or unknown group');
    return { ok: true };
  })
);

router.get(
  '/upstreams',
  handle(async (req) => {
    const range = parseRange(req.query, retention());
    const live = await getLiveStore();
    const history = getHistory();
    const provider =
      typeof req.query.provider === 'string' ? req.query.provider.slice(0, 64) : undefined;
    return {
      providers: await liveUpstreams(live, range),
      details: history ? await history.upstreamEndpoints(range, provider) : null,
    };
  })
);

router.get(
  '/usage',
  handle(async (req) => {
    const range = parseRange(req.query, retention());
    const history = getHistory();
    return {
      traffic: history ? await history.usageStats(range) : null,
      business: history ? await history.businessAnalytics() : null,
    };
  })
);

router.get(
  '/system',
  handle(async (req) => {
    const range = parseRange(req.query, retention());
    const history = getHistory();
    const live = await getLiveStore();
    return {
      instances: await live.listInstances(),
      series: history ? await history.systemSeries(range) : null,
    };
  })
);

router.get(
  '/diagnostics',
  handle(async (req) => {
    const pick = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value.join(', ') : (value ?? null);
    };
    return {
      resolved: {
        reqIp: req.ip ?? null,
        reqIps: req.ips,
        clientIpUsed: getClientIp(req),
        country: getCountry(req) || null,
        colo: getColo(req) || null,
        secure: isSecureRequest(req),
        protocol: req.protocol,
      },
      trustProxySetting: config.trustProxy,
      trustCloudflareHeaders: config.trustCloudflareHeaders,
      headers: {
        'cf-connecting-ip': pick('cf-connecting-ip'),
        'cf-ipcountry': pick('cf-ipcountry'),
        'cf-ray': pick('cf-ray'),
        'cf-visitor': pick('cf-visitor'),
        'x-forwarded-for': pick('x-forwarded-for'),
        'x-forwarded-proto': pick('x-forwarded-proto'),
        'x-forwarded-host': pick('x-forwarded-host'),
        'x-real-ip': pick('x-real-ip'),
        via: pick('via'),
        forwarded: pick('forwarded'),
      },
      socketRemoteAddress: req.socket.remoteAddress ?? null,
    };
  })
);

// ---------- Live tail (Server-Sent Events) ----------

router.get('/live', async (req, res) => {
  let closed = false;
  const live = await getLiveStore();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform keeps the compression middleware from buffering the stream.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('backlog', await live.readTail(100).catch(() => [] as TailItem[]));
  const unsubscribe = live.subscribe((items) => send('requests', items));
  const heartbeat = setInterval(() => !closed && res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ---------- Export ----------

function csvCell(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? '');
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

router.get(
  '/export',
  handle(async (req, res) => {
    const history = requireHistory(res);
    if (!history) return;
    const range = parseRange(req.query, retention());
    const kind = req.query.kind === 'errors' ? 'errors' : 'requests';
    const rows =
      kind === 'errors'
        ? await history.listErrorGroups(range, parseErrorFilter(req.query))
        : (await history.listRequests(range, parseRequestFilter(req.query), EXPORT_LIMIT)).rows;
    const filename = `tdp-${kind}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const lines = [columns.join(',')];
    for (const row of rows)
      lines.push(columns.map((c) => csvCell((row as Record<string, unknown>)[c])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(lines.join('\n'));
  })
);

export { router as adminRouter };
