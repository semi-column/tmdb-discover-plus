import { useState, useEffect } from 'react';
import { Key, Loader, ArrowRight, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { api } from '../services/api';

export function ApiKeySetup({
  onLogin,
  onSelectConfig,
  skipAutoRedirect = false,
  isSessionExpired = false,
  returnUserId = null,
}) {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [multipleConfigs, setMultipleConfigs] = useState(null);

  // Check for session and handle auto-login
  useEffect(() => {
    if (skipAutoRedirect) return;

    const checkSession = async () => {
      const result = await api.verifySession();
      if (result.valid && onLogin) {
        onLogin(result.userId);
      }
    };

    checkSession();
  }, [skipAutoRedirect, onLogin]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('Please enter your TMDB API key');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await api.login(apiKey.trim(), returnUserId, rememberMe);

      if (result.multipleConfigs) {
        // User has multiple configs, show selection
        setMultipleConfigs(result.configs);
        return;
      }

      if (result.token && onLogin) {
        onLogin(result.userId);
      }
    } catch (err) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectConfig = async (selectedUserId) => {
    setLoading(true);
    setError('');

    try {
      const result = await api.selectConfig(apiKey.trim(), selectedUserId, rememberMe);
      if (result.token && onSelectConfig) {
        onSelectConfig(result.userId);
      } else if (result.token && onLogin) {
        onLogin(result.userId);
      }
    } catch (err) {
      setError(err.message || 'Failed to select configuration');
    } finally {
      setLoading(false);
    }
  };

  // Show config selection when user has multiple configs
  if (multipleConfigs) {
    return (
      <div className="setup-page">
        <div className="setup-card">
          <div className="setup-icon">
            <Key size={40} />
          </div>

          <h2>Select Configuration</h2>
          <p>You have multiple configurations. Select one to continue.</p>

          <div className="config-list" style={{ marginTop: '24px' }}>
            {multipleConfigs.map((cfg) => (
              <button
                key={cfg.userId}
                className="config-option"
                onClick={() => handleSelectConfig(cfg.userId)}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '16px',
                  marginBottom: '8px',
                  background: 'var(--surface-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <strong>{cfg.configName || 'Unnamed Configuration'}</strong>
                <br />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {cfg.catalogCount} catalogs • Updated{' '}
                  {new Date(cfg.updatedAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>

          {error && (
            <p className="error-message" style={{ marginTop: '16px' }}>
              {error}
            </p>
          )}

          <button
            className="btn btn-secondary w-full"
            onClick={() => setMultipleConfigs(null)}
            style={{ marginTop: '16px' }}
            disabled={loading}
          >
            Use Different API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-icon">
          <Key size={40} />
        </div>

        <h2>{isSessionExpired ? 'Session Expired' : 'Get Started'}</h2>
        <p>
          {isSessionExpired
            ? 'Your session has expired. Please re-enter your API key to continue.'
            : "Enter your TMDB API key to start creating custom catalogs. It's free and takes just a minute to get one."}
        </p>

        <form className="api-key-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="apiKey">TMDB API Key</label>
            <div
              className="input-wrapper"
              style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
            >
              <Key
                size={18}
                className="input-icon"
                style={{
                  position: 'absolute',
                  left: '12px',
                  pointerEvents: 'none',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                className={`input ${error ? 'error' : ''}`}
                placeholder="Enter your API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                style={{ paddingLeft: '40px', paddingRight: '40px' }}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
                title={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p className="input-hint">
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a free API key <ExternalLink size={12} style={{ verticalAlign: 'middle' }} />
              </a>
            </p>
            {error && <p className="error-message">{error}</p>}
          </div>

          <div className="input-group" style={{ marginTop: '16px' }}>
            <label
              className="checkbox-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ accentColor: 'var(--primary)' }}
              />
              Remember me for 7 days
            </label>
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader size={18} className="animate-spin" />
                Authenticating...
              </>
            ) : (
              <>
                Continue
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
