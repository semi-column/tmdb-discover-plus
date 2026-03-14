import { memo } from 'react';
import { MultiSelect } from './MultiSelect';
import { SearchableSelect } from './SearchableSelect';
import { LabelWithTooltip } from './Tooltip';

export const CertificationCountryFilter = memo(function CertificationCountryFilter({
  countryOptions = [],
  countryValue = '',
  onCountryChange,
  ratingOptions = [],
  ratingsValue = [],
  onRatingsChange,
  countryLabel = 'Age Rating Country',
  countryTooltip = "Select which country's certification system to use for age ratings. Changing this updates the available options.",
  ratingsLabel = 'Age Rating',
  ratingsTooltip = 'Content certification/age rating options for the selected country.',
  countryPlaceholder = 'Select country...',
  countrySearchPlaceholder = 'Search countries...',
  ratingsPlaceholder = 'Any',
  clearRatingsOnCountryChange = false,
  ratingsDisabled = false,
  hint,
}) {
  const safeCountryOptions = Array.isArray(countryOptions) ? countryOptions : [];
  const safeRatingOptions = Array.isArray(ratingOptions) ? ratingOptions : [];
  const safeRatingsValue = Array.isArray(ratingsValue) ? ratingsValue : [];

  return (
    <div className="filter-two-col" style={{ marginTop: '16px' }}>
      <div className="filter-group">
        <LabelWithTooltip label={countryLabel} tooltip={countryTooltip} />
        <SearchableSelect
          options={safeCountryOptions}
          value={countryValue || ''}
          onChange={(value) => {
            const normalized = value || undefined;
            onCountryChange?.(normalized);
            if (clearRatingsOnCountryChange) {
              onRatingsChange?.([]);
            }
          }}
          placeholder={countryPlaceholder}
          searchPlaceholder={countrySearchPlaceholder}
          labelKey="label"
          valueKey="value"
          allowClear={true}
        />
      </div>

      <div className="filter-group">
        <LabelWithTooltip label={ratingsLabel} tooltip={ratingsTooltip} />
        <MultiSelect
          options={safeRatingOptions}
          value={safeRatingsValue}
          onChange={(value) => onRatingsChange?.(value)}
          placeholder={ratingsPlaceholder}
          labelKey="label"
          valueKey="value"
          disabled={ratingsDisabled}
        />
        {hint ? <span className="filter-label-hint">{hint}</span> : null}
      </div>
    </div>
  );
});
