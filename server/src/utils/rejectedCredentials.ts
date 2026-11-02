export const REJECTED_CREDENTIAL_TTL_MS = 10 * 60_000;

/**
 * Per-process memory of credentials an upstream rejected (401/403), so a user with a
 * bad key stops spending shared throttle tokens and upstream calls on every request.
 */
export function createRejectedCredentials(ttlMs = REJECTED_CREDENTIAL_TTL_MS, maxSize = 1000) {
  const rejectedAt = new Map<string, number>();
  return {
    has(key: string, now = Date.now()): boolean {
      const ts = rejectedAt.get(key);
      if (ts === undefined) return false;
      if (now - ts < ttlMs) return true;
      rejectedAt.delete(key);
      return false;
    },
    add(key: string, now = Date.now()): void {
      rejectedAt.delete(key);
      if (rejectedAt.size >= maxSize) rejectedAt.delete(rejectedAt.keys().next().value!);
      rejectedAt.set(key, now);
    },
  };
}
