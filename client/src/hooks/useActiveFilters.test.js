import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveFilters } from './useActiveFilters';

function createDefaultProps(overrides = {}) {
  return {
    localCatalog: { type: 'movie', filters: {} },
    setLocalCatalog: vi.fn(),
    genres: { movie: [], series: [] },
    sortOptions: { movie: [], series: [] },
    originalLanguages: [],
    countries: [],
    tvStatuses: [],
    tvTypes: [],
    watchRegions: [],
    monetizationTypes: [],
    selectedPeople: [],
    setSelectedPeople: vi.fn(),
    selectedCompanies: [],
    setSelectedCompanies: vi.fn(),
    selectedKeywords: [],
    setSelectedKeywords: vi.fn(),
    excludeKeywords: [],
    setExcludeKeywords: vi.fn(),
    excludeCompanies: [],
    setExcludeCompanies: vi.fn(),
    imdbSortOptions: [],
    anilistSortOptions: [],
    anilistFormatOptions: [],
    anilistStatusOptions: [],
    anilistSeasonOptions: [],
    anilistSourceOptions: [],
    anilistCountryOptions: [],
    malRankingTypes: [],
    malSortOptions: [],
    malOrderByOptions: [],
    malMediaTypes: [],
    malStatuses: [],
    malRatings: [],
    simklListTypes: [],
    simklTrendingPeriods: [],
    simklBestFilters: [],
    simklSortOptions: [],
    simklAnimeTypes: [],
    ...overrides,
  };
}

describe('useActiveFilters', () => {
  describe('activeFilters computation', () => {
    it('returns empty array when no filters are set', () => {
      const { result } = renderHook(() => useActiveFilters(createDefaultProps()));
      expect(result.current.activeFilters).toEqual([]);
    });

    it('detects non-default sort', () => {
      const props = createDefaultProps({
        localCatalog: { type: 'movie', filters: { sortBy: 'vote_average.desc' } },
        sortOptions: { movie: [{ value: 'vote_average.desc', label: 'Rating (High)' }] },
      });
      const { result } = renderHook(() => useActiveFilters(props));
      expect(result.current.activeFilters).toHaveLength(1);
      expect(result.current.activeFilters[0].key).toBe('sortBy');
      expect(result.current.activeFilters[0].label).toContain('Rating (High)');
    });

    it('hides TMDB sort chip when sort option is invalid for current type', () => {
      const props = createDefaultProps({
        localCatalog: { type: 'series', filters: { sortBy: 'release_date.asc' } },
        sortOptions: {
          series: [{ value: 'first_air_date.desc', label: 'First Air Date (Newest)' }],
        },
      });

      const { result } = renderHook(() => useActiveFilters(props));
      const sortFilter = result.current.activeFilters.find((f) => f.key === 'sortBy');

      expect(sortFilter).toBeUndefined();
    });

    it('does not flag default sort', () => {
      const props = createDefaultProps({
        localCatalog: { type: 'movie', filters: { sortBy: 'popularity.desc' } },
      });
      const { result } = renderHook(() => useActiveFilters(props));
      expect(result.current.activeFilters).toEqual([]);
    });

    it('maps AniList sort value to dropdown label', () => {
      const props = createDefaultProps({
        localCatalog: {
          source: 'anilist',
          type: 'series',
          filters: { sortBy: 'POPULARITY_DESC' },
        },
        anilistSortOptions: [{ value: 'POPULARITY_DESC', label: 'Popular' }],
      });

      const { result } = renderHook(() => useActiveFilters(props));
      const sortFilter = result.current.activeFilters.find((f) => f.key === 'sortBy');

      expect(sortFilter).toBeDefined();
      expect(sortFilter.label).toBe('Sort: Popular');
      expect(sortFilter.label).not.toContain('POPULARITY_DESC');
    });

    it('maps MAL sort value to dropdown label', () => {
      const props = createDefaultProps({
        localCatalog: {
          source: 'mal',
          type: 'series',
          filters: { malSort: 'anime_score', malSeason: 'spring', malSeasonYear: 2024 },
        },
        malSortOptions: [{ value: 'anime_score', label: 'Top Score' }],
      });

      const { result } = renderHook(() => useActiveFilters(props));
      const sortFilter = result.current.activeFilters.find((f) => f.key === 'malSort');

      expect(sortFilter).toBeDefined();
      expect(sortFilter.label).toBe('Sort: Top Score');
      expect(sortFilter.label).not.toContain('anime_score');
    });

    it('maps Kitsu sort value to friendly label', () => {
      const props = createDefaultProps({
        localCatalog: {
          source: 'kitsu',
          type: 'anime',
          filters: { kitsuListType: 'browse', kitsuSort: '-startDate' },
        },
      });

      const { result } = renderHook(() => useActiveFilters(props));
      const sortFilter = result.current.activeFilters.find((f) => f.key === 'kitsuSort');

      expect(sortFilter).toBeDefined();
      expect(sortFilter.label).toBe('Sort: Newest');
      expect(sortFilter.label).not.toContain('-startDate');
    });

    it('renders Kitsu categories with readable names', () => {
      const props = createDefaultProps({
        localCatalog: {
          source: 'kitsu',
          type: 'anime',
          filters: { kitsuCategories: ['action', 'slice-of-life'] },
        },
      });

      const { result } = renderHook(() => useActiveFilters(props));
      const categoryFilter = result.current.activeFilters.find((f) => f.key === 'kitsuCategories');

      expect(categoryFilter).toBeDefined();
      expect(categoryFilter.label).toContain('Action');
      expect(categoryFilter.label).toContain('Slice of Life');
      expect(categoryFilter.label).not.toBe('Categories: 2');
    });

    it('renders Kitsu excluded categories with readable names', () => {
      const props = createDefaultProps({
        localCatalog: {
          source: 'kitsu',
          type: 'anime',
          filters: { kitsuExcludeCategories: ['romance', 'horror'] },
        },
      });

      const { result } = renderHook(() => useActiveFilters(props));
      const excludedFilter = result.current.activeFilters.find(
        (f) => f.key === 'kitsuExcludeCategories'
      );

      expect(excludedFilter).toBeDefined();
      expect(excludedFilter.label).toContain('Romance');
      expect(excludedFilter.label).toContain('Horror');
    });

    it('maps Kitsu season chip to season section', () => {
      const props = createDefaultProps({
        localCatalog: {
          source: 'kitsu',
          type: 'anime',
          filters: { kitsuSeason: 'winter', kitsuSeasonYear: 2024 },
        },
      });

      const { result } = renderHook(() => useActiveFilters(props));
      const seasonFilter = result.current.activeFilters.find((f) => f.key === 'kitsuSeason');

      expect(seasonFilter).toBeDefined();
      expect(seasonFilter.section).toBe('season');
      expect(seasonFilter.label).toBe('Season: Winter 2024');
    });

    it('detects selected genres', () => {
      const props = createDefaultProps({
        localCatalog: { type: 'movie', filters: { genres: [28, 12] } },
        genres: {
          movie: [
            { id: 28, name: 'Action' },
            { id: 12, name: 'Adventure' },
          ],
        },
      });
      const { result } = renderHook(() => useActiveFilters(props));
      const genreFilter = result.current.activeFilters.find((f) => f.key === 'genres');
      expect(genreFilter).toBeDefined();
      expect(genreFilter.label).toContain('Action');
      expect(genreFilter.label).toContain('Adventure');
    });

    it('truncates genre names with +N', () => {
      const props = createDefaultProps({
        localCatalog: { type: 'movie', filters: { genres: [28, 12, 35] } },
        genres: {
          movie: [
            { id: 28, name: 'Action' },
            { id: 12, name: 'Adventure' },
            { id: 35, name: 'Comedy' },
          ],
        },
      });
      const { result } = renderHook(() => useActiveFilters(props));
      const genreFilter = result.current.activeFilters.find((f) => f.key === 'genres');
      expect(genreFilter.label).toContain('+1');
    });

    it('detects rating filter', () => {
      const props = createDefaultProps({
        localCatalog: { type: 'movie', filters: { ratingMin: 7, ratingMax: 9 } },
      });
      const { result } = renderHook(() => useActiveFilters(props));
      const ratingFilter = result.current.activeFilters.find((f) => f.key === 'rating');
      expect(ratingFilter).toBeDefined();
      expect(ratingFilter.label).toContain('7');
      expect(ratingFilter.label).toContain('9');
    });

    it('detects multiple filters simultaneously', () => {
      const props = createDefaultProps({
        localCatalog: {
          type: 'movie',
          filters: {
            sortBy: 'vote_average.desc',
            genres: [28],
            ratingMin: 5,
            voteCountMin: 1000,
          },
        },
        genres: { movie: [{ id: 28, name: 'Action' }] },
        sortOptions: { movie: [{ value: 'vote_average.desc', label: 'Rating' }] },
      });
      const { result } = renderHook(() => useActiveFilters(props));
      expect(result.current.activeFilters.length).toBeGreaterThanOrEqual(4);
    });

    it('detects selected people', () => {
      const props = createDefaultProps({
        selectedPeople: [{ id: 1, name: 'Tom Hanks' }],
      });
      const { result } = renderHook(() => useActiveFilters(props));
      const peopleFilter = result.current.activeFilters.find((f) => f.key === 'people');
      expect(peopleFilter).toBeDefined();
      expect(peopleFilter.label).toContain('Tom Hanks');
    });

    it('detects watch providers', () => {
      const props = createDefaultProps({
        localCatalog: { type: 'movie', filters: { watchProviders: [8, 337] } },
      });
      const { result } = renderHook(() => useActiveFilters(props));
      const wpFilter = result.current.activeFilters.find((f) => f.key === 'watchProviders');
      expect(wpFilter).toBeDefined();
      expect(wpFilter.label).toContain('2 streaming service');
    });

    it('detects TV-specific filters', () => {
      const props = createDefaultProps({
        localCatalog: {
          type: 'series',
          filters: { tvStatus: '0', tvType: '0' },
        },
        tvStatuses: [{ value: '0', label: 'Returning' }],
        tvTypes: [{ value: '0', label: 'Scripted' }],
      });
      const { result } = renderHook(() => useActiveFilters(props));
      expect(result.current.activeFilters.some((f) => f.key === 'tvStatus')).toBe(true);
      expect(result.current.activeFilters.some((f) => f.key === 'tvType')).toBe(true);
    });

    it('humanizes TV status and type when options are missing', () => {
      const props = createDefaultProps({
        localCatalog: {
          type: 'series',
          filters: { tvStatus: 'returning_series', tvType: 'scripted' },
        },
      });

      const { result } = renderHook(() => useActiveFilters(props));
      const statusChip = result.current.activeFilters.find((f) => f.key === 'tvStatus');
      const typeChip = result.current.activeFilters.find((f) => f.key === 'tvType');

      expect(statusChip?.label).toBe('Status: Returning Series');
      expect(typeChip?.label).toBe('Type: Scripted');
    });

    it('detects option flags', () => {
      const props = createDefaultProps({
        localCatalog: {
          type: 'movie',
          filters: { includeAdult: true, randomize: true },
        },
      });
      const { result } = renderHook(() => useActiveFilters(props));
      expect(result.current.activeFilters.some((f) => f.key === 'includeAdult')).toBe(true);
      expect(result.current.activeFilters.some((f) => f.key === 'randomize')).toBe(true);
    });
  });

  describe('clearFilter', () => {
    it('clears a specific filter', () => {
      const setLocalCatalog = vi.fn();
      const props = createDefaultProps({
        localCatalog: { type: 'movie', filters: { sortBy: 'vote_average.desc' } },
        setLocalCatalog,
      });
      const { result } = renderHook(() => useActiveFilters(props));

      act(() => {
        result.current.clearFilter('sortBy');
      });

      expect(setLocalCatalog).toHaveBeenCalledWith(expect.any(Function));
      const updater = setLocalCatalog.mock.calls[0][0];
      const updated = updater({ filters: { sortBy: 'vote_average.desc' } });
      expect(updated.filters.sortBy).toBe('popularity.desc');
    });

    it('resets AniList sort to AniList default', () => {
      const setLocalCatalog = vi.fn();
      const props = createDefaultProps({
        localCatalog: {
          source: 'anilist',
          type: 'series',
          filters: { sortBy: 'POPULARITY_DESC' },
        },
        setLocalCatalog,
      });
      const { result } = renderHook(() => useActiveFilters(props));

      act(() => {
        result.current.clearFilter('sortBy');
      });

      expect(setLocalCatalog).toHaveBeenCalledWith(expect.any(Function));
      const updater = setLocalCatalog.mock.calls[0][0];
      const updated = updater({ filters: { sortBy: 'POPULARITY_DESC' } });
      expect(updated.filters.sortBy).toBe('TRENDING_DESC');
    });

    it('clears people by calling setSelectedPeople', () => {
      const setSelectedPeople = vi.fn();
      const props = createDefaultProps({
        selectedPeople: [{ id: 1, name: 'Test' }],
        setSelectedPeople,
      });
      const { result } = renderHook(() => useActiveFilters(props));

      act(() => {
        result.current.clearFilter('people');
      });

      expect(setSelectedPeople).toHaveBeenCalledWith([]);
    });

    it('clears Kitsu sort to default', () => {
      const setLocalCatalog = vi.fn();
      const props = createDefaultProps({
        localCatalog: {
          source: 'kitsu',
          type: 'anime',
          filters: { kitsuSort: '-startDate' },
        },
        setLocalCatalog,
      });
      const { result } = renderHook(() => useActiveFilters(props));

      act(() => {
        result.current.clearFilter('kitsuSort');
      });

      const updater = setLocalCatalog.mock.calls[0][0];
      const updated = updater({ filters: { kitsuSort: '-startDate' } });
      expect(updated.filters.kitsuSort).toBe('-averageRating');
    });

    it('clears Kitsu excluded categories', () => {
      const setLocalCatalog = vi.fn();
      const props = createDefaultProps({
        localCatalog: {
          source: 'kitsu',
          type: 'anime',
          filters: { kitsuExcludeCategories: ['romance'] },
        },
        setLocalCatalog,
      });
      const { result } = renderHook(() => useActiveFilters(props));

      act(() => {
        result.current.clearFilter('kitsuExcludeCategories');
      });

      const updater = setLocalCatalog.mock.calls[0][0];
      const updated = updater({ filters: { kitsuExcludeCategories: ['romance'] } });
      expect(updated.filters.kitsuExcludeCategories).toEqual([]);
    });

    it('clears Kitsu season and season year together', () => {
      const setLocalCatalog = vi.fn();
      const props = createDefaultProps({
        localCatalog: {
          source: 'kitsu',
          type: 'anime',
          filters: { kitsuSeason: 'winter', kitsuSeasonYear: 2024 },
        },
        setLocalCatalog,
      });
      const { result } = renderHook(() => useActiveFilters(props));

      act(() => {
        result.current.clearFilter('kitsuSeason');
      });

      const updater = setLocalCatalog.mock.calls[0][0];
      const updated = updater({ filters: { kitsuSeason: 'winter', kitsuSeasonYear: 2024 } });
      expect(updated.filters.kitsuSeason).toBeUndefined();
      expect(updated.filters.kitsuSeasonYear).toBeUndefined();
    });
  });

  describe('clearAllFilters', () => {
    it('resets all filters to defaults', () => {
      const setLocalCatalog = vi.fn();
      const setSelectedPeople = vi.fn();
      const setSelectedCompanies = vi.fn();
      const setSelectedKeywords = vi.fn();
      const setExcludeKeywords = vi.fn();
      const setExcludeCompanies = vi.fn();
      const props = createDefaultProps({
        localCatalog: {
          type: 'movie',
          filters: { sortBy: 'vote_average.desc', genres: [28], ratingMin: 7 },
        },
        setLocalCatalog,
        setSelectedPeople,
        setSelectedCompanies,
        setSelectedKeywords,
        setExcludeKeywords,
        setExcludeCompanies,
      });
      const { result } = renderHook(() => useActiveFilters(props));

      act(() => {
        result.current.clearAllFilters();
      });

      expect(setSelectedPeople).toHaveBeenCalledWith([]);
      expect(setSelectedCompanies).toHaveBeenCalledWith([]);
      expect(setSelectedKeywords).toHaveBeenCalledWith([]);
      expect(setExcludeKeywords).toHaveBeenCalledWith([]);
      expect(setExcludeCompanies).toHaveBeenCalledWith([]);

      const updater = setLocalCatalog.mock.calls[0][0];
      const updated = updater({ filters: { genres: [28] } });
      expect(updated.filters.sortBy).toBe('popularity.desc');
      expect(updated.filters.genres).toEqual([]);
    });
  });
});
