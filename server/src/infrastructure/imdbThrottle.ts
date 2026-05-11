import { createLogger } from '../utils/logger.ts';
import { config } from '../config.ts';
import { TokenBucket } from './tmdbThrottle.ts';

const log = createLogger('ImdbThrottle');

let instance: InstanceType<typeof TokenBucket> | null = null;

export function getImdbThrottle(): InstanceType<typeof TokenBucket> {
  if (!instance) {
    const configuredRateLimit = config.imdbApi.rateLimit;
    const imdbHost = String(config.imdbApi.apiHost || '').toLowerCase();
    const isLocalImdbHost =
      imdbHost.startsWith('localhost') ||
      imdbHost.startsWith('127.0.0.1') ||
      imdbHost.startsWith('0.0.0.0');
    const maxTokens = isLocalImdbHost ? Math.max(configuredRateLimit, 25) : configuredRateLimit;

    instance = new TokenBucket({ maxTokens, refillRate: maxTokens, maxQueueSize: 200 });
    instance.endWarmup();
    log.info('IMDb outbound throttle initialized', {
      maxTokens,
      configuredRateLimit,
      localHostBoosted: isLocalImdbHost && maxTokens > configuredRateLimit,
    });
  }
  return instance;
}

export function destroyImdbThrottle(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
