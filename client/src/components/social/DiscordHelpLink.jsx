import { DiscordIcon } from './DiscordButton.jsx';
import { DISCORD_URL } from '../../constants/links';

export function DiscordHelpLink({ text = 'Need help? Ask on Discord' }) {
  return (
    <a className="discord-help-link" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
      <DiscordIcon className="sidebar-support-icon" />
      {text}
    </a>
  );
}
