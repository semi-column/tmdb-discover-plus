import { describe, it, expect } from 'vitest';
import { classifyError } from '../../src/services/cache/CacheWrapper.js';

describe('classifyError edge cases', () => {
  it('does not falsely match message containing "5" as a 5xx status pattern', () => {
    const err = new Error('received 5 items');
    const result = classifyError(err, undefined);
    expect(result).not.toBe('RATE_LIMITED');
    expect(result).toBe('TEMPORARY_ERROR');
  });

  it('classifies 500 status as TEMPORARY_ERROR', () => {
    expect(classifyError(new Error('server error'), 500)).toBe('TEMPORARY_ERROR');
  });

  it('classifies message with 503 pattern as TEMPORARY_ERROR', () => {
    expect(classifyError(new Error('upstream 503 unavailable'))).toBe('TEMPORARY_ERROR');
  });

  it('does not classify "timeout after 5000ms" as 5xx', () => {
    const err = new Error('timeout after 5000ms');
    const result = classifyError(err, undefined);
    expect(result).toBe('TEMPORARY_ERROR');
  });

  it('classifies 400 status as PERMANENT_ERROR', () => {
    expect(classifyError(new Error('bad request'), 400)).toBe('PERMANENT_ERROR');
  });
});
