import React, { useState } from 'react';
import { ExternalLink, Copy } from 'lucide-react';
import { SearchableSelect } from '../forms/SearchableSelect';
import { artworkProviderRequiresApiKey } from '../../utils/artworkValidation';

const CONTENT_TYPES = [
  { id: 'movie', label: 'Movies' },
  { id: 'series', label: 'Series' },
  { id: 'anime', label: 'Anime' },
];

const ART_KINDS = [
  { id: 'poster', label: 'Poster' },
  { id: 'backdrop', label: 'Backdrop' },
  { id: 'logo', label: 'Logo' },
  { id: 'landscape', label: 'Landscape' },
  { id: 'episode', label: 'Episode' },
];

const SERVICE_OPTIONS = [
  { id: 'imdb', name: 'IMDb', kinds: ['poster', 'backdrop', 'logo', 'landscape', 'episode'] },
  { id: 'tvdb', name: 'TVDB', kinds: ['poster', 'backdrop', 'logo', 'landscape', 'episode'] },
  { id: 'fanart', name: 'Fanart.tv', kinds: ['poster', 'backdrop', 'logo', 'landscape'] },
  { id: 'rpdb', name: 'RPDB', kinds: ['poster', 'backdrop', 'logo', 'landscape'] },
  { id: 'topPosters', name: 'Top Posters', kinds: ['poster', 'logo', 'episode'] },
  {
    id: 'customUrl',
    name: 'Custom URL Pattern',
    kinds: ['poster', 'backdrop', 'logo', 'landscape', 'episode'],
  },
];

const DEFAULT_PROVIDER_LABELS = {
  poster: 'Default (TMDB)',
  backdrop: 'Default (TMDB)',
  landscape: 'Default (TMDB backdrop)',
  logo: 'Default (TMDB)',
  episode: 'Default (TMDB stills)',
};

const DEFAULT_PROVIDER_NOTES = {
  poster:
    'Uses TMDB poster artwork by default. You can switch to IMDb/TVDB preference per content type.',
  backdrop: 'Uses TMDB backdrop artwork by default. Can be overridden to IMDb/TVDB preference.',
  landscape: 'Uses TMDB backdrop in landscape format by default.',
  logo: 'Uses TMDB logo artwork by default.',
  episode: 'Uses TMDB episode stills by default, with native-source fallback.',
};

const ARTWORK_TYPE_LABELS = {
  poster: 'poster',
  backdrop: 'backdrop',
  landscape: 'landscape',
  logo: 'logo',
  episode: 'episode thumbnail',
};

const PREMIUM_REQUIRED_BY_PROVIDER = {
  rpdb: new Set(['backdrop', 'logo', 'landscape']),
  topPosters: new Set(['episode']),
};

function isPremiumRequiredForKind(provider, kind) {
  const kinds = PREMIUM_REQUIRED_BY_PROVIDER[provider];
  return Boolean(kinds && kinds.has(kind));
}

// --- Format migration helpers ---

const ART_KIND_KEYS = ['poster', 'backdrop', 'logo', 'landscape', 'episode'];

function isLegacyFormat(artwork) {
  if (!artwork || typeof artwork !== 'object') return false;
  return Object.keys(artwork).some((k) => ART_KIND_KEYS.includes(k));
}

function migrateToNewFormat(artwork) {
  if (!artwork) return { movie: {}, series: {}, anime: {} };
  if (!isLegacyFormat(artwork)) return artwork;
  const kindConfig = {};
  for (const kind of ART_KIND_KEYS) {
    if (artwork[kind]) kindConfig[kind] = artwork[kind];
  }
  return {
    movie: { ...kindConfig },
    series: { ...kindConfig },
    anime: { ...kindConfig },
    englishArtOnly: artwork.englishArtOnly || false,
    originalLangFallback: artwork.originalLangFallback ?? true,
  };
}

function ensureNewFormat(preferences) {
  const artwork = preferences?.artwork;
  if (!artwork || isLegacyFormat(artwork)) {
    return migrateToNewFormat(artwork);
  }
  return artwork;
}

function readProviderKey(container, provider) {
  if (!container || typeof container !== 'object' || !provider) return null;

  if (container instanceof Map) {
    const value = container.get(provider);
    return typeof value === 'string' ? value : null;
  }

  const value = container?.[provider];
  return typeof value === 'string' ? value : null;
}

function hasConfiguredProviderApiKey(preferences, artworkSettings, provider, contentType, artKind) {
  if (!provider) return false;

  const directApiKey = preferences?.apiKeys?.[provider];
  if (typeof directApiKey === 'string' && directApiKey.trim()) return true;

  const encryptedProviderKey = readProviderKey(preferences?.apiKeysEncrypted, provider);
  if (typeof encryptedProviderKey === 'string' && encryptedProviderKey.trim()) return true;

  const directKindConfig = artworkSettings?.[contentType]?.[artKind];
  if (
    directKindConfig?.provider === provider &&
    ((typeof directKindConfig?.apiKey === 'string' && directKindConfig.apiKey.trim()) ||
      (typeof directKindConfig?.apiKeyEncrypted === 'string' &&
        directKindConfig.apiKeyEncrypted.trim()))
  ) {
    return true;
  }

  return ['movie', 'series', 'anime'].some((ct) => {
    const kinds = artworkSettings?.[ct];
    if (!kinds || typeof kinds !== 'object') return false;

    return ART_KIND_KEYS.some((kind) => {
      const cfg = kinds?.[kind];
      if (!cfg || cfg.provider !== provider) return false;

      return (
        (typeof cfg?.apiKey === 'string' && cfg.apiKey.trim()) ||
        (typeof cfg?.apiKeyEncrypted === 'string' && cfg.apiKeyEncrypted.trim())
      );
    });
  });
}

// --- Sub-components ---

function getArtworkServiceOptions(artKind) {
  const available = SERVICE_OPTIONS.filter((s) => s.kinds.includes(artKind));
  return [
    {
      id: 'none',
      name: DEFAULT_PROVIDER_LABELS[artKind] || 'Default (Source metadata)',
    },
    ...available.map(({ id, name }) => ({ id, name })),
  ];
}

function ArtKindSelector({ contentType, artKind, artworkSettings, preferences, onChange }) {
  const artworkConfig = artworkSettings?.[contentType]?.[artKind] || {};
  const currentProvider =
    artworkConfig.provider === 'metahub' || artworkConfig.provider === 'tmdb'
      ? 'none'
      : artworkConfig.provider || 'none';
  const customUrlPattern = artworkConfig.customUrlPattern || '';
  const humanTypeLabel = ARTWORK_TYPE_LABELS[artKind] || artKind;
  const artworkServiceOptions = getArtworkServiceOptions(artKind);

  const updateValue = (updates) => {
    const newSettings = {
      ...artworkSettings,
      [contentType]: {
        ...(artworkSettings[contentType] || {}),
        [artKind]: {
          ...artworkConfig,
          ...updates,
        },
      },
    };
    onChange(newSettings);
  };

  const handleProviderChange = (newProvider) => {
    const updates = { provider: newProvider };
    updateValue(updates);
  };

  const getServiceInfo = (service) => {
    if (service === 'tmdb') {
      return {
        name: 'TMDB',
        url: 'https://www.themoviedb.org',
        requiresKey: false,
        note: 'Fallback artwork from The Movie Database. No configuration needed.',
      };
    }
    if (service === 'imdb') {
      return {
        name: 'IMDb',
        url: 'https://www.imdb.com',
        requiresKey: false,
        note: 'Artwork directly from IMDb. No configuration needed.',
      };
    }
    if (service === 'tvdb') {
      return {
        name: 'TVDB',
        url: 'https://thetvdb.com',
        requiresKey: true,
        note: 'High-quality fallback artwork from TheTVDB.',
      };
    }
    if (service === 'fanart') {
      return {
        name: 'Fanart.tv',
        url: 'https://fanart.tv',
        requiresKey: true,
        note: 'Community artwork provider for posters, backdrops, logos, and landscape art.',
      };
    }
    if (service === 'rpdb') {
      return {
        name: 'RPDB',
        url: 'https://ratingposterdb.com',
        requiresKey: true,
        note: 'Rating Poster Database with custom posters, plus paid backdrops and logos.',
      };
    }
    if (service === 'topPosters') {
      return {
        name: 'Top Posters',
        url: 'https://api.top-streaming.stream',
        requiresKey: true,
        note: 'Supports posters and logos. Premium tier also supports episode thumbnails.',
      };
    }
    return null;
  };

  const serviceInfo = getServiceInfo(currentProvider);
  const isCustomService = currentProvider === 'customUrl';
  const premiumRequiredForKind = isPremiumRequiredForKind(currentProvider, artKind);
  const providerRequiresApiKey = artworkProviderRequiresApiKey(currentProvider);
  const needsApiKey = providerRequiresApiKey || isCustomService;
  const providerKeyConfigured = hasConfiguredProviderApiKey(
    preferences,
    artworkSettings,
    currentProvider,
    contentType,
    artKind
  );

  return (
    <div className="artwork-kind-selector">
      <div className="artwork-section-note">
        Choose where {humanTypeLabel} artwork should come from:
      </div>

      <SearchableSelect
        options={artworkServiceOptions}
        value={currentProvider}
        onChange={handleProviderChange}
        valueKey="id"
        labelKey="name"
        placeholder="Select a source"
        menuPlacement="top"
      />

      {currentProvider === 'none' && (
        <div className="artwork-section-note">{DEFAULT_PROVIDER_NOTES[artKind]}</div>
      )}

      {serviceInfo && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {serviceInfo.note}{' '}
            <a
              href={serviceInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="artwork-link"
              style={{ marginLeft: '4px' }}
            >
              Visit website <ExternalLink size={12} />
            </a>
          </div>

          {providerRequiresApiKey && !providerKeyConfigured && (
            <div
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-warning)',
                padding: '6px 10px',
                background: 'rgba(234, 187, 0, 0.1)',
                borderRadius: '4px',
                borderLeft: '3px solid var(--text-warning)',
              }}
            >
              ⚠️ Requires an API key. Configure this in the <strong>API Keys</strong> section below.
            </div>
          )}

          {providerRequiresApiKey && providerKeyConfigured && (
            <div
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-success)',
                padding: '6px 10px',
                background: 'rgba(74, 222, 128, 0.12)',
                borderRadius: '4px',
                borderLeft: '3px solid var(--text-success)',
              }}
            >
              ✓ API key detected for {serviceInfo?.name || currentProvider}.
            </div>
          )}

          {premiumRequiredForKind && (
            <div
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-warning)',
                padding: '6px 10px',
                background: 'rgba(234, 187, 0, 0.1)',
                borderRadius: '4px',
                borderLeft: '3px solid var(--text-warning)',
              }}
            >
              ⚠️ {serviceInfo?.name || 'This provider'} requires a <strong>paid key</strong> for
              this artwork type. Free/default keys will not unlock this kind.
            </div>
          )}
        </div>
      )}

      {needsApiKey && (
        <>
          {isCustomService && (
            <div className="artwork-input-group">
              <label
                htmlFor={`${contentType}-${artKind}-custom-url`}
                className="artwork-input-label"
              >
                Custom URL Pattern
              </label>
              <input
                id={`${contentType}-${artKind}-custom-url`}
                type="text"
                className="input"
                placeholder={
                  artKind === 'episode'
                    ? 'https://example.com/{imdb_id}/s{season}e{episode}.jpg'
                    : 'https://example.com/{type}/{imdb_id}.jpg'
                }
                value={customUrlPattern}
                onChange={(e) => updateValue({ customUrlPattern: e.target.value })}
              />
              <div className="artwork-placeholders-note">
                Placeholders: {'{asset}'}, {'{type}'}, {'{imdb_id}'}, {'{tmdb_id}'}, {'{rating_id}'}
                , {'{rating_id_type}'}, {'{season}'}, {'{episode}'}, {'{season_number}'},{' '}
                {'{episode_number}'}, {'{api_key}'}, {'{api_key_urlencoded}'}, {'{language}'},{' '}
                {'{language_short}'}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Main exported component ---

export function ArtworkSettingsPanel({ preferences, onChange }) {
  const [activeContentType, setActiveContentType] = useState('movie');
  const [activeArtKind, setActiveArtKind] = useState('poster');

  const artworkSettings = ensureNewFormat(preferences);
  const isEnglishArtOnlyEnabled = Boolean(artworkSettings.englishArtOnly);
  const isOriginalLangFallbackChecked = isEnglishArtOnlyEnabled
    ? (artworkSettings.originalLangFallback ?? true)
    : false;

  const handleArtworkChange = (newSettings) => {
    onChange({
      ...preferences,
      artwork: newSettings,
    });
  };

  const handleCopyToAll = () => {
    const sourceConfig = artworkSettings[activeContentType] || {};
    const newSettings = {
      ...artworkSettings,
      movie: { ...sourceConfig },
      series: { ...sourceConfig },
      anime: { ...sourceConfig },
    };
    handleArtworkChange(newSettings);
  };

  const handleGlobalOptionChange = (key, value) => {
    handleArtworkChange({
      ...artworkSettings,
      [key]: value,
    });
  };

  return (
    <div className="artwork-settings-panel">
      {/* Content Type Tabs */}
      <div className="segmented-control artwork-segmented">
        {CONTENT_TYPES.map((ct) => (
          <button
            key={ct.id}
            onClick={() => setActiveContentType(ct.id)}
            className={`segmented-btn ${activeContentType === ct.id ? 'active' : ''}`}
          >
            {ct.label}
          </button>
        ))}
      </div>

      {/* Art Kind Tabs (nested) */}
      <div className="segmented-control segmented-control-sm artwork-segmented">
        {ART_KINDS.map((ak) => (
          <button
            key={ak.id}
            onClick={() => setActiveArtKind(ak.id)}
            className={`segmented-btn ${activeArtKind === ak.id ? 'active' : ''}`}
          >
            {ak.label}
          </button>
        ))}
      </div>

      {/* Art Kind Selector */}
      <div className="artwork-selector-container">
        <ArtKindSelector
          key={`${activeContentType}-${activeArtKind}`}
          contentType={activeContentType}
          artKind={activeArtKind}
          artworkSettings={artworkSettings}
          preferences={preferences}
          onChange={handleArtworkChange}
        />
      </div>

      {/* Copy to all content types */}
      <button
        type="button"
        className="btn btn-sm btn-secondary artwork-copy-btn"
        onClick={handleCopyToAll}
        title={`Copy ${CONTENT_TYPES.find((c) => c.id === activeContentType)?.label} artwork settings to all content types`}
      >
        <Copy size={14} />
        Copy to all content types
      </button>

      {/* Global Options */}
      <div className="artwork-global-options">
        <div className="artwork-global-title">Language Preferences</div>
        <label className="artwork-checkbox-row">
          <input
            type="checkbox"
            checked={artworkSettings.englishArtOnly || false}
            onChange={(e) => handleGlobalOptionChange('englishArtOnly', e.target.checked)}
          />
          Prefer English artwork only
        </label>
        <label
          className="artwork-checkbox-row"
          style={!isEnglishArtOnlyEnabled ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
        >
          <input
            type="checkbox"
            checked={isOriginalLangFallbackChecked}
            disabled={!isEnglishArtOnlyEnabled}
            onChange={(e) => handleGlobalOptionChange('originalLangFallback', e.target.checked)}
          />
          Fall back to original language artwork
        </label>
        <div className="artwork-section-note">
          {isEnglishArtOnlyEnabled
            ? 'When enabled, if English artwork is unavailable, the original language version will be used.'
            : 'Enable “Prefer English artwork only” to configure original-language fallback behavior.'}
        </div>
      </div>
    </div>
  );
}

// Legacy export for backward compatibility
export function ArtworkSourceSelector({ type, preferences, onChange }) {
  const artworkSettings = ensureNewFormat(preferences);
  const handleChange = (newSettings) => {
    onChange({ ...preferences, artwork: newSettings });
  };
  return (
    <ArtKindSelector
      contentType="movie"
      artKind={type}
      artworkSettings={artworkSettings}
      preferences={preferences}
      onChange={handleChange}
    />
  );
}
