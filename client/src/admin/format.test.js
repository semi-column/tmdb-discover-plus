import { expect, it } from 'vitest';
import { requestOutcome, upstreamOutcome } from './format.js';

it('distinguishes transport errors, expected lookup misses, and actionable access failures', () => {
  expect(upstreamOutcome(0)).toMatchObject({ tone: 'warn', label: 'Transport failure' });
  expect(upstreamOutcome(404)).toMatchObject({ tone: 'muted', label: 'Not found' });
  expect(upstreamOutcome(401)).toMatchObject({ tone: 'bad', label: 'Access rejected' });
  expect(upstreamOutcome(429).label).toBe('Rate limited');
});

it('does not turn a successful parent response into a failed response or claim recovery', () => {
  const result = requestOutcome({ status: 200 }, [{ status: 0 }, { status: 200 }]);
  expect(result.label).toBe('HTTP succeeded with internal signals');
  expect(result.tone).toBe('warn');
  expect(result.detail).toContain('not confirmed');
  expect(requestOutcome({ status: 503 }).tone).toBe('bad');
  expect(requestOutcome({ status: 200 }).label).toBe('HTTP response completed');
});
