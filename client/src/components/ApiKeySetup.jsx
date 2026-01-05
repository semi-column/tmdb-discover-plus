import { useState, useEffect } from 'react';
import { Key, Loader, ArrowRight, ExternalLink } from 'lucide-react';
import { api } from '../services/api';

export function ApiKeySetup({ onValidKey, onSelectExistingConfig, skipAutoRedirect = false }) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [configsLoading, setConfigsLoading] = useState(false);

  // Check if there's a stored API key and load configs (only if not skipping auto-redirect)
  useEffect(() => {
    const storedKey = localStorage.getItem('tmdb-stremio-apikey');
    if (storedKey) {
      setApiKey(storedKey);
      // Only auto-redirect if not explicitly changing API key
      if (!skipAutoRedirect) {
        loadConfigsAndRedirect(storedKey);
      }
    }
  }, [skipAutoRedirect]);

  const loadConfigsAndRedirect = async (key) => {
    setConfigsLoading(true);
    try {
      const configList = await api.getConfigsByApiKey(key);
      if (configList.length > 0) {
        // Sort by updatedAt descending (latest first)
        configList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        // Redirect to the latest config
        const latestConfig = configList[0];
        if (onSelectExistingConfig) {
          onSelectExistingConfig(key, latestConfig.userId);
        }
      }
    } catch (err) {
      console.error('Failed to load configs:', err);
      // If loading fails, just stay on input step
    } finally {
      setConfigsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('Please enter your TMDB API key');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await api.validateApiKey(apiKey.trim());
      if (result.valid) {
        // Store the API key
        localStorage.setItem('tmdb-stremio-apikey', apiKey.trim());
        
        // Check for existing configs
        setConfigsLoading(true);
        const configList = await api.getConfigsByApiKey(apiKey.trim());
        
        if (configList.length > 0) {
          // Sort by updatedAt descending (latest first)
          configList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          // Redirect to the latest config
          const latestConfig = configList[0];
          if (onSelectExistingConfig) {
            onSelectExistingConfig(apiKey.trim(), latestConfig.userId);
          }
        } else {
          // No existing configs, create new
          onValidKey(apiKey.trim());
        }
      } else {
        setError(result.error || 'Invalid API key');
      }
    } catch (err) {
      setError(err.message || 'Failed to validate API key');
    } finally {
      setLoading(false);
      setConfigsLoading(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-icon">
          <Key size={40} />
        </div>
        
        <h2>Get Started</h2>
        <p>
          Enter your TMDB API key to start creating custom catalogs.
          It's free and takes just a minute to get one.
        </p>

        <form className="api-key-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="apiKey">TMDB API Key</label>
            <div className="input-wrapper">
              <Key size={18} className="input-icon" />
              <input
                id="apiKey"
                type="password"
                className={`input ${error ? 'error' : ''}`}
                placeholder="Enter your API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
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

          <button 
            type="submit" 
            className="btn btn-primary w-full"
            disabled={loading || configsLoading}
          >
            {loading || configsLoading ? (
              <>
                <Loader size={18} className="animate-spin" />
                {configsLoading ? 'Loading configurations...' : 'Validating...'}
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
