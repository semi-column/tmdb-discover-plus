/* global process */
export function CreditsBanner() {
  if (process.env.NODE_ENV !== 'production') return null;

  return (
    <div className="credits-banner">
      <img
        src="https://docs.elfhosted.com/images/logo.svg"
        alt="ElfHosted"
        className="credits-banner-logo"
      />
      <div className="credits-banner-content">
        <p>
          This is the public instance of TMDB Discover+, sponsored by{' '}
          <a href="https://store.elfhosted.com/" target="_blank" rel="noreferrer">
            ElfHosted
          </a>{' '}
          ❤️ <br />
          See our FREE{' '}
          <a href="https://stremio-addons-guide.elfhosted.com" target="_blank" rel="noreferrer">
            Stremio Addons Guide
          </a>{' '}
          for more great addons and features!
        </p>
      </div>
    </div>
  );
}
