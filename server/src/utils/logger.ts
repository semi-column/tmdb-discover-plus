import { config } from '../config.ts';
import { getRequestId } from './requestContext.ts';

import type { Logger } from '../types/index.ts';

const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const currentLevel: number = LOG_LEVELS[config.logging.level] ?? LOG_LEVELS.info;
const useJson: boolean = config.logging.format === 'json';

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

function sanitizeValue(value: unknown, key: string = ''): unknown {
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
      stack: config.nodeEnv === 'production' ? '[REDACTED]' : value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeValue(v, k);
    }
    return out;
  }

  return value;
}

const output = (level: string, formatted: string): void => {
  const message = String(formatted);
  if (level === 'error') {
    process.stderr.write(message + '\n');
  } else {
    process.stdout.write(message + '\n');
  }
};

function formatMessage(
  level: string,
  context: string,
  message: string,
  safeData: unknown = null
): string {
  const timestamp = new Date().toISOString();
  const requestId = getRequestId();

  if (useJson) {
    const obj: Record<string, unknown> = { timestamp, level, context, message };
    if (requestId) obj.requestId = requestId;
    if (safeData) obj.data = safeData;
    return JSON.stringify(obj);
  }

  const ridTag = requestId ? ` [${requestId}]` : '';
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]${ridTag}`;
  if (safeData) {
    return `${prefix} ${message} ${JSON.stringify(safeData)}`;
  }
  return `${prefix} ${message}`;
}

export function createLogger(context: string): Logger {
  return {
    debug(message: string, data: Record<string, unknown> | null = null): void {
      if (currentLevel <= LOG_LEVELS.debug) {
        const safeData = data ? sanitizeValue(data) : null;
        output('debug', formatMessage('debug', context, message, safeData));
      }
    },

    info(message: string, data: Record<string, unknown> | null = null): void {
      if (currentLevel <= LOG_LEVELS.info) {
        const safeData = data ? sanitizeValue(data) : null;
        output('info', formatMessage('info', context, message, safeData));
      }
    },

    warn(message: string, data: Record<string, unknown> | null = null): void {
      if (currentLevel <= LOG_LEVELS.warn) {
        const safeData = data ? sanitizeValue(data) : null;
        output('warn', formatMessage('warn', context, message, safeData));
      }
    },

    error(message: string, data: Record<string, unknown> | null = null): void {
      if (currentLevel <= LOG_LEVELS.error) {
        const safeData = data ? sanitizeValue(data) : null;
        output('error', formatMessage('error', context, message, safeData));
      }
    },
  };
}

export const logger: Logger = createLogger('app');
