export function DiscordIcon({ className, style }) {
  return (
    <svg
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 127.14 96.36"
      width="20"
      height="15"
    >
      <path
        fill="currentColor"
        d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.11,77.11,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22c.63-23.28-3.67-46.94-18.9-72.15ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.25-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
      />
    </svg>
  );
}

export function DiscordButton() {
  const color = '#5865F2';
  const inviteUrl = 'https://discord.gg/uJ8CY5Et2';

  return (
    <a
      title="Join our Discord Community"
      className="discord-button"
      style={{ backgroundColor: color }}
      href={inviteUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="discord-text">
        <DiscordIcon className="discord-icon" style={{ fill: '#fff' }} />
        Discord
      </span>
      <style>{`
        .discord-button {
          box-shadow: 1px 1px 0px rgba(0, 0, 0, 0.2);
          line-height: 36px !important;
          min-width: 130px;
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          background-color: #5865F2;
          padding: 2px 12px !important;
          text-align: center !important;
          border-radius: 7px;
          color: #fff;
          cursor: pointer;
          overflow-wrap: break-word;
          vertical-align: middle;
          border: 0 none #fff !important;
          font-family: 'Quicksand', Helvetica, Century Gothic, sans-serif !important;
          text-decoration: none;
          text-shadow: none;
          font-weight: 700 !important;
          font-size: 14px !important;
          height: 36px;
        }
        .discord-button:hover {
          opacity: 0.85;
          color: #fff !important;
          text-decoration: none !important;
        }
        .discord-icon {
          display: initial;
          vertical-align: middle;
          height: 14px !important;
          width: 18px !important;
          padding: 0 !important;
          margin: 0 8px 0 0 !important;
          border: none;
        }
        .discord-text {
          color: #fff !important;
          letter-spacing: -0.15px !important;
          text-wrap: nowrap !important;
          vertical-align: middle !important;
          line-height: 33px !important;
          padding: 0 !important;
          text-align: center;
          text-decoration: none !important;
          text-shadow: 0 1px 1px rgba(34, 34, 34, 0.05);
        }
      `}</style>
    </a>
  );
}
