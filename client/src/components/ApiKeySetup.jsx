import { useState, useEffect } from 'react';
import { Key, Loader, ArrowRight, ExternalLink, ArrowLeft } from 'lucide-react';
import { api } from '../services/api';
import { ConfigSelector } from './ConfigSelector';

export function ApiKeySetup({ onValidKey, onSelectExistingConfig, onDeleteConfig, onInstallConfig }) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('input'); // 'input' | 'select'
  const [configs, setConfigs] = useState([]);
  const [configsLoading, setConfigsLoading] = useState(false);

  // Check if there's a stored API key and load configs
  useEffect(() => {
    const storedKey = localStorage.getItem('tmdb-stremio-apikey');
    if (storedKey) {
      setApiKey(storedKey);
      loadConfigsForKey(storedKey);
    }
  }, []);

  const loadConfigsForKey = async (key) => {
    setConfigsLoading(true);
    try {
      const configList = await api.getConfigsByApiKey(key);
      setConfigs(configList);
      if (configList.length > 0) {
        setStep('select');
      }
    } catch (err) {
      console.error('Failed to load configs:', err);
      // If loading fails, just proceed to input step
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
        // Store the API key temporarily
        localStorage.setItem('tmdb-stremio-apikey', apiKey.trim());
        
        // Check for existing configs
        setConfigsLoading(true);
        const configList = await api.getConfigsByApiKey(apiKey.trim());
        setConfigs(configList);
        
        if (configList.length > 0) {
          // Show config selection
          setStep('select');
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

  const handleSelectConfig = (userId) => {
    if (onSelectExistingConfig) {
      onSelectExistingConfig(apiKey.trim(), userId);
    }
  };

  const handleCreateNew = () => {
    onValidKey(apiKey.trim());
  };

  const handleDeleteConfig = async (userId) => {
    try {
      await api.deleteConfig(userId, apiKey.trim());
      // Remove from local list
      setConfigs(prev => prev.filter(c => c.userId !== userId));
      if (onDeleteConfig) {
        onDeleteConfig(userId);
      }
    } catch (err) {
      console.error('Failed to delete config:', err);
      throw err;
    }
  };

  const handleInstallConfig = (userId) => {
    if (onInstallConfig) {
      onInstallConfig(userId);
    }
  };

  const handleBackToInput = () => {
    setStep('input');
    setConfigs([]);
  };

  // Show config selector step
  if (step === 'select') {
    return (
      <div className="setup-page">
        <div className="setup-card setup-card-wide">
          <button 
            className="btn btn-ghost setup-back-btn"
            onClick={handleBackToInput}
          >
            <ArrowLeft size={18} />
            Change API Key
          </button>
          
          <ConfigSelector
            configs={configs}
            loading={configsLoading}
            onSelectConfig={handleSelectConfig}
            onCreateNew={handleCreateNew}
            onDeleteConfig={handleDeleteConfig}
            onInstallConfig={handleInstallConfig}
          />
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
