import { Settings, Calendar, Eye, Check } from 'lucide-react';
import { FilterSection } from '../../FilterSection';
import { AnimeSeasonSelector } from '../../shared/AnimeSeasonSelector';
import { SearchableSelect } from '../../../../forms/SearchableSelect';
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
  malRankingTypes = [],
  malSortOptions = [],
}) {
  const filters = localCatalog?.filters || {};

  const getRankingBadge = () =>
    filters.malRankingType && filters.malRankingType !== 'all' ? 1 : 0;

  const getSeasonBadge = () => {
    let count = 0;
    if (filters.malSeason) count++;
    if (filters.malSeasonYear) count++;
    if (filters.malSort && filters.malSort !== 'anime_num_list_users') count++;
    return count;
  };

  const getOptionsBadge = () => (filters.randomize ? 1 : 0);

  return (
    <>
      <FilterSection
        id="ranking"
        title="Ranking"
        description="Choose a MAL ranking type"
        icon={Settings}
        isOpen={expandedSections?.ranking !== false}
        onToggle={onToggleSection}
        badgeCount={getRankingBadge()}
      >
        <div className="filter-group">
          <LabelWithTooltip
            label="Ranking Type"
            tooltip="Select from MAL's curated ranking lists: All, Airing, Upcoming, TV, Movie, etc."
          />
          <SearchableSelect
            options={malRankingTypes}
            value={filters.malRankingType || 'all'}
            onChange={(value) => onFiltersChange('malRankingType', value)}
            placeholder="All"
            searchPlaceholder="Search..."
            labelKey="label"
            valueKey="value"
            allowClear={false}
          />
        </div>
      </FilterSection>

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
            tooltip="Filter by anime season. When a season is selected, the ranking type is ignored."
          />
          <AnimeSeasonSelector
            season={filters.malSeason}
            year={filters.malSeasonYear}
            onSeasonChange={(val) => onFiltersChange('malSeason', val)}
            onYearChange={(val) => onFiltersChange('malSeasonYear', val)}
            seasonOptions={MAL_SEASON_OPTIONS}
          />
          <p className="text-secondary" style={{ fontSize: '11px', marginTop: '6px' }}>
            When a season is selected, the ranking type is ignored
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
