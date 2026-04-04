import { useMemo, useCallback } from 'react';
import { Settings, Calendar, Eye, Sparkles, Layers, Star } from 'lucide-react';
import { FilterSection } from '../../FilterSection';
import { GenreSelector } from '../../GenreSelector';
import { AnimeSeasonSelector } from '../../shared/AnimeSeasonSelector';
import { AnimeFormatSelector } from '../../shared/AnimeFormatSelector';
import { SearchableSelect } from '../../../../forms/SearchableSelect';
import { RangeSlider } from '../../../../forms/RangeSlider';
import { LabelWithTooltip } from '../../../../forms/Tooltip';

import { Checkbox } from '../../../../forms/Checkbox';

const MAL_SEASON_OPTIONS = [
  { value: 'winter', label: 'Winter' },
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'fall', label: 'Fall' },
];

export function MalFilterPanel({
  localCatalog,
  onFiltersChange,
  expandedSections,
  onToggleSection,
  malGenres = [],
  malRankingTypes = [],
  malSortOptions = [],
  malOrderByOptions = [],
  malMediaTypes = [],
  malStatuses = [],
  malRatings = [],
}) {
  const filters = localCatalog?.filters || {};
  const type = localCatalog?.type || 'movie';

  const availableMediaTypes = useMemo(() => {
    if (type === 'movie')
      return malMediaTypes.filter((m) => m.value === 'movie' || m.value === 'special');
    return malMediaTypes.filter((m) => m.value !== 'movie');
  }, [malMediaTypes, type]);

  const availableRankingTypes = useMemo(() => {
    if (type === 'movie')
      return malRankingTypes.filter((r) => !['tv', 'airing', 'upcoming'].includes(r.value));
    return malRankingTypes.filter((r) => r.value !== 'movie');
  }, [malRankingTypes, type]);

  const malGenreObjects = useMemo(
    () => malGenres.map((g) => ({ id: g.id, name: g.name })),
    [malGenres]
  );

  const handleScoreChange = useCallback(
    ([min, max]) => {
      onFiltersChange('malScoreMin', min > 0 ? min : undefined);
      onFiltersChange('malScoreMax', max < 10 ? max : undefined);
    },
    [onFiltersChange]
  );

  const getRankingBadge = () =>
    filters.malRankingType && filters.malRankingType !== 'all' ? 1 : 0;

  const getGenreBadge = () =>
    (filters.malGenres || []).length + (filters.malExcludeGenres || []).length;

  const getSeasonBadge = () => {
    let count = 0;
    if (filters.malSeason) count++;
    if (filters.malSeasonYear) count++;
    if (filters.malSort && filters.malSort !== 'anime_num_list_users') count++;
    return count;
  };

  const getFormatBadge = () => {
    let count = 0;
    if ((filters.malMediaType || []).length > 0) count++;
    if ((filters.malStatus || []).length > 0) count++;
    if (filters.malRating) count++;
    return count;
  };

  const getScoreBadge = () => {
    let count = 0;
    if (filters.malScoreMin) count++;
    if (filters.malScoreMax) count++;
    if (filters.malOrderBy) count++;
    return count;
  };

  const getOptionsBadge = () => (filters.randomize ? 1 : 0);

  const hasAdvancedFilters =
    (filters.malGenres || []).length > 0 ||
    (filters.malExcludeGenres || []).length > 0 ||
    (filters.malStatus || []).length > 0 ||
    (filters.malMediaType || []).length > 0 ||
    filters.malRating ||
    (filters.malScoreMin != null && filters.malScoreMin > 0) ||
    (filters.malScoreMax != null && filters.malScoreMax < 10) ||
    filters.malOrderBy;

  return (
    <>
      {!hasAdvancedFilters && (
        <FilterSection
          id="ranking"
          title="Ranking"
          description="Choose a MAL ranking type"
          icon={Settings}
          isOpen={expandedSections?.ranking !== false}
          onToggle={onToggleSection}
          badgeCount={getRankingBadge()}
        >
          <div className="filter-grid">
            <div className="filter-group">
              <LabelWithTooltip
                label="Ranking Type"
                tooltip="Select from MAL's curated ranking lists. Disabled when using advanced filters (genres, type, status, etc.)."
              />
              <SearchableSelect
                options={availableRankingTypes}
                value={filters.malRankingType || 'all'}
                onChange={(value) => onFiltersChange('malRankingType', value)}
                placeholder="All"
                searchPlaceholder="Search..."
                labelKey="label"
                valueKey="value"
                allowClear={false}
              />
            </div>
          </div>
        </FilterSection>
      )}

      <FilterSection
        id="genres"
        title="Genres"
        description="Select genres to include or exclude"
        icon={Sparkles}
        isOpen={expandedSections?.genres}
        onToggle={onToggleSection}
        badgeCount={getGenreBadge()}
      >
        <GenreSelector
          genres={malGenreObjects}
          selectedGenres={filters.malGenres || []}
          excludedGenres={filters.malExcludeGenres || []}
          genreMatchMode="any"
          onInclude={(genreId) => {
            const current = filters.malGenres || [];
            const excluded = filters.malExcludeGenres || [];
            if (current.includes(genreId)) {
              onFiltersChange(
                'malGenres',
                current.filter((g) => g !== genreId)
              );
            } else if (excluded.includes(genreId)) {
              onFiltersChange(
                'malExcludeGenres',
                excluded.filter((g) => g !== genreId)
              );
            } else {
              onFiltersChange('malGenres', [...current, genreId]);
            }
          }}
          onExclude={(genreId) => {
            const current = filters.malGenres || [];
            const excluded = filters.malExcludeGenres || [];
            if (excluded.includes(genreId)) {
              onFiltersChange(
                'malExcludeGenres',
                excluded.filter((g) => g !== genreId)
              );
            } else {
              onFiltersChange(
                'malGenres',
                current.filter((g) => g !== genreId)
              );
              onFiltersChange('malExcludeGenres', [...excluded, genreId]);
            }
          }}
          onClear={(genreId) => {
            onFiltersChange(
              'malGenres',
              (filters.malGenres || []).filter((g) => g !== genreId)
            );
            onFiltersChange(
              'malExcludeGenres',
              (filters.malExcludeGenres || []).filter((g) => g !== genreId)
            );
          }}
          onSetMatchMode={() => {}}
          showMatchMode={false}
          loading={false}
          onRefresh={() => {}}
        />
        {hasAdvancedFilters && (
          <p className="text-secondary" style={{ fontSize: '11px', marginTop: '6px' }}>
            Using advanced browse mode. Ranking type is ignored.
          </p>
        )}
      </FilterSection>

      <FilterSection
        id="format"
        title="Type & Status"
        description="Media type, airing status, and content rating"
        icon={Layers}
        isOpen={expandedSections?.format}
        onToggle={onToggleSection}
        badgeCount={getFormatBadge()}
      >
        {availableMediaTypes.length > 0 && (
          <div className="filter-group">
            <LabelWithTooltip
              label="Media Type"
              tooltip="Filter by media type: TV, Movie, OVA, ONA, Special, Music."
            />
            <AnimeFormatSelector
              selected={filters.malMediaType || []}
              options={availableMediaTypes}
            />
          </div>
        )}

        {malStatuses.length > 0 && (
          <div className="filter-group">
            <LabelWithTooltip
              label="Status"
              tooltip="Filter by airing status: Airing, Finished, Upcoming."
            />
            <AnimeFormatSelector
              selected={filters.malStatus || []}
              options={malStatuses}
              onChange={(statuses) => onFiltersChange('malStatus', statuses)}
            />
          </div>
        )}

        {malRatings.length > 0 && (
          <div className="filter-group">
            <LabelWithTooltip
              label="Content Rating"
              tooltip="Filter by content rating: G, PG, PG-13, R, R+."
            />
            <SearchableSelect
              options={malRatings}
              value={filters.malRating || ''}
              onChange={(val) => onFiltersChange('malRating', val || undefined)}
              placeholder="Any Rating"
              searchPlaceholder="Search..."
              labelKey="label"
              valueKey="value"
            />
          </div>
        )}
      </FilterSection>

      {type === 'series' && (
        <FilterSection
          id="season"
          title="Season"
          description="Filter by anime season and year"
          icon={Calendar}
          isOpen={expandedSections?.season}
          onToggle={onToggleSection}
          badgeCount={getSeasonBadge()}
        >
          <div className="filter-grid">
            <div className="filter-group">
              <LabelWithTooltip
                label="Seasonal Anime"
                tooltip="Filter by anime season. When a season is selected, ranking and advanced filters are ignored."
              />
              <AnimeSeasonSelector
                season={filters.malSeason}
                year={filters.malSeasonYear}
                onSeasonChange={(val) => onFiltersChange('malSeason', val)}
                onYearChange={(val) => onFiltersChange('malSeasonYear', val)}
                seasonOptions={MAL_SEASON_OPTIONS}
              />
              <p className="text-secondary" style={{ fontSize: '11px', marginTop: '6px' }}>
                When a season is selected, ranking/browse filters are overridden
              </p>
            </div>

            {filters.malSeason && filters.malSeasonYear && (
              <div className="filter-group">
                <LabelWithTooltip label="Sort" tooltip="How to sort seasonal results." />
                <SearchableSelect
                  options={malSortOptions}
                  value={filters.malSort || 'anime_num_list_users'}
                  onChange={(value) => onFiltersChange('malSort', value)}
                  placeholder="Most Listed"
                  searchPlaceholder="Search..."
                  labelKey="label"
                  valueKey="value"
                  allowClear={false}
                />
              </div>
            )}
          </div>
        </FilterSection>
      )}

      <FilterSection
        id="score"
        title="Score & Sorting"
        description="Filter by score range and sort results"
        icon={Star}
        isOpen={expandedSections?.score}
        onToggle={onToggleSection}
        badgeCount={getScoreBadge()}
      >
        <RangeSlider
          label="Score Range"
          min={0}
          max={10}
          step={0.5}
          value={[filters.malScoreMin || 0, filters.malScoreMax || 10]}
          onChange={handleScoreChange}
        />

        <div className="filter-spacer" />

        {malOrderByOptions.length > 0 && (
          <div className="filter-group">
            <LabelWithTooltip
              label="Order By"
              tooltip="How to order browse results. Only applies when using advanced filters."
            />
            <SearchableSelect
              options={malOrderByOptions}
              value={filters.malOrderBy || ''}
              onChange={(val) => onFiltersChange('malOrderBy', val || undefined)}
              placeholder="Score (default)"
              searchPlaceholder="Search..."
              labelKey="label"
              valueKey="value"
            />
          </div>
        )}
      </FilterSection>

      <FilterSection
        id="options"
        title="Options"
        description="Randomization settings"
        icon={Eye}
        isOpen={expandedSections?.options}
        onToggle={onToggleSection}
        badgeCount={getOptionsBadge()}
      >
        <div className="checkbox-grid">
          <Checkbox
            checked={!!filters.randomize}
            onChange={(checked) => onFiltersChange('randomize', checked || undefined)}
            label="Randomize Results"
            tooltip="Fetch a random page from matching results and shuffle them."
          />
        </div>
      </FilterSection>
    </>
  );
}
