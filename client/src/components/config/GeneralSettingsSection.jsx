import { useState } from 'react';
import { ChevronDown, Eye, EyeOff, Sparkles, Loader, Check, X } from 'lucide-react';
import { useCatalog, useTMDBData } from '../../context/AppContext';
import { SearchableSelect } from '../forms/SearchableSelect';
import { validateGeminiKey } from '../../services/gemini';

export function GeneralSettingsSection() {
  const { preferences, setPreferences: onPreferencesChange } = useCatalog();
  const { languages = [] } = useTMDBData();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [geminiValidating, setGeminiValidating] = useState(false);
  const [geminiKeyStatus, setGeminiKeyStatus] = useState(null);

  const hasGeminiKey = Boolean(localStorage.getItem('gemini-api-key'));
  const defaultLanguage = preferences?.defaultLanguage || '';

  const handleLanguageChange = (val) => {
    onPreferencesChange({
      ...preferences,
      defaultLanguage: val,
    });
  };

  const handleGeminiKeyChange = (e) => {
    setGeminiKeyInput(e.target.value);
    setGeminiKeyStatus(null);
  };

  const handleGeminiKeyValidate = async () => {
    const key = geminiKeyInput.trim() || localStorage.getItem('gemini-api-key');
    if (!key) return;
    setGeminiValidating(true);
    try {
      const result = await validateGeminiKey(key);
      setGeminiKeyStatus(result);
      if (result.valid && geminiKeyInput.trim()) {
        localStorage.setItem('gemini-api-key', geminiKeyInput.trim());
        setGeminiKeyInput('');
      }
    } finally {
      setGeminiValidating(false);
    }
  };

  const handleGeminiKeyRemove = () => {
    localStorage.removeItem('gemini-api-key');
    setGeminiKeyInput('');
    setGeminiKeyStatus(null);
  };

  return (
    <div className="sidebar-section general-settings" style={{ marginBottom: '12px' }}>
      <div
        className="sidebar-section-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsCollapsed(!isCollapsed);
          }
        }}
        role="button"
        tabIndex={0}
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

          <div className="input-group" style={{ marginTop: '16px' }}>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Sparkles size={12} />
              AI Catalog Assistant (Gemini)
              {hasGeminiKey && !geminiKeyInput && (
                <span style={{ color: '#22c55e', fontSize: '11px' }}>(set)</span>
              )}
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  className="input"
                  placeholder={hasGeminiKey ? '••••••••' : 'Enter Gemini API key'}
                  value={geminiKeyInput}
                  onChange={handleGeminiKeyChange}
                  style={{ paddingRight: '32px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  style={{
                    position: 'absolute',
                    right: '6px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                  }}
                  title={showGeminiKey ? 'Hide' : 'Show'}
                >
                  {showGeminiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleGeminiKeyValidate}
                disabled={geminiValidating}
                title="Validate API key"
                style={{ minWidth: '70px' }}
              >
                {geminiValidating ? <Loader size={12} className="animate-spin" /> : 'Validate'}
              </button>
              {hasGeminiKey && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleGeminiKeyRemove}
                  title="Remove API key"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {geminiKeyStatus && (
              <div
                style={{
                  fontSize: '11px',
                  marginTop: '4px',
                  color: geminiKeyStatus.valid ? '#22c55e' : '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {geminiKeyStatus.valid ? <Check size={12} /> : null}
                {geminiKeyStatus.valid ? 'API key is valid' : geminiKeyStatus.error}
              </div>
            )}
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Get a free API key from Google AI Studio. Key is stored locally and never sent to our
              server.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
