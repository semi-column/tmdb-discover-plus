import { useMemo, useCallback } from 'react';
import { Settings, Sparkles, Calendar, Star, Globe, Eye, Check } from 'lucide-react';
import { FilterSection } from '../../FilterSection';
import { GenreSelector } from '../../GenreSelector';
import { AnimeSeasonSelector } from '../../shared/AnimeSeasonSelector';
import { AnimeFormatSelector } from '../../shared/AnimeFormatSelector';
import { SearchableSelect } from '../../../../forms/SearchableSelect';
import { RangeSlider, SingleSlider } from '../../../../forms/RangeSlider';
import { LabelWithTooltip } from '../../../../forms/Tooltip';

export function AnilistFilterPanel({
  localCatalog,
  onFiltersChange,
  expandedSections,
  onToggleSection,
  handleTriStateGenreClick,
  anilistGenres = [],
  anilistSortOptions = [],
  anilistFormatOptions = [],
  anilistStatusOptions = [],
  anilistSeasonOptions = [],
  anilistSourceOptions = [],
  anilistCountryOptions = [],
}) {
  const filters = localCatalog?.filters || {};
  const type = localCatalog?.type || 'movie';

  const anilistGenreObjects = useMemo(
    () => anilistGenres.map((g) => ({ id: g, name: g })),
    [anilistGenres]
  );

  const countrySelectOptions = useMemo(
    () => anilistCountryOptions.map((c) => ({ value: c.value, label: c.label })),
    [anilistCountryOptions]
  );

  const handleScoreChange = useCallback(
    ([min, max]) => {
      onFiltersChange('averageScoreMin', min > 0 ? min : undefined);
      onFiltersChange('averageScoreMax', max < 100 ? max : undefined);
    },
    [onFiltersChange]
  );

  const getSortBadge = () => {
    let count = 0;
    if (filters.sortBy && filters.sortBy !== 'TRENDING_DESC') count++;
    if ((filters.format || []).length > 0) count++;
    if ((filters.status || []).length > 0) count++;
    return count;
  };

  const getGenreBadge = () => (filters.genres || []).length + (filters.excludeGenres || []).length;

  const getSeasonBadge = () => (filters.season ? 1 : 0) + (filters.seasonYear ? 1 : 0);

  const getScoreBadge = () => {
    let count = 0;
    if (filters.averageScoreMin) count++;
    if (filters.averageScoreMax) count++;
    if (filters.popularityMin) count++;
    return count;
  };

  const getOriginBadge = () => {
    let count = 0;
    if (filters.countryOfOrigin) count++;
    if ((filters.sourceMaterial || []).length > 0) count++;
    return count;
  };

  const getOptionsBadge = () => (filters.isAdult ? 1 : 0) + (filters.randomize ? 1 : 0);

  return (
    <>
      <FilterSection
        id="sort"
        title="Sort & Format"
        description="Sort order, format, and airing status"
        icon={Settings}
        isOpen={expandedSections?.sort !== false}
        onToggle={onToggleSection}
        badgeCount={getSortBadge()}
      >
        <div className="filter-group">
          <LabelWithTooltip
            label="Sort By"
            tooltip="How to order your AniList results. Trending shows currently popular titles."
          />
          <SearchableSelect
            options={anilistSortOptions}
            value={filters.sortBy || 'TRENDING_DESC'}
            onChange={(value) => onFiltersChange('sortBy', value)}
            placeholder="Trending"
            searchPlaceholder="Search..."
            labelKey="label"
            valueKey="value"
            allowClear={false}
          />
        </div>

        <div className="filter-group">
          <LabelWithTooltip
            label="Format"
            tooltip="Filter by media format: TV, Movie, OVA, ONA, Special, etc."
          />
          <AnimeFormatSelector
            selected={filters.format || []}
            options={anilistFormatOptions}
            onChange={(formats) => onFiltersChange('format', formats)}
          />
        </div>

        <div className="filter-group">
          <LabelWithTooltip
            label="Status"
            tooltip="Filter by airing status: Releasing, Finished, Not Yet Aired, etc."
          />
          <AnimeFormatSelector
            selected={filters.status || []}
            options={anilistStatusOptions}
            onChange={(statuses) => onFiltersChange('status', statuses)}
          />
        </div>
      </FilterSection>

      <FilterSection
        id="genres"
        title="Genres"
        description="Select genres to include or exclude"
        icon={Sparkles}
        isOpen={expandedSections?.genres !== false}
        onToggle={onToggleSection}
        badgeCount={getGenreBadge()}
      >
        <GenreSelector
          genres={anilistGenreObjects}
          selectedGenres={filters.genres || []}
          excludedGenres={filters.excludeGenres || []}
          genreMatchMode="any"
          onInclude={handleTriStateGenreClick}
          onExclude={handleTriStateGenreClick}
          onClear={handleTriStateGenreClick}
          onSetMatchMode={() => {}}
          showMatchMode={false}
          loading={false}
          onRefresh={() => {}}
        />
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
          <div className="filter-group">
            <LabelWithTooltip
              label="Seasonal Anime"
              tooltip="Filter by the anime season (Winter, Spring, Summer, Fall) and year."
            />
            <AnimeSeasonSelector
              season={filters.season}
              year={filters.seasonYear}
              onSeasonChange={(val) => onFiltersChange('season', val)}
              onYearChange={(val) => onFiltersChange('seasonYear', val)}
              seasonOptions={anilistSeasonOptions}
            />
          </div>
        </FilterSection>
      )}

      <FilterSection
        id="score"
        title="Score & Popularity"
        description="Filter by average score and popularity"
        icon={Star}
        isOpen={expandedSections?.score}
        onToggle={onToggleSection}
        badgeCount={getScoreBadge()}
      >
        <RangeSlider
          label="Average Score"
          min={0}
          max={100}
          step={1}
          value={[filters.averageScoreMin || 0, filters.averageScoreMax || 100]}
          onChange={handleScoreChange}
        />

        <div className="filter-spacer" />

        <SingleSlider
          label="Minimum Popularity"
          tooltip="Minimum number of users tracking this title on AniList."
          min={0}
          max={100000}
          step={100}
          value={filters.popularityMin || 0}
          onChange={(v) => onFiltersChange('popularityMin', v || undefined)}
        />
      </FilterSection>

      <FilterSection
        id="origin"
        title="Origin & Source"
        description="Country of origin and source material"
        icon={Globe}
        isOpen={expandedSections?.origin}
        onToggle={onToggleSection}
        badgeCount={getOriginBadge()}
      >
        <div className="filter-group">
          <LabelWithTooltip
            label="Country of Origin"
            tooltip="Filter anime by country of origin (Japan, South Korea, China, etc.)."
          />
          <SearchableSelect
            options={countrySelectOptions}
            value={filters.countryOfOrigin || ''}
            onChange={(val) => onFiltersChange('countryOfOrigin', val || undefined)}
            placeholder="Any Country"
            searchPlaceholder="Search countries..."
            labelKey="label"
            valueKey="value"
          />
        </div>

        <div className="filter-group">
          <LabelWithTooltip
            label="Source Material"
            tooltip="Filter by original source: Manga, Light Novel, Visual Novel, Original, etc."
          />
          <AnimeFormatSelector
            selected={filters.sourceMaterial || []}
            options={anilistSourceOptions}
            onChange={(sources) => onFiltersChange('sourceMaterial', sources)}
          />
        </div>
      </FilterSection>

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
          <label className="checkbox-label-row" style={{ cursor: 'pointer' }}>
            <div
              className={`checkbox ${filters.isAdult ? 'checked' : ''}`}
              role="checkbox"
              aria-checked={!!filters.isAdult}
              tabIndex={0}
              onClick={() => onFiltersChange('isAdult', !filters.isAdult || undefined)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onFiltersChange('isAdult', !filters.isAdult || undefined);
                }
              }}
            >
              {filters.isAdult && <Check size={14} />}
            </div>
            <LabelWithTooltip
              label="Include adult content"
              tooltip="Include adult/18+ rated anime in results."
            />
          </label>

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
    </>
  );
}
