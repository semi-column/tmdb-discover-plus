import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useCatalog, useTMDBData } from '../../context/AppContext';
import { SearchableSelect } from '../forms/SearchableSelect';

export function GeneralSettingsSection() {
  const { preferences, setPreferences: onPreferencesChange } = useCatalog();
  const { languages = [] } = useTMDBData();
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
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                display: 'block',
              }}
            >
              Global Display & Trailer Language
            </span>
            <SearchableSelect
              options={languages}
              value={defaultLanguage}
              onChange={handleLanguageChange}
              placeholder="Default (Auto/English)"
              valueKey="iso_639_1"
              labelKey="english_name"
              aria-label="Global Display & Trailer Language"
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
