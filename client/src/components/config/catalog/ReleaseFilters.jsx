import { useCallback, useMemo, memo } from 'react';
import { MultiSelect } from '../../forms/MultiSelect';
import { SearchableSelect } from '../../forms/SearchableSelect';
import { LabelWithTooltip } from '../../forms/Tooltip';

const CURRENT_YEAR = new Date().getFullYear();

const DATE_PRESETS = [
  { label: 'Last 30 days', value: 'last_30_days', group: 'relative' },
  { label: 'Last 90 days', value: 'last_90_days', group: 'relative' },
  { label: 'Last 6 months', value: 'last_180_days', group: 'relative' },
  { label: 'Last 12 months', value: 'last_365_days', group: 'relative' },
  { label: 'Next 30 days', value: 'next_30_days', group: 'relative' },
  { label: 'Next 3 months', value: 'next_90_days', group: 'relative' },
  { label: '2020s', value: 'era_2020s', group: 'decade' },
  { label: '2010s', value: 'era_2010s', group: 'decade' },
  { label: '2000s', value: 'era_2000s', group: 'decade' },
  { label: '1990s', value: 'era_1990s', group: 'decade' },
  { label: '1980s', value: 'era_1980s', group: 'decade' },
];

export const ReleaseFilters = memo(function ReleaseFilters({
  localCatalog,
  onFiltersChange,
  isMovie,
  countries,
  releaseTypes,
  tvStatuses,
  tvTypes,
  certOptions,
}) {
  const safeCountries = Array.isArray(countries) ? countries : [];
  const safeReleaseTypes = Array.isArray(releaseTypes) ? releaseTypes : [];
  const safeTvStatuses = Array.isArray(tvStatuses) ? tvStatuses : [];
  const safeTvTypes = Array.isArray(tvTypes) ? tvTypes : [];

  const selectedDatePreset =
    DATE_PRESETS.find((p) => p.value === localCatalog?.filters?.datePreset)?.label || null;

  const dateRangeError = useMemo(() => {
    const fromKey = isMovie ? 'releaseDateFrom' : 'airDateFrom';
    const toKey = isMovie ? 'releaseDateTo' : 'airDateTo';
    const from = localCatalog?.filters?.[fromKey];
    const to = localCatalog?.filters?.[toKey];
    if (from && to && from > to) return '"From" date must be before "To" date';
    return null;
  }, [localCatalog?.filters, isMovie]);

  const premiereRangeError = useMemo(() => {
    const from = localCatalog?.filters?.firstAirDateFrom;
    const to = localCatalog?.filters?.firstAirDateTo;
    if (from && to && from > to) return '"From" date must be before "To" date';
    return null;
  }, [localCatalog?.filters?.firstAirDateFrom, localCatalog?.filters?.firstAirDateTo]);

  const handleDatePreset = useCallback(
    (preset) => {
      onFiltersChange('datePreset', preset.value);
      onFiltersChange(isMovie ? 'releaseDateFrom' : 'airDateFrom', undefined);
      onFiltersChange(isMovie ? 'releaseDateTo' : 'airDateTo', undefined);
    },
    [isMovie, onFiltersChange]
  );

  return (
    <>
      <div className="date-presets">
        <div className="date-preset-group">
          {DATE_PRESETS.filter((p) => p.group === 'relative').map((preset) => (
            <button
              key={preset.label}
              className={`date-preset ${selectedDatePreset === preset.label ? 'active' : ''}`}
              onClick={() => handleDatePreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="date-preset-group">
          {DATE_PRESETS.filter((p) => p.group === 'decade').map((preset) => (
            <button
              key={preset.label}
              className={`date-preset ${selectedDatePreset === preset.label ? 'active' : ''}`}
              onClick={() => handleDatePreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-two-col">
        <div className="filter-group">
          <LabelWithTooltip
            label={isMovie ? 'Release Date From' : 'Episode Air Date From'}
            tooltip={
              isMovie
                ? 'Filter movies released on or after this date'
                : 'Filter shows that had episodes airing on or after this date'
            }
          />
          <input
            type="date"
            className="input"
            value={localCatalog?.filters?.[isMovie ? 'releaseDateFrom' : 'airDateFrom'] || ''}
            onChange={(e) => {
              onFiltersChange('datePreset', undefined);
              onFiltersChange(isMovie ? 'releaseDateFrom' : 'airDateFrom', e.target.value);
            }}
          />
        </div>
        <div className="filter-group">
          <LabelWithTooltip
            label={isMovie ? 'Release Date To' : 'Episode Air Date To'}
            tooltip={
              isMovie
                ? 'Filter movies released on or before this date'
                : 'Filter shows that had episodes airing on or before this date'
            }
          />
          <input
            type="date"
            className={`input${dateRangeError ? ' field-invalid' : ''}`}
            value={localCatalog?.filters?.[isMovie ? 'releaseDateTo' : 'airDateTo'] || ''}
            onChange={(e) => {
              onFiltersChange('datePreset', undefined);
              onFiltersChange(isMovie ? 'releaseDateTo' : 'airDateTo', e.target.value);
            }}
          />
        </div>
      </div>
      {dateRangeError && <span className="field-error">{dateRangeError}</span>}

      {!isMovie && (
        <div className="filter-two-col" style={{ marginTop: '16px' }}>
          <div className="filter-group">
            <LabelWithTooltip
              label="Show Premiered From"
              tooltip="Filter by when the TV show first aired. This is the date of the very first episode, not individual episode air dates."
            />
            <span className="filter-label-hint">When show first aired (premiere date)</span>
            <input
              type="date"
              className="input"
              value={localCatalog?.filters?.firstAirDateFrom || ''}
              onChange={(e) => onFiltersChange('firstAirDateFrom', e.target.value)}
            />
          </div>
          <div className="filter-group">
            <LabelWithTooltip
              label="Show Premiered To"
              tooltip="Latest premiere date to include. Shows that first aired before or on this date."
            />
            <input
              type="date"
              className={`input${premiereRangeError ? ' field-invalid' : ''}`}
              value={localCatalog?.filters?.firstAirDateTo || ''}
              onChange={(e) => onFiltersChange('firstAirDateTo', e.target.value)}
            />
          </div>
        </div>
      )}
      {!isMovie && premiereRangeError && <span className="field-error">{premiereRangeError}</span>}

      {!isMovie && (
        <div className="filter-two-col" style={{ marginTop: '16px' }}>
          <div className="filter-group">
            <LabelWithTooltip
              label="First Air Year"
              tooltip="Filter by the year the show first aired (TMDB first_air_date_year)."
            />
            <input
              type="number"
              className="input"
              min="1900"
              max={CURRENT_YEAR + 1}
              placeholder="e.g. 2019"
              value={localCatalog?.filters?.firstAirDateYear || ''}
              onChange={(e) => {
                const value = e.target.value;
                onFiltersChange('firstAirDateYear', value ? Number(value) : undefined);
              }}
            />
          </div>
          <div className="filter-group">
            <LabelWithTooltip
              label="Timezone"
              tooltip="Timezone for date calculations (e.g., America/New_York)."
            />
            <input
              type="text"
              className="input"
              placeholder="e.g. America/New_York"
              value={localCatalog?.filters?.timezone || ''}
              onChange={(e) =>
                onFiltersChange('timezone', e.target.value ? e.target.value.trim() : undefined)
              }
            />
          </div>
        </div>
      )}

      {isMovie ? (
        <>
          <div className="filter-group" style={{ marginTop: '16px' }}>
            <LabelWithTooltip
              label="Release Region"
              tooltip="Filter by when content was released in a specific country. Useful since movies often premiere at different times worldwide."
            />
            <span className="filter-label-hint">
              Use regional release dates instead of worldwide premiere
            </span>
            <SearchableSelect
              options={safeCountries}
              value={localCatalog?.filters?.region || ''}
              onChange={(value) => {
                onFiltersChange('region', value);
                if (value) onFiltersChange('certificationCountry', value);
                if (!value) onFiltersChange('releaseTypes', []);
              }}
              placeholder="Worldwide"
              searchPlaceholder="Search countries..."
              labelKey="english_name"
              valueKey="iso_3166_1"
            />
          </div>
          <div className="filter-two-col" style={{ marginTop: '16px' }}>
            <div className="filter-group">
              <LabelWithTooltip
                label="Primary Release Year"
                tooltip="Filter by the year of a movie's primary (worldwide) release."
              />
              <input
                type="number"
                className="input"
                min="1900"
                max={CURRENT_YEAR + 1}
                placeholder="e.g. 2015"
                value={localCatalog?.filters?.primaryReleaseYear || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  onFiltersChange('primaryReleaseYear', value ? Number(value) : undefined);
                }}
              />
            </div>
            <div className="filter-group">
              <LabelWithTooltip
                label="Release Type"
                tooltip="How the movie was released: Theatrical (cinemas), Digital (streaming/download), Physical (DVD/Blu-ray), TV broadcast, etc. Requires a region to be selected."
              />
              <MultiSelect
                options={safeReleaseTypes}
                value={localCatalog?.filters?.releaseTypes || []}
                onChange={(value) => onFiltersChange('releaseTypes', value)}
                placeholder={!localCatalog?.filters?.region ? 'Select region first' : 'All types'}
                labelKey="label"
                valueKey="value"
                disabled={!localCatalog?.filters?.region}
              />
              {!localCatalog?.filters?.region && (
                <span className="filter-label-hint warning">
                  Select a region above to filter by release type
                </span>
              )}
            </div>
            <div className="filter-group">
              <LabelWithTooltip
                label="Age Rating"
                tooltip="Content certification/age rating (e.g., PG-13, R, TV-MA). Varies by country - US ratings shown by default."
              />
              <MultiSelect
                options={(certOptions || []).map((c) => ({
                  value: c.certification,
                  label: c.certification,
                }))}
                value={localCatalog?.filters?.certifications || []}
                onChange={(value) => onFiltersChange('certifications', value)}
                placeholder="Any"
                labelKey="label"
                valueKey="value"
              />
              <span className="filter-label-hint">Use this for exact certifications.</span>
            </div>
          </div>
        </>
      ) : (
        <div className="filter-two-col" style={{ marginTop: '16px' }}>
          <div className="filter-group">
            <LabelWithTooltip
              label="Show Status"
              tooltip="Whether the TV show is currently Returning Series, Ended, Canceled, In Production, or Pilot status."
            />
            <SearchableSelect
              options={[{ value: '', label: 'Any' }, ...safeTvStatuses]}
              value={localCatalog?.filters?.tvStatus || ''}
              onChange={(value) => onFiltersChange('tvStatus', value)}
              placeholder="Any"
              searchPlaceholder="Search..."
              labelKey="label"
              valueKey="value"
            />
          </div>
          <div className="filter-group">
            <LabelWithTooltip
              label="Show Type"
              tooltip="Format of TV show: Scripted (regular series), Reality, Documentary, Talk Show, News, Miniseries, etc."
            />
            <SearchableSelect
              options={[{ value: '', label: 'Any' }, ...safeTvTypes]}
              value={localCatalog?.filters?.tvType || ''}
              onChange={(value) => onFiltersChange('tvType', value)}
              placeholder="Any"
              searchPlaceholder="Search..."
              labelKey="label"
              valueKey="value"
            />
          </div>
        </div>
      )}
    </>
  );
});
