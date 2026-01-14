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
          {userId && (
            <div className="text-sm text-muted">
              Config ID: <code style={{ color: 'var(--accent-light)' }}>{userId}</code>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
