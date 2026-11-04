import { beforeEach, describe, expect, it, vi } from 'vitest';
import { skipOpportunisticWork, startOpportunisticWork } from '../../src/utils/requestContext.ts';

const { mocks, imdbMocks, flags } = vi.hoisted(() => ({
  flags: { backgroundPriority: true },
  mocks: {
    getGenres: vi.fn(),
    getLanguages: vi.fn(),
    getCountries: vi.fn(),
    getCertifications: vi.fn(),
    getWatchRegions: vi.fn(),
    getWatchProviders: vi.fn(),
    endWarmup: vi.fn(),
  },
  imdbMocks: {
    isImdbApiEnabled: vi.fn(),
    getGenres: vi.fn(),
    getTopRanking: vi.fn(),
    getPopular: vi.fn(),
  },
}));
vi.mock('../../src/config.ts', () => ({
  config: { cache: { warmRegions: [] }, features: flags },
}));
vi.mock('../../src/utils/logger.ts', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../src/services/tmdb/index.ts', () => mocks);
vi.mock('../../src/services/imdb/index.ts', () => imdbMocks);
vi.mock('../../src/infrastructure/tmdbThrottle.ts', () => ({
  getTmdbThrottle: () => ({ endWarmup: mocks.endWarmup }),
}));

import { warmEssentialCaches } from '../../src/infrastructure/cacheWarmer.ts';

beforeEach(() => {
  vi.clearAllMocks();
  flags.backgroundPriority = true;
  for (const fn of Object.values(mocks)) fn.mockResolvedValue(undefined);
  imdbMocks.isImdbApiEnabled.mockReturnValue(false);
  imdbMocks.getGenres.mockResolvedValue(undefined);
  imdbMocks.getTopRanking.mockResolvedValue(undefined);
  imdbMocks.getPopular.mockResolvedValue(undefined);
});

describe('startup warming priority', () => {
  it('warms reference data one task at a time', async () => {
    const gate = Promise.withResolvers<void>();
    mocks.getGenres.mockImplementationOnce(() => gate.promise);
    const warming = warmEssentialCaches('key');
    await vi.waitFor(() => expect(mocks.getGenres).toHaveBeenCalledOnce());
    expect(mocks.getLanguages).not.toHaveBeenCalled();
    gate.resolve();

    expect(await warming).toMatchObject({ warmed: 7, failed: 0, skippedTasks: 0 });
    expect(mocks.endWarmup).toHaveBeenCalledOnce();
  });

  it('restores parallel warming when background priority is disabled', async () => {
    flags.backgroundPriority = false;
    imdbMocks.isImdbApiEnabled.mockReturnValue(true);
    const gate = Promise.withResolvers<void>();
    mocks.getGenres.mockImplementationOnce(() => gate.promise);
    const warming = warmEssentialCaches('key');
    await vi.waitFor(() => expect(mocks.getLanguages).toHaveBeenCalledOnce());
    expect(imdbMocks.getGenres).not.toHaveBeenCalled();
    gate.resolve();
    expect(await warming).toMatchObject({ warmed: 12, failed: 0, skippedTasks: 0 });
    expect(imdbMocks.getGenres).toHaveBeenCalledOnce();
  });

  it('skips warming when background capacity is occupied and still ends warmup', async () => {
    const gate = Promise.withResolvers<void>();
    const first = startOpportunisticWork(() => gate.promise)!;
    const second = startOpportunisticWork(() => gate.promise)!;
    try {
      expect(await warmEssentialCaches('key')).toMatchObject({
        warmed: 0,
        failed: 0,
        skippedTasks: 7,
      });
      expect(mocks.getGenres).not.toHaveBeenCalled();
      expect(mocks.endWarmup).toHaveBeenCalledOnce();
    } finally {
      gate.resolve();
      await Promise.all([first.promise, second.promise]);
    }
  });

  it('continues after a provider skip and distinguishes actual errors', async () => {
    mocks.getGenres
      .mockImplementationOnce(async () => skipOpportunisticWork('provider busy'))
      .mockRejectedValueOnce(new Error('provider failed'));

    expect(await warmEssentialCaches('key')).toMatchObject({
      warmed: 5,
      failed: 1,
      skippedTasks: 1,
    });
    expect(mocks.endWarmup).toHaveBeenCalledOnce();
  });
});
