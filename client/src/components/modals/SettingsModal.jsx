import { createElement, useState } from 'react';
import {
  Download,
  Upload,
  EyeOff,
  Settings,
  KeyRound,
  Image as ImageIcon,
  Globe,
  Database,
  ExternalLink,
  Eye,
  ChevronDown,
} from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useCatalog, useAppActions, useTMDBData } from '../../context/AppContext';
import { SearchableSelect } from '../forms/SearchableSelect';
import { ArtworkSettingsPanel } from '../config/ArtworkSettingsSection';
import { ApiKeysSection } from '../config/ApiKeysSection';

function CollapsibleSection({ title, icon, isExpanded, onToggle, children }) {
  return (
    <div className={`settings-section ${isExpanded ? 'expanded' : ''}`}>
      <div
        className="settings-section-header"
        onClick={onToggle}
        style={{
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {icon ? createElement(icon, { size: 16 }) : null}
          <h3>{title}</h3>
        </div>
        <div
          style={{
            color: 'var(--text-muted)',
            display: 'flex',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <ChevronDown size={20} />
        </div>
      </div>
      <div className={`settings-section-content ${isExpanded ? 'expanded' : ''}`}>
        <div className="settings-section-inner">{children}</div>
      </div>
    </div>
  );
}

export function SettingsModal({
  isOpen,
  onClose,
  onShowExport,
  onImportData,
  initialSection = 'data',
}) {
  const modalRef = useModalA11y(isOpen, onClose);
  const { preferences, setPreferences: onPreferencesChange } = useCatalog();
  const { languages = [] } = useTMDBData();
  const { addToast, handleLogout } = useAppActions();

  // Only one section open at a time, default to caller-provided section.
  const [expandedSection, setExpandedSection] = useState(initialSection);

  const toggleSection = (sectionId) => {
    setExpandedSection((prev) => (prev === sectionId ? null : sectionId));
  };

  if (!isOpen) return null;

  const defaultLanguage = preferences?.defaultLanguage || '';

  const handleLanguageChange = (val) => {
    onPreferencesChange({ ...preferences, defaultLanguage: val });
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal settings-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Global Settings"
      >
        <div className="settings-modal-header">
          <div className="settings-modal-title-group">
            <Settings size={22} className="text-secondary" />
            <h2 className="modal-title m-0" style={{ fontSize: '1.15rem', fontWeight: '600' }}>
              Global Settings
            </h2>
          </div>
        </div>

        <div className="settings-modal-body">
          <CollapsibleSection
            title="Data Management"
            icon={Database}
            isExpanded={expandedSection === 'data'}
            onToggle={() => toggleSection('data')}
          >
            <div className="settings-action-grid">
              <button
                className="btn settings-action-card"
                onClick={() => {
                  onShowExport(true);
                  onClose();
                }}
              >
                <div className="sac-icon">
                  <Upload size={18} />
                </div>
                <div className="sac-text">
                  <span className="sac-title">Export Config</span>
                  <span className="sac-desc">Save catalogs to a file</span>
                </div>
              </button>

              <label className="btn settings-action-card">
                <div className="sac-icon">
                  <Download size={18} />
                </div>
                <div className="sac-text">
                  <span className="sac-title">Import Config</span>
                  <span className="sac-desc">Load from a file</span>
                </div>
                <input
                  type="file"
                  accept=".json"
                  className="hidden-file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const imported = JSON.parse(event.target.result);
                        if (
                          imported?.catalogs?.length ||
                          imported?.preferences ||
                          imported?.configName
                        ) {
                          onImportData(imported);
                          onClose();
                        } else {
                          if (addToast) addToast('No valid data found', 'error');
                        }
                      } catch {
                        if (addToast) addToast('Failed to parse file', 'error');
                      }
                      e.target.value = '';
                    };
                    reader.readAsText(file);
                  }}
                />
              </label>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="General Preferences"
            icon={Globe}
            isExpanded={expandedSection === 'general'}
            onToggle={() => toggleSection('general')}
          >
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-label">Language</span>
                  <span className="settings-desc">Global display & trailer language</span>
                </div>
                <div className="settings-row-control">
                  <div style={{ minWidth: '280px' }}>
                    <SearchableSelect
                      options={languages}
                      value={defaultLanguage}
                      onChange={handleLanguageChange}
                      placeholder="Auto / English"
                      valueKey="iso_639_1"
                      labelKey="english_name"
                      aria-label="Global Language"
                      renderOption={(opt) => `${opt.english_name} (${opt.name})`}
                    />
                  </div>
                </div>
              </div>

              <div
                className="settings-row clickable-row"
                role="button"
                tabIndex={0}
                onClick={() =>
                  onPreferencesChange({
                    ...preferences,
                    shuffleCatalogs: !preferences?.shuffleCatalogs,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPreferencesChange({
                      ...preferences,
                      shuffleCatalogs: !preferences?.shuffleCatalogs,
                    });
                  }
                }}
              >
                <div className="settings-row-info">
                  <span className="settings-label">Shuffle Catalogs</span>
                  <span className="settings-desc">Randomize the order when Stremio loads</span>
                </div>
                <div className="settings-row-control align-right">
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!!preferences?.shuffleCatalogs}
                      onChange={(e) =>
                        onPreferencesChange({ ...preferences, shuffleCatalogs: e.target.checked })
                      }
                      className="toggle-checkbox"
                    />
                    <div className="toggle-slider"></div>
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="API Keys"
            icon={KeyRound}
            isExpanded={expandedSection === 'apiKeys'}
            onToggle={() => toggleSection('apiKeys')}
          >
            <div
              className="settings-card"
              style={{ padding: '16px 20px 20px 20px', overflow: 'visible' }}
            >
              <ApiKeysSection preferences={preferences} onChange={onPreferencesChange} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Search Integrations"
            icon={Settings}
            isExpanded={expandedSection === 'search'}
            onToggle={() => toggleSection('search')}
          >
            <div className="settings-card">
              <div
                className="settings-row clickable-row"
                style={{ paddingBottom: '16px', borderBottom: 'none' }}
                role="button"
                tabIndex={0}
                onClick={() =>
                  onPreferencesChange({
                    ...preferences,
                    disableSearch: !preferences?.disableSearch,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPreferencesChange({
                      ...preferences,
                      disableSearch: !preferences?.disableSearch,
                    });
                  }
                }}
              >
                <div className="settings-row-info">
                  <span className="settings-label">Disable All Search</span>
                  <span className="settings-desc">
                    Turn off search integration across all networks
                  </span>
                </div>
                <div className="settings-row-control align-right">
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!!preferences?.disableSearch}
                      onChange={(e) =>
                        onPreferencesChange({ ...preferences, disableSearch: e.target.checked })
                      }
                      className="toggle-checkbox"
                    />
                    <div className="toggle-slider toggle-negative"></div>
                  </div>
                </div>
              </div>

              {!preferences?.disableSearch && (
                <>
                  <div
                    style={{
                      padding: '0 16px 12px',
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Select providers to add them to your Stremio search results.
                  </div>
                  <div className="settings-provider-grid">
                    {[
                      { id: 'TMDB', pref: 'disableTmdbSearch', defaultActive: true },
                      { id: 'IMDb', pref: 'disableImdbSearch', defaultActive: true },
                      { id: 'AniList', pref: 'disableAnilistSearch', defaultActive: true },
                      { id: 'MAL', pref: 'disableMalSearch', defaultActive: true },
                      { id: 'Kitsu', pref: 'disableKitsuSearch', defaultActive: true },
                      { id: 'Simkl', pref: 'disableSimklSearch', defaultActive: true },
                      { id: 'Trakt', pref: 'disableTraktSearch', defaultActive: true },
                    ].map((p) => {
                      const isActive = p.defaultActive
                        ? preferences?.[p.pref] !== true
                        : preferences?.[p.pref] === false;
                      const handleToggle = () =>
                        onPreferencesChange({ ...preferences, [p.pref]: isActive });

                      return (
                        <button
                          key={p.id}
                          className={`settings-provider-btn ${isActive ? 'active' : ''} ${p.id.toLowerCase()}-btn`}
                          onClick={handleToggle}
                        >
                          {p.id}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Artwork Sources"
            icon={ImageIcon}
            isExpanded={expandedSection === 'artwork'}
            onToggle={() => toggleSection('artwork')}
          >
            <div
              className="settings-card"
              style={{ padding: '16px 20px 20px 20px', overflow: 'visible' }}
            >
              <ArtworkSettingsPanel preferences={preferences} onChange={onPreferencesChange} />
            </div>
          </CollapsibleSection>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button
            className="btn btn-secondary"
            style={{ color: 'var(--text-error)' }}
            onClick={() => handleLogout()}
          >
            Log Out
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
