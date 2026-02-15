import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.ts';
import { initStorage, getStorage } from './services/storage/index.js';
import { initCache, getCacheStatus } from './services/cache/index.js';
import { addonRouter } from './routes/addon.js';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { createLogger } from './utils/logger.ts';
import { getBaseUrl } from './utils/helpers.js';
import { apiRateLimit } from './utils/rateLimit.js';
import { monitoringRateLimit } from './utils/rateLimit.js';
import { warmEssentialCaches } from './infrastructure/cacheWarmer.js';
import { getMetrics, destroyMetrics } from './infrastructure/metrics.js';
import { destroyTmdbThrottle, getTmdbThrottle } from './infrastructure/tmdbThrottle.js';
import { getConfigCache } from './infrastructure/configCache.js';
import {
  initImdbRatings,
  getImdbRatingsStats,
  destroyImdbRatings,
} from './services/imdbRatings/index.js';
import { getCircuitBreakerState } from './services/tmdb/client.ts';
import { requestIdMiddleware } from './utils/requestContext.ts';
import { sendError, ErrorCodes, AppError } from './utils/AppError.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const log = createLogger('server');
const PORT = config.port;
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const SERVER_VERSION = pkg.version;

let server = null;
let isShuttingDown = false;

/**
 * Server status — tracks startup state, degradation, and readiness.
 */
const serverStatus = {
  healthy: false,
  degraded: false,
  reason: '',
  startedAt: null,
  cacheWarming: { warmed: 0, failed: 0, skipped: false },
};

const trustProxySetting = config.trustProxy;
const VALID_TRUST_PROXY = /^(\d+|true|false|loopback|linklocal|uniquelocal)$/;
if (
  trustProxySetting &&
  !VALID_TRUST_PROXY.test(trustProxySetting) &&
  !/^[\d.\/,: ]+$/.test(trustProxySetting)
) {
  log.warn('Invalid TRUST_PROXY value, falling back to 1', { value: trustProxySetting });
  app.set('trust proxy', 1);
} else {
  app.set(
    'trust proxy',
    /^\d+$/.test(trustProxySetting) ? parseInt(trustProxySetting, 10) : trustProxySetting
  );
}

const rawOrigins = config.cors.origin;
const allowedOrigins =
  rawOrigins === '*'
    ? ['*']
    : rawOrigins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: config.cors.allowCredentials,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '100kb' }));
app.use(compression({ threshold: 1024 }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://image.tmdb.org https://storage.ko-fi.com data:",
      "font-src 'self'",
      "connect-src 'self' https://api.themoviedb.org",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  next();
});

app.use(requestIdMiddleware());

app.use((req, res, next) => {
  const timeout = 30000;
  req.setTimeout(timeout);
  res.setTimeout(timeout, () => {
    if (!res.headersSent) {
      log.warn('Request timeout', { url: req.originalUrl, method: req.method });
      res.status(504).json({ error: 'Gateway Timeout' });
    }
  });
  next();
});

// Global generic rate limit for all routes
app.use(apiRateLimit);

// Request metrics tracking
const metrics = getMetrics();
metrics.setCacheStatsProvider(() => getCacheStatus());
app.use(metrics.middleware());

const clientDistPath = path.join(__dirname, '../../client/dist');
const distManifest = path.join(clientDistPath, 'manifest.json');
const publicManifest = path.join(__dirname, '../../client/public/manifest.json');

let clientManifestPath = publicManifest;
if (process.env.NODE_ENV === 'production') {
  clientManifestPath = distManifest;
} else if (process.env.NODE_ENV === 'nightly') {
  clientManifestPath = fs.existsSync(distManifest) ? distManifest : publicManifest;
}

log.info('Environment status', {
  port: PORT,
  nodeEnv: config.nodeEnv,
  trustProxy: config.trustProxy,
  hasEncryptionKey: Boolean(process.env.ENCRYPTION_KEY),
  hasJwtSecret: Boolean(process.env.JWT_SECRET),
});

if (process.env.DISABLE_RATE_LIMIT === 'true' && !config.features.disableRateLimit) {
  log.warn('DISABLE_RATE_LIMIT is set but ignored outside development/test environments');
}

log.info('Client dist status', {
  path: clientDistPath,
  exists: fs.existsSync(clientDistPath),
});

app.get(['/configure', '/configure/:userId'], (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  const { userId } = req.params;
  if (userId) {
    return res.redirect(302, `/?userId=${encodeURIComponent(userId)}`);
  }
  return res.redirect(302, '/');
});

app.get('/:userId/configure', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  const { userId } = req.params;
  if (userId && !userId.includes('.')) {
    return res.redirect(302, `/?userId=${encodeURIComponent(userId)}`);
  }
  return res.status(404).send('Not Found');
});

let _clientManifestParsed = null;

app.get('/manifest.json', (req, res) => {
  try {
    if (!_clientManifestParsed) {
      if (!fs.existsSync(clientManifestPath)) {
        log.warn('Manifest file not found', { path: clientManifestPath });
      }
      const raw = fs.readFileSync(clientManifestPath, 'utf8');
      _clientManifestParsed = JSON.parse(raw);
    }
    const manifest = { ..._clientManifestParsed };
    const baseUrl = config.baseUrl || getBaseUrl(req);
    manifest.logo = `${baseUrl.replace(/\/$/, '')}/logo.png`;
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.json(manifest);
  } catch (error) {
    log.warn('Failed to serve manifest.json', { error: error.message });
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to load manifest');
  }
});

app.use(
  express.static(clientDistPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
    },
  })
);

// ============================================
// Fallback Placeholder Images (served from static/)
// ============================================
const staticPath = path.join(__dirname, '../static');
app.use(
  express.static(staticPath, {
    maxAge: '1d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  })
);

app.get('/ready', (req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ ready: false, reason: 'shutting_down' });
  }
  if (!serverStatus.healthy) {
    return res.status(503).json({ ready: false, reason: 'starting' });
  }
  res.json({ ready: true });
});

// ============================================
// Enhanced Health Check Endpoint
// ============================================
app.get('/health', monitoringRateLimit, (req, res) => {
  // Return 503 if shutting down
  if (isShuttingDown) {
    return res.status(503).json({
      status: 'shutting_down',
      message: 'Server is shutting down',
    });
  }

  let dbStatus = 'disconnected';
  try {
    if (getStorage()) {
      dbStatus = 'connected';
    }
  } catch (e) {
    void e;
  }

  // Determine overall status
  let status = 'ok';
  if (!serverStatus.healthy) status = 'starting';
  else if (serverStatus.degraded) status = 'degraded';

  const cacheStatus = getCacheStatus();
  const metricsData = getMetrics().getSummary();
  const throttleStats = getTmdbThrottle().getStats();
  const configCacheStats = getConfigCache().getStats();

  const health = {
    status,
    degradedReason: serverStatus.degraded ? serverStatus.reason : undefined,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    startedAt: serverStatus.startedAt,
    version: SERVER_VERSION,
    database: dbStatus,
    cache: cacheStatus,
    configCache: configCacheStats,
    tmdbThrottle: throttleStats,
    tmdbCircuitBreaker: getCircuitBreakerState(),
    imdbRatings: getImdbRatingsStats(),
    cacheWarming: serverStatus.cacheWarming,
    metrics: metricsData,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB',
    },
  };

  const httpStatus = status === 'ok' || status === 'degraded' ? 200 : 503;
  res.status(httpStatus).json(health);
});

app.get('/metrics', monitoringRateLimit, (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(getMetrics().toPrometheus());
});

app.use('/api/auth', authRouter);

app.use('/api', apiRouter);

app.use('/', addonRouter);

app.get('*', (req, res) => {
  const indexPath = path.join(clientDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not Found');
  }
});

app.use((err, req, res, next) => {
  log.error('Unhandled error', { error: err.message, stack: err.stack, url: req.url });
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code, err.message);
  }
  sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
});

function gracefulShutdown(signal) {
  log.info(`Received ${signal}, starting graceful shutdown...`);
  isShuttingDown = true;

  const shutdownTimeout = setTimeout(() => {
    log.warn('Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 30000);

  // Cleanup singletons
  destroyTmdbThrottle();
  destroyMetrics();
  destroyImdbRatings().catch(() => {});

  if (server) {
    server.close(async (err) => {
      try {
        const storage = getStorage();
        if (storage) await storage.disconnect();
      } catch (e) {
        log.error('Error disconnecting storage', { error: e.message });
      }

      clearTimeout(shutdownTimeout);
      if (err) {
        log.error('Error during shutdown', { error: err.message });
        process.exit(1);
      }
      log.info('Server closed successfully');
      process.exit(0);
    });
  } else {
    clearTimeout(shutdownTimeout);
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});

async function start() {
  try {
    // ---- Critical initialization ----
    // Cache and storage are critical — if both fail, we can't serve users.
    try {
      await initCache();
    } catch (cacheErr) {
      // Cache failure is degraded, not fatal (memory fallback already handled in initCache)
      log.warn('Cache initialization issue (degraded mode)', { error: cacheErr.message });
      serverStatus.degraded = true;
      serverStatus.reason = 'Cache initialization failed — using memory fallback';
    }

    await initStorage();

    // Mark server as healthy (can serve requests)
    serverStatus.healthy = true;
    serverStatus.startedAt = new Date().toISOString();

    server = app.listen(PORT, '0.0.0.0', () => {
      log.info(`TMDB Discover+ running at http://0.0.0.0:${PORT}`);
      log.info(`Configure at http://localhost:${PORT}/configure`);
      log.info(`Health check at http://localhost:${PORT}/health`);
    });

    // ---- Non-critical initialization (background, fire-and-forget) ----
    // Cache warming runs after server is already listening so it doesn't block startup.
    const defaultApiKey = config.tmdb.apiKey;
    warmEssentialCaches(defaultApiKey)
      .then((result) => {
        serverStatus.cacheWarming = result;
        log.info('Background cache warming finished', result);
      })
      .catch((err) => {
        log.warn('Background cache warming failed (non-critical)', { error: err.message });
      });

    // IMDb ratings dataset — download in background, non-blocking.
    initImdbRatings()
      .then(() => {
        log.info('IMDb ratings initialized', getImdbRatingsStats());
      })
      .catch((err) => {
        log.warn('IMDb ratings initialization failed (non-critical)', { error: err.message });
      });
  } catch (error) {
    log.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

start();
