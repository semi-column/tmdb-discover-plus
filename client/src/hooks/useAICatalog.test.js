import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAICatalog } from './useAICatalog';

vi.mock('../services/gemini', () => ({
  generateCatalog: vi.fn(),
}));

import { generateCatalog } from '../services/gemini';

describe('useAICatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useAICatalog());
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.isResolving).toBe(false);
    expect(result.current.generatedCatalog).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('generates catalog from prompt', async () => {
    const mockCatalog = {
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: { genres: [28] },
    };
    generateCatalog.mockResolvedValue(mockCatalog);

    const { result } = renderHook(() => useAICatalog());

    let generated;
    await act(async () => {
      generated = await result.current.generateFromPrompt('key', 'action movies');
    });

    expect(generated).toEqual(mockCatalog);
    expect(result.current.generatedCatalog).toEqual(mockCatalog);
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error on generation failure', async () => {
    generateCatalog.mockRejectedValue(new Error('Rate limited'));

    const { result } = renderHook(() => useAICatalog());

    await act(async () => {
      await result.current.generateFromPrompt('key', 'test');
    });

    expect(result.current.error).toBe('Rate limited');
    expect(result.current.generatedCatalog).toBeNull();
  });

  it('resets state correctly', async () => {
    generateCatalog.mockResolvedValue({
      name: 'Test',
      type: 'movie',
      source: 'tmdb',
      filters: {},
    });

    const { result } = renderHook(() => useAICatalog());

    await act(async () => {
      await result.current.generateFromPrompt('key', 'test');
    });

    expect(result.current.generatedCatalog).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.generatedCatalog).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.isResolving).toBe(false);
  });

  it('resolves people entities via search', async () => {
    const { result } = renderHook(() => useAICatalog());

    const mockTmdbApi = {
      searchPerson: vi.fn().mockResolvedValue({
        results: [{ id: 525, name: 'Christopher Nolan', profile_path: '/abc.jpg' }],
      }),
    };

    let resolved;
    await act(async () => {
      resolved = await result.current.resolveEntities(
        { people: ['Christopher Nolan'] },
        mockTmdbApi,
        'US'
      );
    });

    expect(resolved.formState.selectedPeople).toHaveLength(1);
    expect(resolved.formState.selectedPeople[0].id).toBe(525);
    expect(resolved.filters.withPeople).toBe('525');
    expect(resolved.warnings).toHaveLength(0);
  });

  it('handles partial resolution failure gracefully', async () => {
    const { result } = renderHook(() => useAICatalog());

    const mockTmdbApi = {
      searchPerson: vi
        .fn()
        .mockResolvedValueOnce({
          results: [{ id: 525, name: 'Christopher Nolan', profile_path: null }],
        })
        .mockResolvedValueOnce({ results: [] }),
    };

    let resolved;
    await act(async () => {
      resolved = await result.current.resolveEntities(
        { people: ['Christopher Nolan', 'Unknown Person'] },
        mockTmdbApi,
        'US'
      );
    });

    expect(resolved.formState.selectedPeople).toHaveLength(1);
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toContain('Unknown Person');
  });

  it('resolves companies to correct filter format', async () => {
    const { result } = renderHook(() => useAICatalog());

    const mockTmdbApi = {
      searchCompany: vi.fn().mockResolvedValue({
        results: [{ id: 174, name: 'Warner Bros.', logo_path: '/wb.png' }],
      }),
    };

    let resolved;
    await act(async () => {
      resolved = await result.current.resolveEntities(
        { companies: ['Warner Bros'] },
        mockTmdbApi,
        'US'
      );
    });

    expect(resolved.filters.withCompanies).toBe('174');
    expect(resolved.formState.selectedCompanies[0].name).toBe('Warner Bros.');
  });

  it('resolves keywords to correct filter format', async () => {
    const { result } = renderHook(() => useAICatalog());

    const mockTmdbApi = {
      searchKeyword: vi.fn().mockResolvedValue({
        results: [{ id: 9715, name: 'superhero' }],
      }),
    };

    let resolved;
    await act(async () => {
      resolved = await result.current.resolveEntities(
        { keywords: ['superhero'] },
        mockTmdbApi,
        'US'
      );
    });

    expect(resolved.filters.withKeywords).toBe('9715');
    expect(resolved.formState.selectedKeywords[0].name).toBe('superhero');
  });

  it('resolves networks with pipe separator', async () => {
    const { result } = renderHook(() => useAICatalog());

    const mockTmdbApi = {
      searchTVNetworks: vi
        .fn()
        .mockResolvedValueOnce({ results: [{ id: 213, name: 'Netflix', logo_path: null }] })
        .mockResolvedValueOnce({ results: [{ id: 1024, name: 'Amazon', logo_path: null }] }),
    };

    let resolved;
    await act(async () => {
      resolved = await result.current.resolveEntities(
        { networks: ['Netflix', 'Amazon'] },
        mockTmdbApi,
        'US'
      );
    });

    expect(resolved.filters.withNetworks).toBe('213|1024');
  });

  it('resolves watch providers and sets region', async () => {
    const { result } = renderHook(() => useAICatalog());

    const mockTmdbApi = {
      getWatchProviders: vi.fn().mockResolvedValue({
        results: [
          { provider_id: 8, provider_name: 'Netflix' },
          { provider_id: 337, provider_name: 'Disney Plus' },
        ],
      }),
    };

    let resolved;
    await act(async () => {
      resolved = await result.current.resolveEntities(
        { watchProviders: ['Netflix'] },
        mockTmdbApi,
        'US'
      );
    });

    expect(resolved.filters.watchProviders).toEqual([8]);
    expect(resolved.filters.watchRegion).toBe('US');
  });

  it('returns empty result when no entities to resolve', async () => {
    const { result } = renderHook(() => useAICatalog());

    let resolved;
    await act(async () => {
      resolved = await result.current.resolveEntities(null, {}, 'US');
    });

    expect(resolved).toEqual({ filters: {}, formState: {}, warnings: [] });
  });
});
