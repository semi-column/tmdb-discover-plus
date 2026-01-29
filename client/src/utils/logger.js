const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = import.meta.env.DEV ? LOG_LEVELS.debug : LOG_LEVELS.warn;

class Logger {
  constructor(context = 'App') {
    this.context = context;
  }

  _log(level, message, ...args) {
    if (LOG_LEVELS[level] >= CURRENT_LEVEL) {
      const timestamp = new Date().toLocaleTimeString();
      const prefix = `[${timestamp}] [${this.context}]`;
      
      switch (level) {
        case 'debug':
          console.debug(prefix, message, ...args);
          break;
        case 'info':
          console.info(prefix, message, ...args);
          break;
        case 'warn':
          console.warn(prefix, message, ...args);
          break;
        case 'error':
          console.error(prefix, message, ...args);
          break;
        default:
          console.log(prefix, message, ...args);
      }
    }
  }

  debug(message, ...args) {
    this._log('debug', message, ...args);
  }

  info(message, ...args) {
    this._log('info', message, ...args);
  }

  warn(message, ...args) {
    this._log('warn', message, ...args);
  }

  error(message, ...args) {
    this._log('error', message, ...args);
  }
}

export const createLogger = (context) => new Logger(context);

export const logger = new Logger();
