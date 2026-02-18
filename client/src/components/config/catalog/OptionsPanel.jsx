import { memo } from 'react';
import { Check } from 'lucide-react';
import { LabelWithTooltip } from '../../forms/Tooltip';

export const OptionsPanel = memo(function OptionsPanel({ localCatalog, onFiltersChange, isMovie }) {
  const filters = localCatalog?.filters || {};

  const toggle = (key) => onFiltersChange(key, !filters[key]);

  const handleKeyDown = (key, e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle(key);
    }
  };

  return (
    <div className="checkbox-grid">
      <label
        className="checkbox-label-row"
        onClick={() => toggle('releasedOnly')}
        style={{ cursor: 'pointer' }}
      >
        <div
          className={`checkbox ${filters.releasedOnly ? 'checked' : ''}`}
          role="checkbox"
          aria-checked={!!filters.releasedOnly}
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown('releasedOnly', e)}
        >
          {filters.releasedOnly && <Check size={14} />}
        </div>
        <LabelWithTooltip
          label="Released only"
          tooltip="Only show content that has been released (digital, physical, or TV release for movies; ended or airing shows for series). Filters out announced and in-production titles."
        />
      </label>

      <label
        className="checkbox-label-row"
        onClick={() => toggle('includeAdult')}
        style={{ cursor: 'pointer' }}
      >
        <div
          className={`checkbox ${filters.includeAdult ? 'checked' : ''}`}
          role="checkbox"
          aria-checked={!!filters.includeAdult}
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown('includeAdult', e)}
        >
          {filters.includeAdult && <Check size={14} />}
        </div>
        <LabelWithTooltip
          label="Include adult content"
          tooltip="Include adult/18+ rated content in results. Disabled by default."
        />
      </label>

      {isMovie && (
        <label
          className="checkbox-label-row"
          onClick={() => toggle('includeVideo')}
          style={{ cursor: 'pointer' }}
        >
          <div
            className={`checkbox ${filters.includeVideo ? 'checked' : ''}`}
            role="checkbox"
            aria-checked={!!filters.includeVideo}
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown('includeVideo', e)}
          >
            {filters.includeVideo && <Check size={14} />}
          </div>
          <LabelWithTooltip
            label="Include video content"
            tooltip="Include titles marked as video content in TMDB."
          />
        </label>
      )}

      <label
        className="checkbox-label-row"
        onClick={() => toggle('randomize')}
        style={{ cursor: 'pointer' }}
      >
        <div
          className={`checkbox ${filters.randomize ? 'checked' : ''}`}
          role="checkbox"
          aria-checked={!!filters.randomize}
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown('randomize', e)}
        >
          {filters.randomize && <Check size={14} />}
        </div>
        <LabelWithTooltip
          label="Randomize Results"
          tooltip="Fetch a random page from the matching results and shuffle them. Great for discovering something new every time."
        />
      </label>

      <label
        className="checkbox-label-row"
        onClick={() => toggle('discoverOnly')}
        style={{ cursor: 'pointer' }}
      >
        <div
          className={`checkbox ${filters.discoverOnly ? 'checked' : ''}`}
          role="checkbox"
          aria-checked={!!filters.discoverOnly}
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown('discoverOnly', e)}
        >
          {filters.discoverOnly && <Check size={14} />}
        </div>
        <LabelWithTooltip
          label="Discover Only"
          tooltip="Hide this catalog from the Board (Home). It will only appear in the Discover tab."
        />
      </label>

      <label
        className="checkbox-label-row"
        onClick={() => toggle('enableRatingPosters')}
        style={{ cursor: 'pointer' }}
      >
        <div
          className={`checkbox ${filters.enableRatingPosters ? 'checked' : ''}`}
          role="checkbox"
          aria-checked={!!filters.enableRatingPosters}
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown('enableRatingPosters', e)}
        >
          {filters.enableRatingPosters && <Check size={14} />}
        </div>
        <LabelWithTooltip
          label="Rating posters"
          tooltip="Show rating overlay on posters for this catalog. Requires a poster service to be configured in your preferences."
        />
      </label>

      {!isMovie && (
        <label
          className="checkbox-label-row"
          onClick={() => toggle('includeNullFirstAirDates')}
          style={{ cursor: 'pointer' }}
        >
          <div
            className={`checkbox ${filters.includeNullFirstAirDates ? 'checked' : ''}`}
            role="checkbox"
            aria-checked={!!filters.includeNullFirstAirDates}
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown('includeNullFirstAirDates', e)}
          >
            {filters.includeNullFirstAirDates && <Check size={14} />}
          </div>
          <LabelWithTooltip
            label="Include unknown air dates"
            tooltip="Include shows with no recorded first air date."
          />
        </label>
      )}

      {!isMovie && (
        <label
          className="checkbox-label-row"
          onClick={() => toggle('screenedTheatrically')}
          style={{ cursor: 'pointer' }}
        >
          <div
            className={`checkbox ${filters.screenedTheatrically ? 'checked' : ''}`}
            role="checkbox"
            aria-checked={!!filters.screenedTheatrically}
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown('screenedTheatrically', e)}
          >
            {filters.screenedTheatrically && <Check size={14} />}
          </div>
          <LabelWithTooltip
            label="Screened theatrically"
            tooltip="Include shows that were screened in theaters."
          />
        </label>
      )}
    </div>
  );
});
