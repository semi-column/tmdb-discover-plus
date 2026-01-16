import { useState } from 'react';
import { X } from 'lucide-react';
import { MultiSelect } from '../MultiSelect';
import { SearchableSelect } from '../SearchableSelect';
import { LabelWithTooltip } from '../Tooltip';

export function StreamFilters({
  type,
  tvNetworks,
  watchRegions,
  watchProviders,
  monetizationTypes,
  onNetworkSearch,
  filters,
  onFiltersChange,
}) {
  const [providerSearch, setProviderSearch] = useState('');

  const tvNetworkOptions = tvNetworks || [];

  const handleProviderToggle = (providerId) => {
    const current = filters.watchProviders || [];
    const isActive = current.includes(providerId);
    let next;
    if (isActive) {
      next = current.filter((id) => id !== providerId);
    } else {
      next = [...current, providerId];
    }
    onFiltersChange('watchProviders', next);
  };

  return (
    <>
      {/* TV Networks - only show for TV content */}
      {type === 'series' && tvNetworks.length > 0 && (
        <div className="filter-group" style={{ marginBottom: '16px' }}>
          <LabelWithTooltip
            label="Original Networks"
            tooltip="Filter by the TV network that originally produced/aired the show."
          />
          <span className="filter-label-hint">
            Where the show originally aired (HBO, Netflix Originals, etc.)
          </span>
          <MultiSelect
            options={tvNetworkOptions.map((n) => ({ code: String(n.id), name: n.name }))}
            value={(filters.withNetworks || '').split('|').filter(Boolean)}
            onChange={(values) => onFiltersChange('withNetworks', values.join('|'))}
            placeholder="Any network"
            searchPlaceholder="Search networks..."
            onSearch={onNetworkSearch}
            labelKey="name"
            valueKey="code"
          />
        </div>
      )}

      {/* Streaming availability filters */}
      <div className="filter-two-col">
        <div className="filter-group">
          <LabelWithTooltip
            label="Your Region"
            tooltip="Choose your country to see which streaming services have this content available."
          />
          <SearchableSelect
            options={watchRegions.map((r) => ({ code: r.iso_3166_1, name: r.english_name }))}
            value={filters.watchRegion || ''}
            onChange={(value) => onFiltersChange('watchRegion', value)}
            placeholder="Select your region"
            searchPlaceholder="Search regions..."
            labelKey="name"
            valueKey="code"
          />
        </div>
        <div className="filter-group">
          <LabelWithTooltip
            label="Availability Type"
            tooltip="How to access: Subscription, Free, Rent, Buy."
          />
          <MultiSelect
            options={monetizationTypes}
            value={filters.watchMonetizationTypes || []}
            onChange={(value) => onFiltersChange('watchMonetizationTypes', value)}
            placeholder="Any"
            labelKey="label"
            valueKey="value"
          />
        </div>
      </div>

      <div style={{ marginTop: '16px' }}>
        <LabelWithTooltip
          label="Streaming Services"
          tooltip="Filter by specific streaming platforms."
        />
        <span className="filter-label-hint">
          {filters.watchRegion && watchProviders.length > 0
            ? 'Where you can currently watch in your region'
            : 'Select your region to see available services'}
        </span>
        {filters.watchRegion && watchProviders.length > 0 ? (
          <>
            <div className="provider-search">
              <input
                type="text"
                value={providerSearch}
                onChange={(e) => setProviderSearch(e.target.value)}
                placeholder="Search streaming services..."
                className="provider-search-input"
              />
              {providerSearch && (
                <button
                  type="button"
                  className="provider-search-clear"
                  onClick={() => setProviderSearch('')}
                  aria-label="Clear provider search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="provider-grid-wrap">
              <div className="provider-grid">
                {(() => {
                  const filtered = providerSearch
                    ? watchProviders.filter((p) =>
                        p?.name?.toLowerCase().includes(providerSearch.trim().toLowerCase())
                      )
                    : watchProviders;

                  if (filtered.length === 0) {
                    return (
                      <div
                        className="filter-hint"
                        style={{ gridColumn: '1 / -1', marginTop: '4px' }}
                      >
                        No streaming services match your search.
                      </div>
                    );
                  }

                  return filtered.map((provider) => (
                    <div
                      key={provider.id}
                      className={`provider-item ${(filters.watchProviders || []).includes(provider.id) ? 'selected' : ''}`}
                      onClick={() => handleProviderToggle(provider.id)}
                    >
                      {provider.logo ? (
                        <img src={provider.logo} alt={provider.name} className="provider-logo" />
                      ) : (
                        <div
                          className="provider-logo"
                          style={{ background: 'var(--bg-tertiary)' }}
                        />
                      )}
                      <span className="provider-name">{provider.name}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </>
        ) : (
          <div
            className="filter-hint"
            style={{
              marginTop: '8px',
              padding: '12px',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            Choose a region above to see streaming services available in that area
          </div>
        )}
      </div>
    </>
  );
}
