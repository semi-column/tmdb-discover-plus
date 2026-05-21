import { useState, useEffect } from 'react';
import { Heart, X } from 'lucide-react';
import { DiscordIcon } from './DiscordButton.jsx';

function AnimatedTooltip({ show, onClose, children, bubbleClass }) {
  const [render, setRender] = useState(show);
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    let showFrame = 0;
    let visibleFrame = 0;

    if (show) {
      showFrame = requestAnimationFrame(() => {
        setRender(true);
        visibleFrame = requestAnimationFrame(() => {
          setVisible(true);
        });
      });
    } else {
      visibleFrame = requestAnimationFrame(() => {
        setVisible(false);
      });
      // Wait for CSS transition to vanish before unmounting
      const timer = setTimeout(() => setRender(false), 300);
      return () => {
        cancelAnimationFrame(visibleFrame);
        clearTimeout(timer);
      };
    }

    return () => {
      cancelAnimationFrame(showFrame);
      cancelAnimationFrame(visibleFrame);
    };
  }, [show]);

  if (!render) return null;

  return (
    <div className={`quirky-social-bubble ${bubbleClass} ${visible ? 'is-visible' : 'is-hidden'}`}>
      <button className="quirky-social-close" onClick={onClose}>
        <X size={12} />
      </button>
      <div className="quirky-social-text">{children}</div>
      <div className="quirky-social-arrow"></div>
    </div>
  );
}

export function SocialButtons({ onDonateClick, className = '' }) {
  const [showDonateTooltip, setShowDonateTooltip] = useState(false);
  const [showDiscordTooltip, setShowDiscordTooltip] = useState(false);

  useEffect(() => {
    // Both should not be there at the same time. Show support one 3 seconds after screen loads.
    const donateShow = setTimeout(() => {
      setShowDonateTooltip(true);
    }, 3000);

    // Removed automatically 10 seconds after showing.
    const donateHide = setTimeout(() => {
      setShowDonateTooltip(false);
    }, 13000); // 3s delay + 10s visible

    // Discord one randomly pops anytime (e.g., between 15-30s)
    const randomDelay = Math.floor(Math.random() * 15000) + 15000;
    const discordTimer = setTimeout(() => {
      // Ensure donate tooltip is gone just in case
      setShowDonateTooltip(false);
      setShowDiscordTooltip(true);

      // Auto-hide Discord after 10 seconds
      setTimeout(() => setShowDiscordTooltip(false), 10000);
    }, randomDelay);

    return () => {
      clearTimeout(donateShow);
      clearTimeout(donateHide);
      clearTimeout(discordTimer);
    };
  }, []);

  return (
    <div className={`sidebar-support-links ${className}`}>
      <div className="social-btn-wrapper">
        <a
          href="https://discord.gg/X2N3btmEG2"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar-support-btn sidebar-support-discord"
          title="Join our Discord community"
        >
          <DiscordIcon className="sidebar-support-icon" />
          <span>Discord</span>
        </a>
        <AnimatedTooltip
          show={showDiscordTooltip}
          onClose={(e) => {
            e.preventDefault();
            setShowDiscordTooltip(false);
          }}
          bubbleClass="discord-bubble"
        >
          Join our awesome community!
          <br />
          We don't bite! 👾
        </AnimatedTooltip>
      </div>

      <div className="social-btn-wrapper">
        <button
          onClick={onDonateClick}
          className="sidebar-support-btn sidebar-support-donate"
          title="Donate"
        >
          <Heart size={14} />
          <span>Donate</span>
        </button>
        <AnimatedTooltip
          show={showDonateTooltip}
          onClose={(e) => {
            e.stopPropagation();
            setShowDonateTooltip(false);
          }}
          bubbleClass="donate-bubble"
        >
          Support me if you like my work! ☕️
        </AnimatedTooltip>
      </div>
    </div>
  );
}
