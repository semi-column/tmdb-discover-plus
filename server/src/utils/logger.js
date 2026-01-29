/**
 * Simple structured logger for TMDB Discover+
 *
 * Supports log levels: debug, info, warn, error
 * Set LOG_LEVEL env var to control output (default: 'info')
 * Set LOG_FORMAT=json for JSON output (useful for log aggregation)
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;
const useJson = process.env.LOG_FORMAT === 'json';

const SENSITIVE_KEYS = [
  'api_key',
  'apikey',
  'tmdbapikey',
  'password',
  'token',
  'secret',
  'auth',
  'authorization',
  'bearer',
  'key',
  'credential',
  'pass',
  'email',
];

function sanitizeValue(value, key = '') {
  if (value === null || value === undefined) return value;

  const lowerKey = String(key).toLowerCase();
  if (SENSITIVE_KEYS.some((sk) => lowerKey.includes(sk))) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    return value
      .replace(/([?&](?:api_key|apikey|token|key|password|id)=)[^&\s/]+/gi, '$1[REDACTED]')
      .replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, '$1[REDACTED]')
      .replace(/(Basic\s+)[a-zA-Z0-9._-]+/gi, '$1[REDACTED]');
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      stack: '[REDACTED]',
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeValue(v, k);
    }
    return out;
  }

  return value;
}

/**
 * Format log message
 * @param {string} level - Log level
 * @param {string} context - Context/module name
 * @param {string} message - Log message
 * @param {Object} data - Additional data
 * @returns {string} Formatted message
 */
const output = (level, formatted) => {
  const message = String(formatted);
  if (level === 'error') {
    process.stderr.write(message + '\n');
  } else {
    process.stdout.write(message + '\n');
  }
};

/**
 * Format log message
 * @param {string} level - Log level
 * @param {string} context - Context/module name
 * @param {string} message - Log message
 * @param {Object} safeData - Sanity-cleared data
 * @returns {string} Formatted message
 */
function formatMessage(level, context, message, safeData = null) {
  const timestamp = new Date().toISOString();

  if (useJson) {
    return JSON.stringify({
      timestamp,
      level,
      context,
      message,
      ...(safeData && { data: safeData }),
    });
  }

  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]`;
  if (safeData) {
    return `${prefix} ${message} ${JSON.stringify(safeData)}`;
  }
  return `${prefix} ${message}`;
}

/**
 * Create a logger instance for a specific context/module
 * @param {string} context - Module or context name
 * @returns {Object} Logger instance
 */
export function createLogger(context) {
  return {
    debug(message, data = null) {
      if (currentLevel <= LOG_LEVELS.debug) {
        const safeData = data ? sanitizeValue(data) : null;
        output('debug', formatMessage('debug', context, message, safeData));
      }
    },

    info(message, data = null) {
      if (currentLevel <= LOG_LEVELS.info) {
        const safeData = data ? sanitizeValue(data) : null;
        output('info', formatMessage('info', context, message, safeData));
      }
    },

    warn(message, data = null) {
      if (currentLevel <= LOG_LEVELS.warn) {
        const safeData = data ? sanitizeValue(data) : null;
        output('warn', formatMessage('warn', context, message, safeData));
      }
    },

    error(message, data = null) {
      if (currentLevel <= LOG_LEVELS.error) {
        const safeData = data ? sanitizeValue(data) : null;
        output('error', formatMessage('error', context, message, safeData));
      }
    },
  };
}

export const logger = createLogger('app');
