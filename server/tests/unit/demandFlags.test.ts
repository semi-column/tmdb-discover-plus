import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('demand-first rollout controls', () => {
  it('enables both controls by default', async () => {
    vi.stubEnv('DEMAND_FIRST_FETCHING', undefined);
    vi.stubEnv('BACKGROUND_PRIORITY_ENABLED', undefined);
    vi.resetModules();
    const { config } = await import('../../src/config.ts');
    expect(config.features).toMatchObject({ demandFirst: true, backgroundPriority: true });
  });

  it.each([
    ['false', 'true'],
    ['true', 'false'],
    ['false', 'false'],
  ])('supports independent controls (%s, %s)', async (demand, priority) => {
    vi.stubEnv('DEMAND_FIRST_FETCHING', demand);
    vi.stubEnv('BACKGROUND_PRIORITY_ENABLED', priority);
    vi.resetModules();
    const { config } = await import('../../src/config.ts');
    expect(config.features).toMatchObject({
      demandFirst: demand === 'true',
      backgroundPriority: priority === 'true',
    });
  });
});
