export function Header({ userId }) {
  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <div className="logo">
            <img src="/logo.png" alt="TMDB Discover+" className="logo-image" />
            <div>
              <h1>TMDB Discover<span className="plus">+</span></h1>
              <span className="logo-subtitle">Custom Catalogs for Stremio</span>
            </div>
          </div>
          <div className="header-actions">
            <a
              href="https://github.com/sponsors/semi-column"
              target="_blank"
              rel="noopener noreferrer"
              className="sponsor-button"
              title="Support this project"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.565 20.565 0 008 13.393a20.561 20.561 0 003.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.75.75 0 01-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5z"/>
              </svg>
              <span>Sponsor</span>
            </a>
            {userId && (
              <div className="text-sm text-muted">
                Config ID: <code style={{ color: 'var(--accent-light)' }}>{userId}</code>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
