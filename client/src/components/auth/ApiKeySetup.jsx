import { useState } from 'react';
import { Key, Loader, ArrowRight, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { api } from '../../services/api';

export function ApiKeySetup({ onLogin, isSessionExpired = false, returnUserId = null }) {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

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
      if (result.token && onLogin) {
        onLogin(result.userId, result.configs || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

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

          <div className="input-group mt-4">
            <label className="checkbox-label checkbox-flex">
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
