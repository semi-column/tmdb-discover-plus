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

function redactSecretsInString(str) {
  if (typeof str !== 'string') return str;
  // Redact common credential query params (TMDB uses api_key, others often use apikey/key/token)
  return str
    .replace(/([?&]api_key=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/([?&]apikey=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/([?&]token=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');
}

function sanitizeAny(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSecretsInString(value);
  if (Array.isArray(value)) return value.map(sanitizeAny);
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = sanitizeAny(v);
  }
  return out;
}

/**
 * Format log message
 * @param {string} level - Log level
 * @param {string} context - Context/module name
 * @param {string} message - Log message
 * @param {Object} data - Additional data
 * @returns {string} Formatted message
 */
function formatMessage(level, context, message, data = null) {
  const timestamp = new Date().toISOString();
  
  if (useJson) {
    return JSON.stringify({
      timestamp,
      level,
      context,
      message,
      ...(data && { data }),
    });
  }
  
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]`;
  if (data) {
    // In dev mode, format data nicely but avoid logging sensitive info
    const safeData = sanitizeLogData(data);
    return `${prefix} ${message} ${JSON.stringify(safeData)}`;
  }
  return `${prefix} ${message}`;
}

/**
 * Remove sensitive fields from log data
 * @param {Object} data - Data to sanitize
 * @returns {Object} Sanitized data
 */
function sanitizeLogData(data) {
  if (!data || typeof data !== 'object') return data;
  
  const sensitiveKeys = ['tmdbApiKey', 'apiKey', 'password', 'token', 'secret'];
  const sanitized = { ...data };
  
  for (const key of sensitiveKeys) {
    if (key in sanitized) {
      sanitized[key] = '[REDACTED]';
    }
  }

  // Also redact secrets that might appear inside string values (e.g., node-fetch error URLs).
  return sanitizeAny(sanitized);
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
        console.log(formatMessage('debug', context, message, data));
      }
    },
    
    info(message, data = null) {
      if (currentLevel <= LOG_LEVELS.info) {
        console.log(formatMessage('info', context, message, data));
      }
    },
    
    warn(message, data = null) {
      if (currentLevel <= LOG_LEVELS.warn) {
        console.warn(formatMessage('warn', context, message, data));
      }
    },
    
    error(message, data = null) {
      if (currentLevel <= LOG_LEVELS.error) {
        console.error(formatMessage('error', context, message, data));
      }
    },
  };
}

// Default logger for quick imports
export const logger = createLogger('app');
