import { CIRCUIT_BREAKER_DEFAULTS } from '../../constants.ts';

export interface CircuitBreakerConfig {
  /** Consecutive failures within `windowMs` before the circuit opens. */
  threshold?: number;
  /** Rolling window (ms) used to count recent failures. */
  windowMs?: number;
  /** How long (ms) the circuit stays open once tripped. */
  cooldownMs?: number;
  /** Called when the circuit transitions to open (e.g. to log a warning). */
  onOpen?: () => void;
}

export interface CircuitBreaker {
  isOpen(): boolean;
  recordFailure(): void;
  recordSuccess(): void;
}

/**
 * Creates an isolated per-provider circuit breaker instance. Each call returns
 * its own closed-over state, so callers must keep one instance per provider
 * rather than sharing a single breaker across providers.
 */
export function createCircuitBreaker(config: CircuitBreakerConfig = {}): CircuitBreaker {
  const threshold = config.threshold ?? CIRCUIT_BREAKER_DEFAULTS.THRESHOLD;
  const windowMs = config.windowMs ?? CIRCUIT_BREAKER_DEFAULTS.WINDOW_MS;
  const cooldownMs = config.cooldownMs ?? CIRCUIT_BREAKER_DEFAULTS.COOLDOWN_MS;

  let failures: number[] = [];
  let openedAt = 0;

  return {
    isOpen(): boolean {
      if (!openedAt) return false;
      return Date.now() - openedAt < cooldownMs;
    },

    recordFailure(): void {
      const now = Date.now();
      failures = failures.filter((t) => now - t < windowMs);
      failures.push(now);
      if (failures.length >= threshold) {
        openedAt = now;
        config.onOpen?.();
      }
    },

    recordSuccess(): void {
      failures = [];
      openedAt = 0;
    },
  };
}
