import {
  ADMISSION_PREFIX,
  AdmissionRedis,
  admissionAwait,
  admissionDelay,
  getAdmissionRedis,
} from './sharedAdmission.ts';
import { TIMEOUTS } from '../constants.ts';
import {
  getRequestRemainingMs,
  getRequestSignal,
  isOpportunisticWork,
  skipOpportunisticWork,
} from '../utils/requestContext.ts';

const INTERVAL_MS = 2100;
const MAX_QUEUE = 100;
export const ANILIST_BUDGET_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + tonumber(t[2]) / 1000
local next = tonumber(redis.call('GET', KEYS[1])) or 0
if ARGV[1] == 'pause' then
  next = math.max(next, now + tonumber(ARGV[2]))
  redis.call('SET', KEYS[1], next, 'PX', math.ceil(math.max(1, next - now)))
  return math.ceil(math.max(0, next - now))
end
if next > now then return math.ceil(next - now) end
redis.call('SET', KEYS[1], now + tonumber(ARGV[2]), 'PX', ARGV[2])
return 0
`;

/** No accumulated burst: every replica and every retry shares the same next-attempt time. */
export class AnilistThrottle {
  private redis?: AdmissionRedis;
  private next = 0;
  private queued = 0;
  private controller = new AbortController();

  constructor(redis?: AdmissionRedis) {
    this.redis = redis;
  }

  async pause(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.next = Math.max(this.next, Date.now() + ms);
    if (this.redis) {
      await this.redis.eval(
        ANILIST_BUDGET_SCRIPT,
        [`${ADMISSION_PREFIX}anilist`],
        ['pause', String(Math.ceil(ms))]
      );
    }
  }

  async acquire(requestSignal = getRequestSignal()): Promise<void> {
    const opportunistic = isOpportunisticWork();
    const signal = AbortSignal.any([
      this.controller.signal,
      ...(this.redis ? [this.redis.getSignal()] : []),
      ...(requestSignal ? [requestSignal] : []),
    ]);
    signal.throwIfAborted();
    if (opportunistic && this.queued > 0) {
      skipOpportunisticWork('AniList work is waiting');
    }
    const exhausted = () =>
      Object.assign(new Error('AniList API rate limited'), {
        statusCode: 429,
        rateLimitExhausted: true,
      });
    if (this.queued >= MAX_QUEUE) throw exhausted();
    this.queued++;
    let command: Promise<number> | undefined;
    try {
      for (;;) {
        signal.throwIfAborted();
        const remaining = getRequestRemainingMs(TIMEOUTS.REQUEST_MS);
        if (remaining <= 0) throw exhausted();
        let wait: number;
        if (this.redis) {
          command = this.redis.eval(
            ANILIST_BUDGET_SCRIPT,
            [`${ADMISSION_PREFIX}anilist`],
            ['acquire', String(INTERVAL_MS)]
          );
          wait = await admissionAwait(command, Math.min(remaining, 1000), signal, exhausted());
          command = undefined;
        } else {
          wait = Math.max(0, this.next - Date.now());
          if (!wait) this.next = Date.now() + INTERVAL_MS;
        }
        signal.throwIfAborted();
        if (getRequestRemainingMs(TIMEOUTS.REQUEST_MS) <= 0) throw exhausted();
        if (!wait) return;
        if (opportunistic) skipOpportunisticWork('AniList budget is busy');
        if (wait >= getRequestRemainingMs(TIMEOUTS.REQUEST_MS)) throw exhausted();
        await admissionDelay(Math.min(wait, 250), signal);
      }
    } finally {
      const removeWaiting = () => this.queued--;
      if (command) void command.then(removeWaiting, removeWaiting);
      else removeWaiting();
    }
  }

  destroy(): void {
    this.controller.abort(new Error('AniList admission shutting down'));
  }
}

let instance: AnilistThrottle | undefined;
export function getAnilistThrottle(): AnilistThrottle {
  return (instance ??= new AnilistThrottle(getAdmissionRedis()));
}
export function destroyAnilistThrottle(): void {
  instance?.destroy();
  instance = undefined;
}
