import {
  Plus,
  Film,
  Tv,
  TrendingUp,
  Flame,
  Calendar,
  Star,
  Play,
  Radio,
  Sparkles,
  ChevronDown,
  Shuffle,
  Image,
  ExternalLink,
  Eye,
  EyeOff,
  Download,
  Upload as ArrowUpTrayIcon,
} from 'lucide-react';
import { useState, useEffect, lazy, Suspense, memo } from 'react';

import { useIsMobile } from '../../hooks/useIsMobile';
import { SearchableSelect } from '../forms/SearchableSelect';
import { CatalogListSkeleton } from '../layout/Skeleton';

const DraggableCatalogList = lazy(() =>
  import('./DraggableCatalogList').then((m) => ({ default: m.DraggableCatalogList }))
);

function GeneralSettingsSection({ preferences, onPreferencesChange, languages = [] }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const defaultLanguage = preferences?.defaultLanguage || '';

  const handleLanguageChange = (val) => {
    onPreferencesChange({
      ...preferences,
      defaultLanguage: val,
    });
  };

  return (
    <div className="sidebar-section general-settings" style={{ marginBottom: '12px' }}>
      <div
        className="sidebar-section-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 0',
        }}
      >
        <span className="sidebar-section-title" style={{ flex: 1, margin: 0 }}>
          General Settings
        </span>
        <ChevronDown
          size={14}
          className="text-muted"
          style={{
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </div>

      {!isCollapsed && (
        <div style={{ padding: '8px 16px 16px' }}>
          <div className="input-group">
            <label
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Global Display & Trailer Language
            </label>
            <SearchableSelect
              options={languages}
              value={defaultLanguage}
              onChange={handleLanguageChange}
              placeholder="Default (Auto/English)"
              valueKey="iso_639_1"
              labelKey="english_name"
              renderOption={(opt) => `${opt.english_name} (${opt.name})`}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Overrides language for all catalogs.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const presetIcons = {
  trending_day: Flame,
  trending_week: TrendingUp,
  now_playing: Play,
  upcoming: Calendar,
  airing_today: Radio,
  on_the_air: Radio,
  top_rated: Star,
  popular: Sparkles,
};

function PosterSettingsSection({ preferences, onPreferencesChange }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  const posterService = preferences?.posterService || 'none';
  const hasPosterKey = Boolean(preferences?.posterApiKeyEncrypted);

  const handleServiceChange = (e) => {
    const newService = e.target.value;
    onPreferencesChange({
      ...preferences,
      posterService: newService,
      ...(newService === 'none' && {
        posterApiKey: undefined,
        posterApiKeyEncrypted: undefined,
      }),
    });
    setApiKeyInput('');
  };

  const handleApiKeyChange = (e) => {
    const newKey = e.target.value;
    setApiKeyInput(newKey);
    if (newKey) {
      onPreferencesChange({
        ...preferences,
        posterApiKey: newKey,
      });
    }
  };

  const serviceUrl =
    posterService === 'rpdb'
      ? 'https://ratingposterdb.com'
      : posterService === 'topPosters'
        ? 'https://api.top-streaming.stream'
        : null;

  const serviceName =
    posterService === 'rpdb' ? 'RPDB' : posterService === 'topPosters' ? 'Top Posters' : null;

  return (
    <div className="sidebar-section poster-settings">
      <div
        className="sidebar-section-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 0',
        }}
      >
        <Image size={14} className="text-muted" />
        <span className="sidebar-section-title" style={{ flex: 1, margin: 0 }}>
          Poster Support
        </span>
        <ChevronDown
          size={14}
          className="text-muted"
          style={{
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </div>

      {!isCollapsed && (
        <div style={{ padding: '8px 16px 16px' }}>
          <div className="input-group" style={{ marginBottom: '12px' }}>
            <label
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Poster Service
            </label>
            <select
              className="input"
              value={posterService}
              onChange={handleServiceChange}
              style={{ width: '100%', fontSize: '13px' }}
            >
              <option value="none">Default (TMDB)</option>
              <option value="rpdb">RPDB (Rating Posters)</option>
              <option value="topPosters">Top Posters</option>
            </select>
          </div>

          {posterService !== 'none' && (
            <div className="input-group">
              <label
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                  display: 'block',
                }}
              >
                API Key{' '}
                {hasPosterKey && !apiKeyInput && (
                  <span style={{ color: 'var(--success)' }}>(set)</span>
                )}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="input"
                  placeholder={hasPosterKey ? '••••••••' : 'Enter API key'}
                  value={apiKeyInput}
                  onChange={handleApiKeyChange}
                  style={{ width: '100%', fontSize: '13px', paddingRight: '36px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: '4px',
                  }}
                  title={showApiKey ? 'Hide' : 'Show'}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                Get key from{' '}
                <a
                  href={serviceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--primary)' }}
                >
                  {serviceName} <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
                </a>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const CatalogSidebar = memo(function CatalogSidebar({
  catalogs,
  activeCatalog,
  onSelectCatalog,
  onAddCatalog,
  onAddPresetCatalog,
  onDeleteCatalog,
  onDuplicateCatalog,
  onReorderCatalogs,
  presetCatalogs = { movie: [], series: [] },
  configName = '',
  onConfigNameChange,
  preferences = {},
  onPreferencesChange,
  onImportConfig,
  languages = [],
  addToast,
  // IMDB props
  imdbCatalogs = [],
  activeImdbCatalog,
  onSelectImdbCatalog,
  onAddImdbPresetCatalog,
  imdbPresetCatalogs = { movie: [], series: [] },
  imdbAvailable = false,
}) {
  const safeCatalogs = Array.isArray(catalogs) ? catalogs : [];
  const safeImdbCatalogs = Array.isArray(imdbCatalogs) ? imdbCatalogs : [];
  const safePresetCatalogs =
    presetCatalogs && typeof presetCatalogs === 'object' && !Array.isArray(presetCatalogs)
      ? presetCatalogs
      : { movie: [], series: [] };
  const isMobile = useIsMobile();
  const [moviePresetsCollapsed, setMoviePresetsCollapsed] = useState(isMobile);
  const [tvPresetsCollapsed, setTvPresetsCollapsed] = useState(isMobile);
  const [catalogTab, setCatalogTab] = useState('tmdb');

  useEffect(() => {
    setMoviePresetsCollapsed(isMobile);
    setTvPresetsCollapsed(isMobile);
  }, [isMobile]);

  const addedPresets = new Set(
    safeCatalogs
      .filter((c) => c.filters?.listType && c.filters.listType !== 'discover')
      .map((c) => `${c.type}-${c.filters.listType}`)
  );

  const getCatalogKey = (catalog) => String(catalog?._id || catalog?.id || catalog?.name);

  const getPlaceholder = () => {
    if (safeCatalogs.length > 0 && safeCatalogs[0].name) {
      return safeCatalogs[0].name;
    }
    return 'Untitled Config';
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="config-name-wrapper">
          <input
            type="text"
            className="config-name-input"
            value={configName}
            onChange={(e) => onConfigNameChange && onConfigNameChange(e.target.value)}
            placeholder={getPlaceholder()}
          />
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={onAddCatalog}
          title="Add custom catalog"
        >
          <Plus size={16} />
          Add Catalog
        </button>
      </div>

      <div className="sidebar-controls" style={{ padding: '0 16px 12px 16px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, justifyContent: 'center' }}
            title="Export full configuration (catalogs + preferences)"
            onClick={() => {
              const exportData = {
                configName,
                catalogs,
                imdbCatalogs,
                preferences,
                exportedAt: new Date().toISOString(),
              };
              const dataStr = JSON.stringify(exportData, null, 2);
              const blob = new Blob([dataStr], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${(configName || 'stremio_config').replace(/\s+/g, '_')}_full.json`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} />
            <span>Export</span>
          </button>

          <label
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, justifyContent: 'center', cursor: 'pointer' }}
            title="Import full configuration"
          >
            <ArrowUpTrayIcon size={14} />
            <span>Import</span>
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                  try {
                    const imported = JSON.parse(event.target.result);
                    if (onImportConfig) onImportConfig(imported);
                  } catch (err) {
                    console.error('Import failed', err);
                    if (addToast) addToast({ message: 'Failed to parse JSON file', type: 'error' });
                  }
                  e.target.value = '';
                };
                reader.readAsText(file);
              }}
            />
          </label>
        </div>

        <label
          className="sidebar-checkbox"
          title="Randomize catalog order every time Stremio loads"
        >
          <input
            type="checkbox"
            checked={!!preferences?.shuffleCatalogs}
            onChange={(e) =>
              onPreferencesChange({ ...preferences, shuffleCatalogs: e.target.checked })
            }
          />
          <Shuffle size={14} />
          <span>Shuffle Catalogs</span>
        </label>

        <label
          className="sidebar-checkbox"
          title="Disable search catalogs if you want to use other addons for search"
          style={{ marginTop: '8px' }}
        >
          <input
            type="checkbox"
            checked={!!preferences?.disableSearch}
            onChange={(e) =>
              onPreferencesChange({ ...preferences, disableSearch: e.target.checked })
            }
          />
          <EyeOff size={14} />
          <span>Disable Search</span>
        </label>
      </div>

      <GeneralSettingsSection
        preferences={preferences}
        onPreferencesChange={onPreferencesChange}
        languages={languages}
      />

      <PosterSettingsSection preferences={preferences} onPreferencesChange={onPreferencesChange} />

      <div className="catalog-list">
        {imdbAvailable && (
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border)',
              marginBottom: '8px',
              padding: '0 8px',
            }}
          >
            <button
              onClick={() => {
                setCatalogTab('tmdb');
                onSelectImdbCatalog?.(null);
              }}
              style={{
                flex: 1,
                padding: '8px 0',
                background: 'none',
                border: 'none',
                borderBottom:
                  catalogTab === 'tmdb' ? '2px solid var(--primary)' : '2px solid transparent',
                color: catalogTab === 'tmdb' ? 'var(--text)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: catalogTab === 'tmdb' ? 600 : 400,
              }}
            >
              TMDB ({safeCatalogs.length})
            </button>
            <button
              onClick={() => {
                setCatalogTab('imdb');
                onSelectCatalog?.(null);
              }}
              style={{
                flex: 1,
                padding: '8px 0',
                background: 'none',
                border: 'none',
                borderBottom:
                  catalogTab === 'imdb' ? '2px solid var(--primary)' : '2px solid transparent',
                color: catalogTab === 'imdb' ? 'var(--text)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: catalogTab === 'imdb' ? 600 : 400,
              }}
            >
              IMDB ({(imdbCatalogs || []).length})
            </button>
          </div>
        )}

        {catalogTab === 'tmdb' ? (
          <>
            {safeCatalogs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Film size={32} />
                </div>
                <p>No catalogs yet</p>
                <p className="text-sm">Add a custom catalog or use presets below</p>
              </div>
            ) : (
              <Suspense fallback={<CatalogListSkeleton count={safeCatalogs.length || 3} />}>
                <DraggableCatalogList
                  catalogs={safeCatalogs}
                  activeCatalog={activeCatalog}
                  onSelectCatalog={onSelectCatalog}
                  onDeleteCatalog={onDeleteCatalog}
                  onDuplicateCatalog={onDuplicateCatalog}
                  onReorderCatalogs={onReorderCatalogs}
                  getCatalogKey={getCatalogKey}
                />
              </Suspense>
            )}
          </>
        ) : (
          <>
            {(imdbCatalogs || []).length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Star size={32} />
                </div>
                <p>No IMDB catalogs yet</p>
                <p className="text-sm">Add IMDB presets below</p>
              </div>
            ) : (
              <div>
                {(imdbCatalogs || []).map((cat) => {
                  const key = String(cat?._id || cat?.id || cat?.name);
                  const isActive = activeImdbCatalog?._id === cat._id;
                  return (
                    <div
                      key={key}
                      onClick={() => onSelectImdbCatalog?.(cat)}
                      style={{
                        padding: '10px 16px',
                        cursor: 'pointer',
                        background: isActive
                          ? 'var(--surface-2, rgba(255,255,255,0.08))'
                          : 'transparent',
                        borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      {cat.type === 'series' ? <Tv size={14} /> : <Film size={14} />}
                      <span style={{ flex: 1, fontSize: '13px' }}>{cat.name}</span>
                      {cat.enabled === false && (
                        <EyeOff size={12} style={{ color: 'var(--text-muted)' }} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {catalogTab === 'tmdb' && (
        <div className="sidebar-section">
          <h4 className="sidebar-section-title">Quick Add Presets</h4>

          <div className={`preset-group ${moviePresetsCollapsed ? 'collapsed' : ''}`}>
            <div
              className="preset-group-header"
              onClick={() => setMoviePresetsCollapsed(!moviePresetsCollapsed)}
            >
              <Film size={14} />
              <span>Movies</span>
              <ChevronDown size={14} className="chevron" />
            </div>
            <div className="preset-list">
              {(safePresetCatalogs.movie || []).map((preset) => {
                const isAdded = addedPresets.has(`movie-${preset.value}`);
                const IconComponent = presetIcons[preset.value] || Star;
                return (
                  <button
                    key={preset.value}
                    className={`preset-item ${isAdded ? 'added' : ''}`}
                    onClick={() => !isAdded && onAddPresetCatalog('movie', preset)}
                    disabled={isAdded}
                    title={isAdded ? 'Already added' : preset.description}
                  >
                    <IconComponent size={14} />
                    <span>{preset.label.replace(/^[^\s]+\s/, '')}</span>
                    {!isAdded && <Plus size={14} className="preset-add-icon" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`preset-group ${tvPresetsCollapsed ? 'collapsed' : ''}`}>
            <div
              className="preset-group-header"
              onClick={() => setTvPresetsCollapsed(!tvPresetsCollapsed)}
            >
              <Tv size={14} />
              <span>TV Shows</span>
              <ChevronDown size={14} className="chevron" />
            </div>
            <div className="preset-list">
              {(safePresetCatalogs.series || []).map((preset) => {
                const isAdded = addedPresets.has(`series-${preset.value}`);
                const IconComponent = presetIcons[preset.value] || Star;
                return (
                  <button
                    key={preset.value}
                    className={`preset-item ${isAdded ? 'added' : ''}`}
                    onClick={() => !isAdded && onAddPresetCatalog('series', preset)}
                    disabled={isAdded}
                    title={isAdded ? 'Already added' : preset.description}
                  >
                    <IconComponent size={14} />
                    <span>{preset.label.replace(/^[^\s]+\s/, '')}</span>
                    {!isAdded && <Plus size={14} className="preset-add-icon" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {catalogTab === 'imdb' && imdbAvailable && (
        <div className="sidebar-section">
          <h4 className="sidebar-section-title">IMDB Quick Add</h4>
          <div className={`preset-group`}>
            <div className="preset-group-header" style={{ cursor: 'default' }}>
              <Film size={14} />
              <span>Movies</span>
            </div>
            <div className="preset-list">
              {(imdbPresetCatalogs.movie || []).map((preset) => {
                const isAdded = safeImdbCatalogs.some(
                  (c) => c.name === preset.config?.name && c.type === 'movie'
                );
                return (
                  <button
                    key={preset.value}
                    className={`preset-item ${isAdded ? 'added' : ''}`}
                    onClick={() => !isAdded && onAddImdbPresetCatalog?.('movie', preset)}
                    disabled={isAdded}
                    title={isAdded ? 'Already added' : preset.description}
                  >
                    <Star size={14} />
                    <span>{preset.label.replace(/^[^\s]+\s/, '')}</span>
                    {!isAdded && <Plus size={14} className="preset-add-icon" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={`preset-group`}>
            <div className="preset-group-header" style={{ cursor: 'default' }}>
              <Tv size={14} />
              <span>TV Shows</span>
            </div>
            <div className="preset-list">
              {(imdbPresetCatalogs.series || []).map((preset) => {
                const isAdded = safeImdbCatalogs.some(
                  (c) => c.name === preset.config?.name && c.type === 'series'
                );
                return (
                  <button
                    key={preset.value}
                    className={`preset-item ${isAdded ? 'added' : ''}`}
                    onClick={() => !isAdded && onAddImdbPresetCatalog?.('series', preset)}
                    disabled={isAdded}
                    title={isAdded ? 'Already added' : preset.description}
                  >
                    <Star size={14} />
                    <span>{preset.label.replace(/^[^\s]+\s/, '')}</span>
                    {!isAdded && <Plus size={14} className="preset-add-icon" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
});
