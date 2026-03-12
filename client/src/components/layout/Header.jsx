import { ArrowRight } from 'lucide-react';

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
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
