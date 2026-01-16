import { BuyMeACoffeeButton } from './BuyMeACoffeeButton.jsx';

export function Header() {
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
          <div className="header-actions">
            <BuyMeACoffeeButton />
          </div>
        </div>
      </div>
    </header>
  );
}
