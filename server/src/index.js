import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initStorage, getStorage } from './services/storage/index.js';
import { initCache, getCacheStatus } from './services/cache/index.js';
import { addonRouter } from './routes/addon.js';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { createLogger } from './utils/logger.js';
import { getBaseUrl } from './utils/helpers.js';
import { apiRateLimit } from './utils/rateLimit.js';
import { warmEssentialCaches } from './services/cacheWarmer.js';
import { getMetrics, destroyMetrics } from './services/metrics.js';
import { destroyTmdbThrottle, getTmdbThrottle } from './services/tmdbThrottle.js';
import { getConfigCache } from './services/configCache.js';
import {
  initImdbRatings,
  getImdbRatingsStats,
  destroyImdbRatings,
} from './services/imdbRatings/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const log = createLogger('server');
const PORT = process.env.PORT || 7000;
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

app.set('trust proxy', true);

const rawOrigins = process.env.CORS_ORIGIN || '*';
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
  credentials: (process.env.CORS_ALLOW_CREDENTIALS || 'false') === 'true',
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// Global generic rate limit for all routes
app.use(apiRateLimit);

// Request metrics tracking
const metrics = getMetrics();
app.use(metrics.middleware());

const clientDistPath = path.join(__dirname, '../../client/dist');
const clientManifestPath =
  process.env.NODE_ENV === 'production'
    ? path.join(clientDistPath, 'manifest.json')
    : path.join(__dirname, '../../client/public/manifest.json');

log.info('Environment status', {
  port: PORT,
  nodeEnv: process.env.NODE_ENV || 'undefined',
  hasEncryptionKey: Boolean(process.env.ENCRYPTION_KEY),
  hasJwtSecret: Boolean(process.env.JWT_SECRET),
});

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

app.get('/manifest.json', (req, res) => {
  try {
    if (!fs.existsSync(clientManifestPath)) {
      log.warn('Manifest file not found', { path: clientManifestPath });
    }
    const raw = fs.readFileSync(clientManifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const baseUrl = process.env.BASE_URL || getBaseUrl(req);
    manifest.logo = `${baseUrl.replace(/\/$/, '')}/logo.png`;
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.json(manifest);
  } catch (error) {
    log.warn('Failed to serve manifest.json', { error: error.message });
    res.status(500).json({ error: 'Failed to load manifest' });
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
// Fallback Placeholder Images
// ============================================
const PLACEHOLDER_POSTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <rect width="300" height="450" fill="#1a1a2e"/>
  <text x="150" y="210" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="40">🎬</text>
  <text x="150" y="260" text-anchor="middle" fill="#444" font-family="sans-serif" font-size="14">No Poster</text>
</svg>`;

const PLACEHOLDER_THUMB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="281" viewBox="0 0 500 281">
  <rect width="500" height="281" fill="#1a1a2e"/>
  <text x="250" y="130" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="36">🎬</text>
  <text x="250" y="170" text-anchor="middle" fill="#444" font-family="sans-serif" font-size="13">No Thumbnail</text>
</svg>`;

app.get('/placeholder-poster.svg', (req, res) => {
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(PLACEHOLDER_POSTER_SVG);
});

app.get('/placeholder-thumbnail.svg', (req, res) => {
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(PLACEHOLDER_THUMB_SVG);
});

// ============================================
// Enhanced Health Check Endpoint
// ============================================
app.get('/health', (req, res) => {
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
  res.status(500).json({ error: 'Internal server error' });
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
    const defaultApiKey = process.env.TMDB_API_KEY;
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
