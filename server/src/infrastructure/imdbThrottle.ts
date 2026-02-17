import { createLogger } from '../utils/logger.ts';
import { config } from '../config.ts';
import { TokenBucket } from './tmdbThrottle.ts';

const log = createLogger('ImdbThrottle');

let instance: InstanceType<typeof TokenBucket> | null = null;

export function getImdbThrottle(): InstanceType<typeof TokenBucket> {
  if (!instance) {
    const maxTokens = config.imdbApi.rateLimit;
    instance = new TokenBucket({ maxTokens, refillRate: maxTokens, maxQueueSize: 200 });
    log.info('IMDb outbound throttle initialized', { maxTokens });
  }
  return instance;
}

export function destroyImdbThrottle(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
