import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, isConnected } from './services/database.js';
import { addonRouter } from './routes/addon.js';
import { apiRouter } from './routes/api.js';
import { createLogger } from './utils/logger.js';
import { apiRateLimit } from './utils/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const log = createLogger('server');
const PORT = process.env.PORT || 7000;
const SERVER_VERSION = process.env.npm_package_version || '2.1.0';

// Track server state for graceful shutdown
let server = null;
let isShuttingDown = false;

// Trust proxy for correct host/protocol behind reverse proxy (Beamup/Dokku)
app.set('trust proxy', true);

// Middleware
// Configure CORS. Allows configuration via environment variables:
// - CORS_ORIGIN: comma-separated list of allowed origins, or '*' to allow all (default '*')
// - CORS_ALLOW_CREDENTIALS: 'true' to enable Access-Control-Allow-Credentials (default 'false')
const rawOrigins = process.env.CORS_ORIGIN || '*';
const allowedOrigins = rawOrigins === '*' ? ['*'] : rawOrigins.split(',').map(s => s.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl, Postman, server-to-server)
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
// Respond to preflight for all routes
app.options('*', cors(corsOptions));
app.use(express.json());

// Determine client dist path (works for both local and deployed)
const clientDistPath = path.join(__dirname, '../../client/dist');

// Serve static frontend files
// Redirect legacy /configure routes to the SPA root
// The app now handles configuration at the home route; preserve an optional
// userId by forwarding it as a query parameter so the client can pick it up.
// Serve static frontend files and handle legacy redirects
app.get(['/configure', '/configure/:userId'], (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  const { userId } = req.params;
  if (userId) {
    return res.redirect(302, `/?userId=${encodeURIComponent(userId)}`);
  }
  return res.redirect(302, '/');
});

// Handle legacy /:userId/configure format
app.get('/:userId/configure', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  const { userId } = req.params;
  // Basic validation to avoid capturing static files or other routes
  if (userId && !userId.includes('.')) {
    return res.redirect(302, `/?userId=${encodeURIComponent(userId)}`);
  }
  return res.status(404).send('Not Found');
});

// Serve static files but ensure HTML files are not cached by intermediate CDNs
// or browsers. This avoids stale helper pages (like legacy configure.html)
// being served from caches after a deploy.
app.use(express.static(clientDistPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  }
}));

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

  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: SERVER_VERSION,
    database: isConnected() ? 'connected' : 'disconnected',
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB',
    },
  };

  // Return 200 even if DB is disconnected (addon still works with in-memory)
  res.json(health);
});

// API routes for frontend (rate limiting applied within the API router)
app.use('/api', apiRouter);

// Stremio addon routes (no rate limiting - Stremio needs unrestricted access)
app.use('/', addonRouter);

// ============================================
// Graceful Shutdown Handler
// ============================================
function gracefulShutdown(signal) {
  log.info(`Received ${signal}, starting graceful shutdown...`);
  isShuttingDown = true;

  // Give existing requests time to complete (max 30 seconds)
  const shutdownTimeout = setTimeout(() => {
    log.warn('Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 30000);

  if (server) {
    server.close((err) => {
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

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});

// ============================================
// Server Startup
// ============================================
async function start() {
  try {
    await connectDB();
    // Bind to 0.0.0.0 for Docker/Dokku compatibility
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
