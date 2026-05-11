import { useState } from 'react';
import { ChevronDown, Image, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useCatalog } from '../../context/AppContext';

const ARTWORK_SETTINGS = [
  {
    key: 'poster',
    label: 'Poster',
    serviceField: 'posterService',
    apiKeyField: 'posterApiKey',
    encryptedField: 'posterApiKeyEncrypted',
    customPatternField: 'posterCustomUrlPattern',
  },
  {
    key: 'backdrop',
    label: 'Backdrop',
    serviceField: 'backdropService',
    apiKeyField: 'backdropApiKey',
    encryptedField: 'backdropApiKeyEncrypted',
    customPatternField: 'backdropCustomUrlPattern',
  },
  {
    key: 'logo',
    label: 'Logo',
    serviceField: 'logoService',
    apiKeyField: 'logoApiKey',
    encryptedField: 'logoApiKeyEncrypted',
    customPatternField: 'logoCustomUrlPattern',
  },
];

export function PosterSettingsSection() {
  const { preferences, setPreferences: onPreferencesChange } = useCatalog();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showApiKeyByArt, setShowApiKeyByArt] = useState({
    poster: false,
    backdrop: false,
    logo: false,
  });
  const [apiKeyInputByArt, setApiKeyInputByArt] = useState({
    poster: '',
    backdrop: '',
    logo: '',
  });

  const handleServiceChange = (setting, newService) => {
    onPreferencesChange({
      ...preferences,
      [setting.serviceField]: newService,
      ...(newService === 'none' && {
        [setting.apiKeyField]: undefined,
        [setting.encryptedField]: undefined,
      }),
    });
    setApiKeyInputByArt((prev) => ({ ...prev, [setting.key]: '' }));
  };

  const handleApiKeyChange = (setting, e) => {
    const newKey = e.target.value;
    setApiKeyInputByArt((prev) => ({ ...prev, [setting.key]: newKey }));
    onPreferencesChange({
      ...preferences,
      [setting.apiKeyField]: newKey || undefined,
    });
  };

  const handleCustomPatternChange = (setting, e) => {
    onPreferencesChange({
      ...preferences,
      [setting.customPatternField]: e.target.value,
    });
  };

  const getServiceInfo = (service) => {
    if (service === 'rpdb') return { name: 'RPDB', url: 'https://ratingposterdb.com' };
    if (service === 'fanart') return { name: 'Fanart.tv', url: 'https://fanart.tv' };
    if (service === 'topPosters') {
      return { name: 'Top Posters', url: 'https://api.top-streaming.stream' };
    }
    return null;
  };

  return (
    <div className="sidebar-section poster-settings">
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
      >
        <Image size={14} className="text-muted" />
        <span className="sidebar-section-title">Artwork Sources</span>
        <ChevronDown
          size={14}
          className={`text-muted poster-settings-chevron${isCollapsed ? ' collapsed' : ''}`}
        />
      </div>

      {!isCollapsed && (
        <div className="poster-settings-body">
          {ARTWORK_SETTINGS.map((setting) => {
            const service = preferences?.[setting.serviceField] || 'none';
            const isCustomService = service === 'customUrl';
            const hasApiKey = Boolean(preferences?.[setting.encryptedField]);
            const apiKeyInput = apiKeyInputByArt[setting.key] || '';
            const customPattern = preferences?.[setting.customPatternField] || '';
            const serviceInfo = getServiceInfo(service);

            return (
              <div key={setting.key} className="input-group poster-settings-service-group">
                <label htmlFor={`${setting.key}-service`} className="poster-settings-label">
                  {setting.label} Source
                </label>
                <select
                  id={`${setting.key}-service`}
                  className="input poster-settings-select"
                  value={service}
                  onChange={(e) => handleServiceChange(setting, e.target.value)}
                >
                  <option value="none">Default (Provider Metadata)</option>
                  <option value="rpdb">RPDB</option>
                  <option value="fanart">Fanart.tv</option>
                  <option value="topPosters">Top Posters</option>
                  <option value="customUrl">Custom URL Pattern</option>
                </select>

                {service !== 'none' && (
                  <>
                    <label htmlFor={`${setting.key}-api-key`} className="poster-settings-label">
                      {isCustomService ? 'API Key (optional)' : 'API Key'}{' '}
                      {hasApiKey && !apiKeyInput && (
                        <span className="poster-settings-status">(set)</span>
                      )}
                    </label>
                    <div className="poster-settings-input-wrapper">
                      <input
                        id={`${setting.key}-api-key`}
                        type={showApiKeyByArt[setting.key] ? 'text' : 'password'}
                        className="input poster-settings-input"
                        placeholder={
                          hasApiKey
                            ? '••••••••'
                            : isCustomService
                              ? 'Optional (for {api_key} placeholder)'
                              : 'Enter API key'
                        }
                        value={apiKeyInput}
                        onChange={(e) => handleApiKeyChange(setting, e)}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowApiKeyByArt((prev) => ({
                            ...prev,
                            [setting.key]: !prev[setting.key],
                          }))
                        }
                        className="poster-settings-toggle-visibility"
                        title={showApiKeyByArt[setting.key] ? 'Hide' : 'Show'}
                      >
                        {showApiKeyByArt[setting.key] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>

                    {serviceInfo ? (
                      <p className="poster-settings-hint">
                        Get key from{' '}
                        <a
                          href={serviceInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="poster-settings-link"
                        >
                          {serviceInfo.name}{' '}
                          <ExternalLink size={10} className="poster-settings-link-icon" />
                        </a>
                      </p>
                    ) : null}

                    {isCustomService && (
                      <>
                        <label
                          htmlFor={`${setting.key}-custom-pattern`}
                          className="poster-settings-label"
                        >
                          Custom URL Pattern
                        </label>
                        <input
                          id={`${setting.key}-custom-pattern`}
                          type="text"
                          className="input poster-settings-input"
                          placeholder="https://example.com/{asset}/{rating_id}.jpg"
                          value={customPattern}
                          onChange={(e) => handleCustomPatternChange(setting, e)}
                        />
                        <p className="poster-settings-hint">
                          Placeholders: {'{asset}'}, {'{type}'}, {'{imdb_id}'}, {'{tmdb_id}'},{' '}
                          {'{rating_id}'}, {'{rating_id_type}'}, {'{api_key}'},{' '}
                          {'{api_key_urlencoded}'}, {'{language}'}, {'{language_short}'}
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
