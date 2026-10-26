import { useMemo } from 'react';
import { Settings, Sparkles, Layers, Eye, Check } from 'lucide-react';
import { FilterSection } from '../../FilterSection';
import { GenreSelector } from '../../GenreSelector';
import { StremioExtras } from '../../StremioExtras';
import { SearchableSelect } from '../../../../forms/SearchableSelect';
import { LabelWithTooltip } from '../../../../forms/Tooltip';
import { AnimeFormatSelector } from '../../shared/AnimeFormatSelector';
import { Checkbox } from '../../../../forms/Checkbox';

export function SimklFilterPanel({
  localCatalog,
  onFiltersChange,
  expandedSections,
  onToggleSection,
  simklGenres = [],
  simklListTypes = [],
  simklTrendingPeriods = [],
  simklBestFilters = [],
  simklAnimeTypes = [],
  simklSortOptions = [],
}) {
  const filters = localCatalog?.filters || {};
  const listType = filters.simklListType || 'trending';

  const simklListTypesFiltered = useMemo(() => {
    if (localCatalog?.type === 'movie') {
      return simklListTypes.filter((t) => t.value !== 'airing');
    }
    return simklListTypes;
  }, [simklListTypes, localCatalog?.type]);

  const simklAnimeTypesFiltered = useMemo(() => {
    if (localCatalog?.type === 'movie') {
      return simklAnimeTypes.filter((t) => t.value === 'movies');
    }
    if (localCatalog?.type === 'anime') {
      return simklAnimeTypes;
    }
    return simklAnimeTypes.filter((t) => t.value !== 'movies');
  }, [simklAnimeTypes, localCatalog?.type]);

  const simklGenreObjects = useMemo(
    () => simklGenres.map((g) => ({ id: g, name: g })),
    [simklGenres]
  );

  const getBrowseBadge = () => {
    let count = 0;
    if (listType !== 'trending') count++;
    if (
      listType === 'trending' &&
      filters.simklTrendingPeriod &&
      filters.simklTrendingPeriod !== 'week'
    )
      count++;
    if (listType === 'best' && filters.simklBestFilter) count++;
    if (listType === 'genre' && filters.simklGenre) count++;
    if (listType === 'genre' && filters.simklSort && filters.simklSort !== 'rank') count++;
    return count;
  };

  const getTypeBadge = () => {
    if (localCatalog?.type === 'movie') return 0;
    return filters.simklType && filters.simklType !== 'all' ? 1 : 0;
  };

  const getOptionsBadge = () =>
    (filters.randomize ? 1 : 0) +
    (filters.includeAdult ? 1 : 0) +
    (filters.excludeUnknownGenres ? 1 : 0);

  return (
    <>
      <FilterSection
        id="browseType"
        title="Browse Type"
        description="Trending, best, by genre, premieres, or airing"
        icon={Settings}
        isOpen={expandedSections?.browseType}
        onToggle={onToggleSection}
        badgeCount={getBrowseBadge()}
      >
        <div className="filter-group">
          <LabelWithTooltip
            label="List Type"
            tooltip="Choose what kind of Simkl list to browse: Trending, Best, By Genre, Premieres, or Airing."
          />
          <AnimeFormatSelector
            selected={[listType]}
            options={simklListTypesFiltered}
            onChange={(vals) => {
              const newType = vals[vals.length - 1] || 'trending';
              onFiltersChange('simklListType', newType);
              if (newType !== 'genre') {
                onFiltersChange('simklGenre', undefined);
              }
            }}
          />
        </div>

        {listType === 'trending' && simklTrendingPeriods.length > 0 && (
          <div className="filter-group">
            <LabelWithTooltip label="Period" tooltip="Time range for trending anime." />
            <AnimeFormatSelector
              selected={[filters.simklTrendingPeriod || 'week']}
              options={simklTrendingPeriods}
              onChange={(vals) => {
                const newPeriod = vals[vals.length - 1] || 'week';
                onFiltersChange('simklTrendingPeriod', newPeriod);
              }}
            />
          </div>
        )}

        {listType === 'best' && simklBestFilters.length > 0 && (
          <div className="filter-group">
            <LabelWithTooltip
              label="Best By"
              tooltip="Filter for best anime by votes, watch count, year, month, or all time."
            />
            <SearchableSelect
              options={simklBestFilters}
              value={filters.simklBestFilter || 'all'}
              onChange={(value) => onFiltersChange('simklBestFilter', value)}
              placeholder="All Time"
              searchPlaceholder="Search..."
              labelKey="label"
              valueKey="value"
              allowClear={false}
            />
          </div>
        )}

        {listType === 'genre' && (
          <>
            <div className="filter-group">
              <LabelWithTooltip label="Genre" tooltip="Select a Simkl genre to browse." />
              <SearchableSelect
                options={simklGenreObjects}
                value={filters.simklGenre || ''}
                onChange={(value) => onFiltersChange('simklGenre', value || undefined)}
                placeholder="Select Genre"
                searchPlaceholder="Search genres..."
                labelKey="name"
                valueKey="id"
              />
            </div>

            {simklSortOptions.length > 0 && (
              <div className="filter-group">
                <LabelWithTooltip label="Sort" tooltip="How to sort genre results." />
                <SearchableSelect
                  options={simklSortOptions}
                  value={filters.simklSort || 'rank'}
                  onChange={(value) => onFiltersChange('simklSort', value)}
                  placeholder="Rank"
                  searchPlaceholder="Search..."
                  labelKey="label"
                  valueKey="value"
                  allowClear={false}
                />
              </div>
            )}
          </>
        )}
      </FilterSection>

      {simklAnimeTypesFiltered.length > 1 && (
        <FilterSection
          id="animeType"
          title="Anime Type"
          description={
            localCatalog?.type === 'series'
              ? 'Filter by anime format: TV, OVA, ONA'
              : 'Filter by anime format: TV, Movie, OVA, ONA'
          }
          icon={Layers}
          isOpen={expandedSections?.animeType}
          onToggle={onToggleSection}
          badgeCount={getTypeBadge()}
        >
          <div className="filter-group">
            <LabelWithTooltip label="Type" tooltip="Filter results by anime type." />
            <AnimeFormatSelector
              selected={[filters.simklType || 'all']}
              options={simklAnimeTypesFiltered}
              onChange={(vals) => {
                const newType = vals[vals.length - 1] || 'all';
                onFiltersChange('simklType', newType);
              }}
            />
          </div>
        </FilterSection>
      )}

      <FilterSection
        id="options"
        title="Options"
        description="Adult content and randomization"
        icon={Eye}
        isOpen={expandedSections?.options}
        onToggle={onToggleSection}
        badgeCount={getOptionsBadge()}
      >
        <div className="checkbox-grid">
          <Checkbox
            checked={!!filters.includeAdult}
            onChange={(checked) => onFiltersChange('includeAdult', checked || undefined)}
            label="Include adult content"
            tooltip="Include adult/18+ anime where available."
          />
          <Checkbox
            checked={!!filters.excludeUnknownGenres}
            onChange={(checked) => onFiltersChange('excludeUnknownGenres', checked || undefined)}
            label="Hide items without genres"
            tooltip="Remove catalog items that have no usable genre metadata."
          />

          <label className="checkbox-label-row" style={{ cursor: 'pointer' }}>
            <div
              className={`checkbox ${filters.randomize ? 'checked' : ''}`}
              role="checkbox"
              aria-checked={!!filters.randomize}
              tabIndex={0}
              onClick={() => onFiltersChange('randomize', !filters.randomize || undefined)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onFiltersChange('randomize', !filters.randomize || undefined);
                }
              }}
            >
              {filters.randomize && <Check size={14} />}
            </div>
            <LabelWithTooltip
              label="Randomize Results"
              tooltip="Fetch a random page from matching results and shuffle them."
            />
          </label>
        </div>
      </FilterSection>

      <FilterSection
        id="extras"
        title="Stremio Extras"
        description="Expose filter dropdowns inside Stremio"
        icon={Layers}
        isOpen={expandedSections?.extras}
        onToggle={onToggleSection}
        badgeCount={(filters.stremioExtras || []).length}
      >
        <StremioExtras
          localCatalog={localCatalog}
          onFiltersChange={onFiltersChange}
          availableModes={['genre']}
        />
      </FilterSection>
    </>
  );
}
