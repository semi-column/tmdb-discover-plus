import { describe, expect, it } from 'vitest';
import { simklToStremioMeta } from '../../src/services/simkl/stremioMeta.ts';

describe('simklToStremioMeta', () => {
  it('ignores a numeric IMDb ID from the upstream payload', () => {
    const result = simklToStremioMeta({ title: 'Numeric IMDb ID', ids: { imdb: 123 } }, 'anime');

    expect(result).toBeNull();
  });
});
