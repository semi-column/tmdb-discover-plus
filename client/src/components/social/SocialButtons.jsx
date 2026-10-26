import { Heart } from 'lucide-react';
import { DiscordIcon } from './DiscordButton.jsx';
import { DISCORD_URL } from '../../constants/links';

export function SocialButtons({ onDonateClick, className = '' }) {
  return (
    <div className={`sidebar-support-links ${className}`}>
      <div className="social-btn-wrapper">
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar-support-btn sidebar-support-discord"
        >
          <DiscordIcon className="sidebar-support-icon" />
          <span>Discord</span>
        </a>
      </div>

      <div className="social-btn-wrapper">
        <button onClick={onDonateClick} className="sidebar-support-btn sidebar-support-donate">
          <Heart size={14} />
          <span>Donate</span>
        </button>
      </div>
    </div>
  );
}
