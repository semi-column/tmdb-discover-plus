import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initStorage, getStorage } from './services/storage/index.js';
import { initCache } from './services/cache/index.js';
import { addonRouter } from './routes/addon.js';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { createLogger } from './utils/logger.js';
import { apiRateLimit } from './utils/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const log = createLogger('server');
const PORT = process.env.PORT || 7000;
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const SERVER_VERSION = pkg.version;

let server = null;
let isShuttingDown = false;

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

const clientDistPath = path.join(__dirname, '../../client/dist');

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
// Health Check Endpoint
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

  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: SERVER_VERSION,
    database: dbStatus,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB',
    },
  };

  res.json(health);
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
    await initCache();
    await initStorage();

    server = app.listen(PORT, '0.0.0.0', () => {
      log.info(`TMDB Discover+ running at http://0.0.0.0:${PORT}`);
      log.info(`Configure at http://localhost:${PORT}/configure`);
      log.info(`Health check at http://localhost:${PORT}/health`);
    });
  } catch (error) {
    log.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

start();
