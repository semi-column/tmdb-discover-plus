const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = import.meta.env.DEV ? LOG_LEVELS.debug : LOG_LEVELS.warn;
const CONSOLE_FN = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function log(level, message, ...args) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
  const prefix = `[${new Date().toLocaleTimeString()}] [App]`;
  CONSOLE_FN[level](prefix, message, ...args);
}

export const logger = {
  debug: (message, ...args) => log('debug', message, ...args),
  info: (message, ...args) => log('info', message, ...args),
  warn: (message, ...args) => log('warn', message, ...args),
  error: (message, ...args) => log('error', message, ...args),
};
