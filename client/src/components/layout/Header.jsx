import { BuyMeACoffeeButton } from '../social/BuyMeACoffeeButton.jsx';
import { DiscordButton, DiscordIcon } from '../social/DiscordButton.jsx';
import { Coffee, ArrowRight } from 'lucide-react';

export function Header({ stats }) {
  const isNightly = stats?.addonVariant === 'nightly';

  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <div className="logo">
            <img src="/logo.png" alt="TMDB Discover+" className="logo-image" />
            <div>
              <div className="header-title-row">
                <h1>
                  TMDB Discover<span className="plus">+</span>
                </h1>
                {isNightly && <span className="nightly-badge">Nightly</span>}
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
                  className="btn-ghost btn-switch-stable"
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
                  className="btn-ghost btn-switch-stable-mobile"
                >
                  Switch to Stable
                </a>
              )}
              <a
                href="https://discord.gg/uJ8CY5Et2"
                target="_blank"
                rel="noreferrer"
                className="action-icon-btn discord-btn discord-icon-circle"
                aria-label="Join our Discord"
              >
                <DiscordIcon className="discord-icon-sm" />
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
