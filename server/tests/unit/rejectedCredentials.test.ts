import { describe, expect, it } from 'vitest';

import { createRejectedCredentials } from '../../src/utils/rejectedCredentials.ts';

describe('createRejectedCredentials', () => {
  it('remembers a rejected key until the TTL expires', () => {
    const rejected = createRejectedCredentials(1000);
    rejected.add('bad', 0);
    expect(rejected.has('bad', 999)).toBe(true);
    expect(rejected.has('good', 999)).toBe(false);
    expect(rejected.has('bad', 1000)).toBe(false);
  });

  it('evicts the oldest key when full', () => {
    const rejected = createRejectedCredentials(1000, 2);
    rejected.add('a', 0);
    rejected.add('b', 0);
    rejected.add('c', 0);
    expect(rejected.has('a', 1)).toBe(false);
    expect(rejected.has('b', 1)).toBe(true);
    expect(rejected.has('c', 1)).toBe(true);
  });
});
