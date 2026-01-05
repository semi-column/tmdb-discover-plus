import { useState } from 'react';
import { X, Copy, Check, ExternalLink, Download } from 'lucide-react';

// eslint-disable-next-line no-unused-vars
export function InstallModal({ isOpen, onClose, installUrl, configureUrl, userId }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleInstall = () => {
    window.location.href = installUrl;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Install Your Addon</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Your configuration has been saved! Use one of these options to add your custom catalogs to Stremio.
          </p>

          {/* One-Click Install */}
          <div style={{ marginBottom: '24px' }}>
            <button 
              className="btn btn-primary w-full"
              onClick={handleInstall}
              style={{ padding: '16px 24px', fontSize: '16px' }}
            >
              <Download size={20} />
              Install to Stremio
            </button>
            <p className="text-sm text-muted text-center" style={{ marginTop: '8px' }}>
              This will open Stremio and install the addon
            </p>
          </div>

          {/* Manual Install Link */}
          <div className="install-link-box">
            <div className="install-link-label">Manual Install URL</div>
            <div className="install-link">{installUrl}</div>
            <button 
              className="btn btn-secondary btn-sm copy-button"
              onClick={() => handleCopy(installUrl)}
            >
              {copied ? (
                <>
                  <Check size={14} className="success-icon" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy URL
                </>
              )}
            </button>
          </div>

          {/* Configure Link */}
          <div className="install-link-box">
            <div className="install-link-label">Configuration URL (Bookmark this!)</div>
            <div className="install-link">{configureUrl}</div>
            <button 
              className="btn btn-secondary btn-sm copy-button"
              onClick={() => handleCopy(configureUrl)}
            >
              <Copy size={14} />
              Copy URL
            </button>
          </div>

          <div style={{ 
            background: 'rgba(124, 58, 237, 0.1)', 
            border: '1px solid var(--accent-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            marginTop: '16px'
          }}>
            <p className="text-sm">
              <strong>💡 Tip:</strong> After installing, you can always return to your configuration page to edit your catalogs. 
              Changes will automatically reflect in Stremio when you refresh.
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <a 
            href="https://web.stremio.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Open Stremio Web
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
