import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedFetchWithRetry } = vi.hoisted(() => ({
  mockedFetchWithRetry: vi.fn(),
}));

vi.mock('../../src/services/common/fetchWithRetry.ts', () => ({
  fetchWithRetry: mockedFetchWithRetry,
}));

vi.mock('../../src/version.ts', () => ({
  ADDON_VERSION: '9.9.9-test',
}));

import { jikanFetch } from '../../src/services/mal/client.ts';

describe('mal client outbound headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchWithRetry.mockResolvedValue({ data: [] });
  });

  it('uses node-fetch with a user agent and accept header for Jikan', async () => {
    await jikanFetch('/top/anime?page=1');

    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1);
    const [, options] = mockedFetchWithRetry.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];

    expect(options.headers.Accept).toBe('application/json');
    expect(options.headers['User-Agent']).toBe(
      'TMDB-Discover-Plus/9.9.9-test (+https://github.com/semi-column/tmdb-discover-plus)'
    );
  });
});
