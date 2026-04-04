import { memo } from 'react';
import { Checkbox } from '../../forms/Checkbox';

export const OptionsPanel = memo(function OptionsPanel({ localCatalog, onFiltersChange, isMovie }) {
  const filters = localCatalog?.filters || {};

  return (
    <div className="checkbox-grid">
      <Checkbox
        checked={!!filters.includeAdult}
        onChange={(checked) => onFiltersChange('includeAdult', checked || undefined)}
        label="Include adult content"
        tooltip="Include adult/18+ rated content in results. Disabled by default."
      />

      {isMovie && (
        <Checkbox
          checked={!!filters.includeVideo}
          onChange={(checked) => onFiltersChange('includeVideo', checked || undefined)}
          label="Include video content"
          tooltip="Include titles marked as video content in TMDB."
        />
      )}

      <Checkbox
        checked={!!filters.randomize}
        onChange={(checked) => onFiltersChange('randomize', checked || undefined)}
        label="Randomize Results"
        tooltip="Fetch a random page from the matching results and shuffle them. Great for discovering something new every time."
      />

      <Checkbox
        checked={!!filters.discoverOnly}
        onChange={(checked) => onFiltersChange('discoverOnly', checked || undefined)}
        label="Discover Only"
        tooltip="Hide this catalog from the Board (Home). It will only appear in the Discover tab."
      />

      {!isMovie && (
        <Checkbox
          checked={!!filters.includeNullFirstAirDates}
          onChange={(checked) => onFiltersChange('includeNullFirstAirDates', checked || undefined)}
          label="Include unknown air dates"
          tooltip="Include shows with no recorded first air date."
        />
      )}

      {!isMovie && (
        <Checkbox
          checked={!!filters.screenedTheatrically}
          onChange={(checked) => onFiltersChange('screenedTheatrically', checked || undefined)}
          label="Screened theatrically"
          tooltip="Include shows that were screened in theaters."
        />
      )}
    </div>
  );
});
