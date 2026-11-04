import { useState } from 'react';
import { Key, Loader, ArrowRight, ExternalLink, Eye, EyeOff, Download } from 'lucide-react';
import { SocialButtons } from '../social/SocialButtons.jsx';
import { DonateModal } from '../modals/DonateModal';
import { api } from '../../services/api';

export function ApiKeySetup({
  onLogin,
  isSessionExpired = false,
  returnUserId = null,
  recoveryConfigs: initialRecoveryConfigs = null,
  sessionUnavailable = false,
}) {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recoveryConfigs, setRecoveryConfigs] = useState(initialRecoveryConfigs);
  const [rememberMe, setRememberMe] = useState(true);
  const [isDonateOpen, setIsDonateOpen] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('Please enter your TMDB API key');
      return;
    }
    if (!/^[a-f0-9]+$/i.test(trimmed)) {
      setError('API key must contain only hexadecimal characters (0-9, a-f)');
      return;
    }
    if (trimmed.length !== 32) {
      setError(`API key must be 32 characters (currently ${trimmed.length})`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await api.login(apiKey.trim(), returnUserId, rememberMe);
      if (result.token && onLogin) {
        onLogin(result.userId, result.configs || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to authenticate');
      setRecoveryConfigs(err.recoveryConfigs?.length ? err.recoveryConfigs : null);
    } finally {
      setLoading(false);
    }
  };

  const downloadConfig = (config) => {
    const data = {
      exportedAt: new Date().toISOString(),
      ...(config.configName ? { configName: config.configName } : {}),
      ...(config.preferences ? { preferences: config.preferences } : {}),
      catalogs: Array.isArray(config.catalogs) ? config.catalogs : [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const name = (config.configName || config.userId || 'tmdb-discover-plus')
      .replace(/[^a-z0-9._-]+/gi, '_')
      .replace(/^_+|_+$/g, '');
    link.href = url;
    link.download = `${name || 'tmdb-discover-plus'}_export.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (sessionUnavailable) {
    return (
      <div className="setup-page">
        <div className="setup-card" role="status">
          <h2>Session temporarily unavailable</h2>
          <p>Your session is saved, but it cannot be verified right now. Please try again.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-icon">
          {recoveryConfigs?.length ? <Download size={40} /> : <Key size={40} />}
        </div>

        <h2>
          {recoveryConfigs?.length
            ? 'Your TMDB API key is invalid'
            : isSessionExpired
              ? 'Session Expired'
              : 'Get Started'}
        </h2>
        <p>
          {recoveryConfigs?.length
            ? 'Export your saved configuration below, then enter a valid API key and import the file into a new account.'
            : isSessionExpired
              ? 'Your session has expired. Please re-enter your API key to continue.'
              : "Enter your TMDB API key to start creating custom catalogs. It's free and takes just a minute to get one."}
        </p>
        {recoveryConfigs?.length > 0 && (
          <div className="api-key-form">
            {recoveryConfigs.map((config) => (
              <button
                key={config.userId}
                type="button"
                className="btn btn-primary w-full"
                onClick={() => downloadConfig(config)}
              >
                <Download size={18} />
                Export {config.configName || config.userId}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-secondary w-full"
              onClick={() => {
                setRecoveryConfigs(null);
                setError('');
                setApiKey('');
              }}
            >
              Use another API key
            </button>
          </div>
        )}

        <form className="api-key-form" onSubmit={handleSubmit} hidden={!!recoveryConfigs?.length}>
          <div className="input-group">
            <label htmlFor="apiKey">TMDB API Key</label>
            <div className="input-wrapper">
              <Key size={18} className="input-icon input-icon-overlay" />
              <input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                className={`input input-with-icons ${error ? 'error' : ''}`}
                placeholder="Enter your API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="input-toggle-btn"
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

          <div className="input-group mt-2">
            <label className="checkbox-label checkbox-flex">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ accentColor: 'var(--primary)' }}
              />
              Remember me
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

          <div className="setup-support-row">
            <SocialButtons onDonateClick={() => setIsDonateOpen(true)} />
          </div>
        </form>
      </div>
      <DonateModal isOpen={isDonateOpen} onClose={() => setIsDonateOpen(false)} />
    </div>
  );
}
