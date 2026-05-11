import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Eye, EyeOff, ShieldCheck, ShieldAlert, ExternalLink } from 'lucide-react';
import {
  validateArtworkProviderApiKey,
  getDefaultFreeArtworkApiKey,
  isDefaultFreeArtworkApiKey,
} from '../../utils/artworkValidation';
import { api } from '../../services/api';

const API_KEY_PROVIDERS = [
  {
    id: 'tvdb',
    name: 'TVDB',
    desc: 'Allows artwork resolution by TVDB ID.',
    keyUrl: 'https://thetvdb.com',
    keyUrlLabel: 'Get API key from TVDB',
  },
  {
    id: 'fanart',
    name: 'Fanart.tv',
    desc: 'Required when using Fanart.tv artwork provider.',
    keyUrl: 'https://fanart.tv',
    keyUrlLabel: 'Get API key from Fanart.tv',
  },
  {
    id: 'rpdb',
    name: 'RPDB',
    desc: 'Optional paid key. If left empty, the built-in free key is used automatically.',
    keyUrl: 'https://ratingposterdb.com',
    keyUrlLabel: 'Get paid API key from RPDB',
  },
  {
    id: 'topPosters',
    name: 'Top Posters',
    desc: 'Required when using Top Posters artwork provider.',
    keyUrl: 'https://api.top-streaming.stream',
    keyUrlLabel: 'Get API key from Top Posters',
  },
];

function ApiKeyInput({ provider, preferences, onChange }) {
  const [showKey, setShowKey] = useState(false);
  const [tvdbValidation, setTvdbValidation] = useState({
    key: '',
    state: 'idle',
    message: '',
  }); // idle, checking, valid, invalid
  const debounceRef = useRef(null);

  const savedKey = preferences?.apiKeys?.[provider.id] || '';
  const localKey = savedKey;
  // Note: We might have apiKeysEncrypted on the server, which the client can't read directly as raw text.
  // We'll show "Saved" if localKey is empty and an encrypted key exists.
  const hasEncryptedKey = Boolean(preferences?.apiKeysEncrypted?.[provider.id]);
  const defaultFreeKey = getDefaultFreeArtworkApiKey(provider.id);
  const isOptionalProvider = provider.id === 'rpdb';
  const isDefaultFreeEntered = isDefaultFreeArtworkApiKey(provider.id, localKey);

  const formatCheck = useMemo(
    () =>
      validateArtworkProviderApiKey(provider.id, localKey, {
        required: provider.id === 'tvdb',
      }),
    [provider.id, localKey]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (provider.id !== 'tvdb' || !localKey || !formatCheck.valid) {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }

    const normalizedKey = formatCheck.normalizedKey;
    debounceRef.current = setTimeout(async () => {
      setTvdbValidation({
        key: normalizedKey,
        state: 'checking',
        message: `Validating with ${provider.name}...`,
      });
      try {
        const result = await api.validateTvdbKey(normalizedKey);
        if (result && result.valid) {
          setTvdbValidation({
            key: normalizedKey,
            state: 'valid',
            message: `${provider.name} key verified successfully`,
          });
        } else {
          setTvdbValidation({
            key: normalizedKey,
            state: 'invalid',
            message: result?.error || `Rejected by ${provider.name}`,
          });
        }
      } catch (err) {
        setTvdbValidation({
          key: normalizedKey,
          state: 'invalid',
          message: err.message || 'Failed to validate',
        });
      }
    }, 750);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localKey, provider.id, provider.name, formatCheck.valid, formatCheck.normalizedKey]);

  const validation = useMemo(() => {
    if (!localKey) {
      return { state: 'idle', message: '' };
    }

    if (!formatCheck.valid) {
      return { state: 'invalid', message: formatCheck.error || 'Invalid format' };
    }

    if (provider.id !== 'tvdb') {
      return { state: 'format_valid', message: 'Key format looks valid' };
    }

    if (tvdbValidation.key === formatCheck.normalizedKey) {
      if (tvdbValidation.state === 'checking') {
        return { state: 'checking', message: tvdbValidation.message };
      }
      if (tvdbValidation.state === 'valid' || tvdbValidation.state === 'invalid') {
        return { state: tvdbValidation.state, message: tvdbValidation.message };
      }
    }

    return { state: 'format_valid', message: 'Key format looks valid' };
  }, [localKey, formatCheck, provider.id, tvdbValidation]);

  const handleChange = (e) => {
    const val = e.target.value;
    const newApiKeys = { ...(preferences?.apiKeys || {}) };
    if (val) {
      newApiKeys[provider.id] = val;
    } else {
      delete newApiKeys[provider.id];
    }
    onChange({ ...preferences, apiKeys: newApiKeys });
  };

  return (
    <div
      className="settings-row"
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="settings-row-info">
          <span className="settings-label">{provider.name}</span>
          <span className="settings-desc">{provider.desc}</span>
          {provider.keyUrl && (
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.8rem',
                color: 'var(--accent-primary)',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '4px',
                width: 'fit-content',
              }}
            >
              {provider.keyUrlLabel || 'Get API key'} <ExternalLink size={12} />
            </a>
          )}
        </div>
        {hasEncryptedKey && !localKey && (
          <span
            className="badge"
            style={{
              fontSize: '0.75rem',
              background: 'var(--bg-modifier-active)',
              padding: '2px 8px',
              borderRadius: '12px',
            }}
          >
            Saved
          </span>
        )}
      </div>
      <div>
        <div className="input-wrapper" style={{ position: 'relative' }}>
          <input
            type={showKey ? 'text' : 'password'}
            className="input"
            style={{ width: '100%', paddingRight: '40px' }}
            placeholder={
              hasEncryptedKey && !localKey
                ? '••••••••'
                : isOptionalProvider
                  ? `Optional: enter ${provider.name} paid key`
                  : `Enter ${provider.name} API Key`
            }
            value={localKey}
            onChange={handleChange}
          />
          <button
            type="button"
            className="input-toggle-btn"
            onClick={() => setShowKey(!showKey)}
            tabIndex="-1"
            style={{
              position: 'absolute',
              right: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {isOptionalProvider && !localKey && defaultFreeKey && (
          <div
            style={{
              marginTop: '6px',
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
            }}
          >
            Using default free key ({defaultFreeKey}).
          </div>
        )}
        {isOptionalProvider && isDefaultFreeEntered && (
          <div
            style={{
              marginTop: '6px',
              fontSize: '0.82rem',
              color: 'var(--text-warning)',
            }}
          >
            Free key detected. Premium-only artwork types will still require a paid key.
          </div>
        )}
        {validation.state !== 'idle' && (
          <div
            style={{
              marginTop: '6px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color:
                validation.state === 'invalid'
                  ? 'var(--text-error)'
                  : validation.state === 'valid' || validation.state === 'format_valid'
                    ? 'var(--text-success)'
                    : 'var(--text-muted)',
            }}
          >
            {validation.state === 'invalid' && <ShieldAlert size={14} />}
            {(validation.state === 'valid' || validation.state === 'format_valid') && (
              <ShieldCheck size={14} />
            )}
            {validation.state === 'checking' && (
              <div className="spinner" style={{ width: '12px', height: '12px' }}></div>
            )}
            <span>{validation.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ApiKeysSection({ preferences, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {API_KEY_PROVIDERS.map((provider) => (
        <ApiKeyInput
          key={provider.id}
          provider={provider}
          preferences={preferences}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
