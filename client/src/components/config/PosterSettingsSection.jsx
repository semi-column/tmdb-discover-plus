import { useState } from 'react';
import { ChevronDown, Image, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useCatalog } from '../../context/AppContext';

export function PosterSettingsSection() {
  const { preferences, setPreferences: onPreferencesChange } = useCatalog();
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
