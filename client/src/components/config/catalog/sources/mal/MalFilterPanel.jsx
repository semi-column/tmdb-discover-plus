import { useMemo, useCallback } from 'react';
import { Calendar, Sparkles, Layers, Star } from 'lucide-react';
import { FilterSection } from '../../FilterSection';
import { GenreSelector } from '../../GenreSelector';
import { AnimeSeasonSelector } from '../../shared/AnimeSeasonSelector';
import { AnimeFormatSelector } from '../../shared/AnimeFormatSelector';
import { StremioExtras } from '../../StremioExtras';
import { SearchableSelect } from '../../../../forms/SearchableSelect';
import { RangeSlider } from '../../../../forms/RangeSlider';
import { Checkbox } from '../../../../forms/Checkbox';
import { LabelWithTooltip } from '../../../../forms/Tooltip';

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
  malSortOptions = [],
  malOrderByOptions = [],
  malMediaTypes = [],
  malStatuses = [],
  malRatings = [],
  isPresetCatalog = false,
  supportsFullFilters = true,
}) {
  const filters = localCatalog?.filters || {};
  const type = localCatalog?.type || 'movie';

  const availableMediaTypes = useMemo(() => {
    if (type === 'movie')
      return malMediaTypes.filter((m) => m.value === 'movie' || m.value === 'special');
    return malMediaTypes.filter((m) => m.value !== 'movie');
  }, [malMediaTypes, type]);

  const malGenreGroups = useMemo(() => {
    const groups = { genre: [], theme: [], demographic: [] };
    for (const g of malGenres) {
      const bucket = g.category === 'demographic' || g.category === 'theme' ? g.category : 'genre';
      groups[bucket].push({ id: g.id, name: g.name });
    }
    return groups;
  }, [malGenres]);

  const handleScoreChange = useCallback(
    ([min, max]) => {
      onFiltersChange('malScoreMin', min > 0 ? min : undefined);
      onFiltersChange('malScoreMax', max < 10 ? max : undefined);
    },
    [onFiltersChange]
  );

  const getGenreBadge = () =>
    (filters.malGenres || []).length + (filters.malExcludeGenres || []).length;

  const handleGenreInclude = useCallback(
    (genreId) => {
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
    },
    [filters.malGenres, filters.malExcludeGenres, onFiltersChange]
  );

  const handleGenreExclude = useCallback(
    (genreId) => {
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
    },
    [filters.malGenres, filters.malExcludeGenres, onFiltersChange]
  );

  const handleGenreClear = useCallback(
    (genreId) => {
      onFiltersChange(
        'malGenres',
        (filters.malGenres || []).filter((g) => g !== genreId)
      );
      onFiltersChange(
        'malExcludeGenres',
        (filters.malExcludeGenres || []).filter((g) => g !== genreId)
      );
    },
    [filters.malGenres, filters.malExcludeGenres, onFiltersChange]
  );

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
    if ((filters.malExcludeMediaType || []).length > 0) count++;
    if ((filters.malStatus || []).length > 0) count++;
    if (filters.malRating) count++;
    if (filters.malSfw) count++;
    if (filters.malAiredFrom || filters.malAiredTo) count++;
    return count;
  };

  const getScoreBadge = () => {
    let count = 0;
    if (filters.malScoreMin) count++;
    if (filters.malScoreMax) count++;
    if (filters.malOrderBy) count++;
    if (filters.randomize) count++;
    return count;
  };

  return (
    <>
      {supportsFullFilters && (
        <FilterSection
          id="filters"
          title="Sort & Filter"
          description="Score range and result ordering"
          icon={Star}
          isOpen={expandedSections?.filters}
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
              <LabelWithTooltip label="Order By" tooltip="How to order browse results." />
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

          <div className="filter-group">
            <Checkbox
              checked={Boolean(filters.randomize)}
              onChange={(checked) => onFiltersChange('randomize', checked || undefined)}
              label="Randomize Results"
              tooltip="Choose a random page from the matching Jikan results, then shuffle the returned titles."
            />
          </div>
        </FilterSection>
      )}

      {supportsFullFilters && (
        <FilterSection
          id="genres"
          title="Genres"
          description="Select genres to include or exclude"
          icon={Sparkles}
          isOpen={expandedSections?.genres}
          onToggle={onToggleSection}
          badgeCount={getGenreBadge()}
        >
          <div className="genre-instructions">
            <span className="genre-instruction-item">
              <span className="genre-dot neutral"></span> Click to include
            </span>
            <span className="genre-instruction-item">
              <span className="genre-dot include"></span> Click again to exclude
            </span>
            <span className="genre-instruction-item">
              <span className="genre-dot exclude"></span> Click again to clear
            </span>
          </div>

          <div className="filter-group">
            <LabelWithTooltip
              label="Genres"
              tooltip="Broad genre categories (Action, Romance, Comedy, etc.)."
            />
            <GenreSelector
              genres={malGenreGroups.genre}
              selectedGenres={filters.malGenres || []}
              excludedGenres={filters.malExcludeGenres || []}
              genreMatchMode="any"
              onInclude={handleGenreInclude}
              onExclude={handleGenreExclude}
              onClear={handleGenreClear}
              onSetMatchMode={() => {}}
              showMatchMode={false}
              showLegend={false}
              loading={false}
              onRefresh={() => {}}
            />
          </div>

          {malGenreGroups.theme.length > 0 && (
            <div className="filter-group">
              <LabelWithTooltip
                label="Themes"
                tooltip="Narrower thematic tags (Isekai, Mecha, Harem, Time Travel, etc.)."
              />
              <GenreSelector
                genres={malGenreGroups.theme}
                selectedGenres={filters.malGenres || []}
                excludedGenres={filters.malExcludeGenres || []}
                genreMatchMode="any"
                onInclude={handleGenreInclude}
                onExclude={handleGenreExclude}
                onClear={handleGenreClear}
                onSetMatchMode={() => {}}
                showMatchMode={false}
                showLegend={false}
                loading={false}
                onRefresh={() => {}}
              />
            </div>
          )}

          {malGenreGroups.demographic.length > 0 && (
            <div className="filter-group">
              <LabelWithTooltip
                label="Demographics"
                tooltip="Target audience demographic (Shounen, Seinen, Josei, Shoujo, Kids)."
              />
              <GenreSelector
                genres={malGenreGroups.demographic}
                selectedGenres={filters.malGenres || []}
                excludedGenres={filters.malExcludeGenres || []}
                genreMatchMode="any"
                onInclude={handleGenreInclude}
                onExclude={handleGenreExclude}
                onClear={handleGenreClear}
                onSetMatchMode={() => {}}
                showMatchMode={false}
                showLegend={false}
                loading={false}
                onRefresh={() => {}}
              />
            </div>
          )}
        </FilterSection>
      )}

      {isPresetCatalog && (
        <div className="preset-empty-state">
          <Sparkles size={32} className="preset-empty-icon" />
          <span className="preset-empty-text">
            This is a curated preset from MAL and cannot be modified.
          </span>
        </div>
      )}

      {supportsFullFilters && (
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
                onChange={(mediaTypes) => onFiltersChange('malMediaType', mediaTypes)}
              />
            </div>
          )}

          {availableMediaTypes.length > 0 && (
            <div className="filter-group">
              <LabelWithTooltip
                label="Exclude Media Type"
                tooltip="Hide results matching these media types, independent of the include list above."
              />
              <AnimeFormatSelector
                selected={filters.malExcludeMediaType || []}
                options={availableMediaTypes}
                onChange={(mediaTypes) => onFiltersChange('malExcludeMediaType', mediaTypes)}
              />
            </div>
          )}

          {malStatuses.length > 0 && (
            <div className="filter-group">
              <LabelWithTooltip
                label="Status"
                tooltip="Filter by airing status: Airing, Finished, Upcoming. Jikan only supports one status at a time."
              />
              <AnimeFormatSelector
                selected={filters.malStatus || []}
                options={malStatuses}
                onChange={(statuses) => onFiltersChange('malStatus', statuses)}
                multiple={false}
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

          <div className="filter-group">
            <Checkbox
              checked={Boolean(filters.malSfw)}
              onChange={(checked) => onFiltersChange('malSfw', checked || undefined)}
              label="SFW only"
              tooltip="Hide Hentai/Erotica entries from results."
            />
          </div>

          <div className="filter-group">
            <LabelWithTooltip
              label="Aired Between"
              tooltip="Restrict results to anime that aired within this date range."
            />
            <div className="filter-grid">
              <input
                type="date"
                className="input"
                value={filters.malAiredFrom || ''}
                onChange={(e) => onFiltersChange('malAiredFrom', e.target.value || undefined)}
              />
              <input
                type="date"
                className="input"
                value={filters.malAiredTo || ''}
                onChange={(e) => onFiltersChange('malAiredTo', e.target.value || undefined)}
              />
            </div>
          </div>
        </FilterSection>
      )}

      {type === 'series' && supportsFullFilters && (
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
                tooltip="Filter by anime season. When a season is selected, other advanced filters are ignored."
              />
              <AnimeSeasonSelector
                season={filters.malSeason}
                year={filters.malSeasonYear}
                onSeasonChange={(val) => onFiltersChange('malSeason', val)}
                onYearChange={(val) => onFiltersChange('malSeasonYear', val)}
                seasonOptions={MAL_SEASON_OPTIONS}
              />
              <p className="text-secondary" style={{ fontSize: '11px', marginTop: '6px' }}>
                When a season is selected, browse filters are overridden
              </p>
            </div>

            {filters.malSeason && filters.malSeasonYear && (
              <div className="filter-group">
                <LabelWithTooltip label="Sort" tooltip="How to sort seasonal results." />
                <SearchableSelect
                  options={malSortOptions}
                  value={filters.malSort || 'members'}
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
