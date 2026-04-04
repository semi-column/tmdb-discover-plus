import { useMemo, useCallback } from 'react';
import { Settings, Sparkles, Calendar, Star, Globe, Eye, Tag, Clock } from 'lucide-react';
import { FilterSection } from '../../FilterSection';
import { GenreSelector } from '../../GenreSelector';
import { AnimeSeasonSelector } from '../../shared/AnimeSeasonSelector';
import { AnimeFormatSelector } from '../../shared/AnimeFormatSelector';
import { SearchableSelect } from '../../../../forms/SearchableSelect';
import { MultiSelect } from '../../../../forms/MultiSelect';
import { RangeSlider, SingleSlider } from '../../../../forms/RangeSlider';
import { LabelWithTooltip } from '../../../../forms/Tooltip';

import { Checkbox } from '../../../../forms/Checkbox';

export function AnilistFilterPanel({
  localCatalog,
  onFiltersChange,
  expandedSections,
  onToggleSection,
  handleTriStateGenreClick,
  anilistGenres = [],
  anilistTags = [],
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

  const availableFormatOptions = useMemo(() => {
    if (type === 'movie') {
      return anilistFormatOptions.filter((f) => f.value === 'MOVIE' || f.value === 'SPECIAL');
    }
    return anilistFormatOptions.filter((f) => f.value !== 'MOVIE');
  }, [anilistFormatOptions, type]);

  const anilistTagObjects = useMemo(
    () =>
      anilistTags.map((t) =>
        typeof t === 'string' ? { value: t, label: t } : { value: t.value, label: t.label }
      ),
    [anilistTags]
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

  const handleEpisodeChange = useCallback(
    ([min, max]) => {
      onFiltersChange('episodesMin', min > 0 ? min : undefined);
      onFiltersChange('episodesMax', max < 150 ? max : undefined);
    },
    [onFiltersChange]
  );

  const handleDurationChange = useCallback(
    ([min, max]) => {
      onFiltersChange('durationMin', min > 0 ? min : undefined);
      onFiltersChange('durationMax', max < 180 ? max : undefined);
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

  const getTagBadge = () => (filters.tags || []).length + (filters.excludeTags || []).length;

  const getSeasonBadge = () => (filters.season ? 1 : 0) + (filters.seasonYear ? 1 : 0);

  const getScoreBadge = () => {
    let count = 0;
    if (filters.averageScoreMin) count++;
    if (filters.averageScoreMax) count++;
    if (filters.popularityMin) count++;
    if (filters.episodesMin || filters.episodesMax) count++;
    if (filters.durationMin || filters.durationMax) count++;
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
            options={availableFormatOptions}
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

      {anilistTagObjects.length > 0 && (
        <FilterSection
          id="tags"
          title="Tags"
          description="Filter by AniList content tags"
          icon={Tag}
          isOpen={expandedSections?.tags}
          onToggle={onToggleSection}
          badgeCount={getTagBadge()}
        >
          <div className="filter-group">
            <LabelWithTooltip
              label="Include Tags"
              tooltip="Filter anime that include these tags (e.g. Isekai, Reincarnation, Gore). Search to find from 350+ available tags."
            />
            <MultiSelect
              options={anilistTagObjects}
              value={filters.tags || []}
              onChange={(tags) => onFiltersChange('tags', tags.length > 0 ? tags : undefined)}
              placeholder="Search and select tags..."
              searchPlaceholder="Type to search tags..."
              labelKey="label"
              valueKey="value"
              maxDisplay={5}
            />
          </div>
          <div className="filter-group">
            <LabelWithTooltip
              label="Exclude Tags"
              tooltip="Exclude anime that have these tags. Results will not contain any of the selected tags."
            />
            <MultiSelect
              options={anilistTagObjects}
              value={filters.excludeTags || []}
              onChange={(tags) =>
                onFiltersChange('excludeTags', tags.length > 0 ? tags : undefined)
              }
              placeholder="Search tags to exclude..."
              searchPlaceholder="Type to search tags..."
              labelKey="label"
              valueKey="value"
              maxDisplay={5}
            />
          </div>
        </FilterSection>
      )}

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
        title="Score, Popularity & Length"
        description="Filter by score, popularity, episodes, and duration"
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

        <div className="filter-spacer" />

        <RangeSlider
          label="Episode Count"
          tooltip="Filter by number of episodes."
          min={0}
          max={150}
          step={1}
          value={[filters.episodesMin || 0, filters.episodesMax || 150]}
          onChange={handleEpisodeChange}
        />

        <div className="filter-spacer" />

        <RangeSlider
          label="Duration (minutes per episode)"
          tooltip="Filter by episode duration in minutes."
          min={0}
          max={180}
          step={1}
          value={[filters.durationMin || 0, filters.durationMax || 180]}
          onChange={handleDurationChange}
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
          <Checkbox
            checked={!!filters.isAdult}
            onChange={(checked) => onFiltersChange('isAdult', checked || undefined)}
            label="Include adult content"
            tooltip="Include adult/18+ rated anime in results."
          />

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
