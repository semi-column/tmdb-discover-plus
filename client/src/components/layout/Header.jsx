import { useState } from 'react';
import { ArrowRight, Heart } from 'lucide-react';
import { DiscordIcon } from '../social/DiscordButton.jsx';
import { DonateModal } from '../modals/DonateModal';
import { DISCORD_URL } from '../../constants/links';

function CommunityActions({ onSupportClick }) {
  return (
    <>
      <a
        href={DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="header-community-btn"
        aria-label="Join Discord"
        title="Get help, updates and request features"
      >
        <DiscordIcon className="sidebar-support-icon" />
        <span>Join Discord</span>
      </a>
      <button
        type="button"
        className="header-support-btn"
        aria-label="Support the project"
        onClick={onSupportClick}
        title="Support the project"
      >
        <Heart size={14} />
        <span>Support</span>
      </button>
    </>
  );
}

export function Header({ stats }) {
  const isNightly = stats?.addonVariant === 'nightly';
  const [isDonateOpen, setIsDonateOpen] = useState(false);
  const openDonate = () => setIsDonateOpen(true);

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
              {stats && (
                <div className="mobile-header-stats" aria-label="Community statistics">
                  <span>
                    <strong>{stats.totalUsers.toLocaleString()}</strong> users
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    <strong>{stats.totalCatalogs.toLocaleString()}</strong> catalogs
                  </span>
                </div>
              )}
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
              <CommunityActions onSupportClick={openDonate} />
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
              <CommunityActions onSupportClick={openDonate} />
            </div>
          </div>
        </div>
      </div>
      <DonateModal isOpen={isDonateOpen} onClose={() => setIsDonateOpen(false)} />
    </header>
  );
}
