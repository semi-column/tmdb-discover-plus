import { BuyMeACoffeeButton } from './BuyMeACoffeeButton.jsx';
import { KoFiButton } from './KoFiButton.jsx';
import { Heart, Coffee } from 'lucide-react';

export function Header({ stats }) {
  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <div className="logo">
            <img src="/logo.png" alt="TMDB Discover+" className="logo-image" />
            <div>
              <h1>
                TMDB Discover<span className="plus">+</span>
              </h1>
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
              <KoFiButton />
              <BuyMeACoffeeButton />
            </div>

            <div className="mobile-actions">
              <a 
                href="https://ko-fi.com/semicolumn" 
                target="_blank" 
                rel="noreferrer"
                className="action-icon-btn kofi-btn"
                aria-label="Support on Ko-fi"
              >
                <img 
                  src="/Paypal.png" 
                  alt="PayPal" 
                  style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                />
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
