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
  {
    id: 'trakt',
    name: 'Trakt',
    desc: 'Client ID for Trakt-powered discovery and previews.',
    keyUrl: 'https://trakt.tv/oauth/applications',
    keyUrlLabel: 'Get Client ID from Trakt',
  },
];

function ApiKeyInput({
  provider,
  preferences,
  onChange,
  sourceKeyPresent = false,
  onSourceKeyPresenceChange,
}) {
  const [showKey, setShowKey] = useState(false);
  const [traktDraftKey, setTraktDraftKey] = useState('');
  const [traktStatus, setTraktStatus] = useState({ state: 'idle', message: '' });
  const [tvdbValidation, setTvdbValidation] = useState({
    key: '',
    state: 'idle',
    message: '',
  }); // idle, checking, valid, invalid
  const debounceRef = useRef(null);
  const traktSavingRef = useRef(false);

  const isSourceBackedProvider = provider.id === 'trakt';

  const savedKey = preferences?.apiKeys?.[provider.id] || '';
  const localKey = isSourceBackedProvider ? traktDraftKey : savedKey;
  // Note: We might have apiKeysEncrypted on the server, which the client can't read directly as raw text.
  // We'll show "Saved" if localKey is empty and an encrypted key exists.
  const hasEncryptedKey = isSourceBackedProvider
    ? sourceKeyPresent
    : Boolean(preferences?.apiKeysEncrypted?.[provider.id]);
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
    if (provider.id === 'trakt') {
      if (
        traktStatus.state === 'checking' ||
        traktStatus.state === 'valid' ||
        traktStatus.state === 'invalid'
      ) {
        return traktStatus;
      }

      if (!localKey) {
        return { state: 'idle', message: '' };
      }

      if (!formatCheck.valid) {
        return { state: 'invalid', message: formatCheck.error || 'Invalid format' };
      }

      return { state: 'format_valid', message: 'Client ID format looks valid' };
    }

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
  }, [localKey, formatCheck, provider.id, tvdbValidation, traktStatus]);

  const handleTraktBlur = async () => {
    if (!isSourceBackedProvider) return;

    const normalized = String(localKey || '').trim();
    if (!normalized || traktSavingRef.current) return;

    const formatValidation = validateArtworkProviderApiKey('trakt', normalized, {
      required: true,
    });
    if (!formatValidation.valid) {
      setTraktStatus({
        state: 'invalid',
        message: formatValidation.error || 'Invalid Trakt Client ID format',
      });
      return;
    }

    traktSavingRef.current = true;
    setTraktStatus({ state: 'checking', message: 'Validating with Trakt...' });
    try {
      const validationResult = await api.validateTraktKey(formatValidation.normalizedKey);
      if (!validationResult?.valid) {
        setTraktStatus({
          state: 'invalid',
          message: validationResult?.error || 'Trakt rejected this Client ID',
        });
        return;
      }

      await api.saveSourceKey('trakt', formatValidation.normalizedKey);
      onSourceKeyPresenceChange?.(true);
      setTraktDraftKey('');
      setTraktStatus({ state: 'valid', message: 'Trakt Client ID saved successfully' });
    } catch (err) {
      setTraktStatus({
        state: 'invalid',
        message: err?.message || 'Failed to save Trakt Client ID',
      });
    } finally {
      traktSavingRef.current = false;
    }
  };

  const handleChange = (e) => {
    const val = e.target.value;
    if (isSourceBackedProvider) {
      setTraktDraftKey(val);
      if (traktStatus.state !== 'idle') {
        setTraktStatus({ state: 'idle', message: '' });
      }
      return;
    }

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
            onBlur={isSourceBackedProvider ? handleTraktBlur : undefined}
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
  const [sourceKeyPresence, setSourceKeyPresence] = useState({
    mal: false,
    simkl: false,
    trakt: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = await api.getSourceKeys();
        if (!cancelled && keys && typeof keys === 'object') {
          setSourceKeyPresence((prev) => ({
            ...prev,
            mal: Boolean(keys.mal),
            simkl: Boolean(keys.simkl),
            trakt: Boolean(keys.trakt),
          }));
        }
      } catch {
        // Keep defaults when source key status cannot be loaded.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {API_KEY_PROVIDERS.map((provider) => (
        <ApiKeyInput
          key={provider.id}
          provider={provider}
          preferences={preferences}
          onChange={onChange}
          sourceKeyPresent={provider.id === 'trakt' ? sourceKeyPresence.trakt : false}
          onSourceKeyPresenceChange={
            provider.id === 'trakt'
              ? (next) =>
                  setSourceKeyPresence((prev) => ({
                    ...prev,
                    trakt: Boolean(next),
                  }))
              : undefined
          }
        />
      ))}
    </div>
  );
}
