import { BuyMeACoffeeButton } from '../social/BuyMeACoffeeButton.jsx';
import { KoFiButton } from '../social/KoFiButton.jsx';
import { DiscordButton, DiscordIcon } from '../social/DiscordButton.jsx';
import { Heart, Coffee, ArrowRight } from 'lucide-react';

export function Header({ stats }) {
  const isNightly = stats?.addonVariant === 'nightly';

  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <div className="logo">
            <img src="/logo.png" alt="TMDB Discover+" className="logo-image" />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1>
                  TMDB Discover<span className="plus">+</span>
                </h1>
                {isNightly && (
                  <span className="nightly-badge">Nightly</span>
                )}
              </div>
              <span className="logo-subtitle">Custom Catalogs for Stremio</span>
            </div>
          </div>

          {stats && (
            <div className="header-stats">
              <span className="stats-item">
                <strong>{stats.totalUsers.toLocaleString()}</strong> users
              </span>
              <span className="stats-divider">•</span>
              <span className="stats-item">
                <strong>{stats.totalCatalogs.toLocaleString()}</strong> catalogs
              </span>
            </div>
          )}

          <div className="header-actions">
            <div className="desktop-actions">
              {isNightly && (
                <a
                  href="https://tmdb-discover-plus.elfhosted.com/"
                  className="btn-ghost"
                  style={{
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: 'var(--text-secondary)',
                    textDecoration: 'none'
                  }}
                >
                  Switch to Stable <ArrowRight size={14} />
                </a>
              )}
              <DiscordButton />
              <BuyMeACoffeeButton />
            </div>

            <div className="mobile-actions">
              {isNightly && (
                <a
                  href="https://tmdb-discover-plus.elfhosted.com/"
                  className="btn-ghost"
                  style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 12px',
                    height: '32px',
                    color: 'var(--text-primary)',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    marginRight: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '20px'
                  }}
                >
                  Switch to Stable
                </a>
              )}
              <a
                href="https://discord.gg/uJ8CY5Et2"
                target="_blank"
                rel="noreferrer"
                className="action-icon-btn discord-btn"
                aria-label="Join our Discord"
                style={{ 
                  backgroundColor: '#5865F2',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  color: 'white'
                }}
              >
                <DiscordIcon style={{ width: '18px', height: '14px', fill: 'white' }} />
              </a>
              <a
                href="https://buymeacoffee.com/semi.column"
                target="_blank"
                rel="noreferrer"
                className="action-icon-btn bmc-btn"
                aria-label="Buy me a coffee"
              >
                <Coffee size={20} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
