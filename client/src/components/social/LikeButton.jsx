import { Heart, Download, Eye } from 'lucide-react';

/**
 * Compact number formatting for engagement counters (e.g. 1200 -> "1.2K").
 */
function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  const m = n / 1_000_000;
  return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
}

/**
 * Accessible like toggle showing a heart icon and the like count.
 *
 * The button is purely presentational: it reflects the `liked` / `likes`
 * props and fires `onToggle` on click. The parent (e.g. `useMarketplace.toggleLike`)
 * owns the optimistic update and rollback. (Requirements 15.1, 15.3)
 *
 * @param {object} props
 * @param {boolean} [props.liked]    Whether the current user has liked the entry.
 * @param {number}  [props.likes]    Current like count.
 * @param {Function} props.onToggle  Invoked when the button is activated.
 * @param {boolean} [props.disabled] Disables interaction (e.g. unauthenticated / in-flight).
 */
export function LikeButton({ liked = false, likes = 0, onToggle, disabled = false }) {
  const count = Math.max(0, Number(likes) || 0);
  const label = liked
    ? `Unlike. ${count} ${count === 1 ? 'like' : 'likes'}`
    : `Like. ${count} ${count === 1 ? 'like' : 'likes'}`;

  const handleClick = (e) => {
    e.stopPropagation();
    if (disabled) return;
    onToggle?.(e);
  };

  return (
    <button
      type="button"
      className={`like-button${liked ? ' liked' : ''}`}
      aria-pressed={liked}
      aria-label={label}
      disabled={disabled}
      onClick={handleClick}
    >
      <Heart
        className="like-button-icon"
        size={16}
        fill={liked ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
      <span className="like-button-count">{formatCount(count)}</span>
    </button>
  );
}

/**
 * Read-only engagement summary (installs / likes / views) for a marketplace entry.
 *
 * @param {object} props
 * @param {number} [props.installs]
 * @param {number} [props.likes]
 * @param {number} [props.views]
 */
export function EngagementCounters({ installs = 0, likes = 0, views = 0 }) {
  return (
    <div className="engagement-counters" aria-label="Engagement statistics">
      <span className="engagement-counter" title={`${installs} installs`}>
        <Download className="engagement-counter-icon" size={14} aria-hidden="true" />
        <span className="engagement-counter-value">{formatCount(installs)}</span>
      </span>
      <span className="engagement-counter" title={`${likes} likes`}>
        <Heart className="engagement-counter-icon" size={14} aria-hidden="true" />
        <span className="engagement-counter-value">{formatCount(likes)}</span>
      </span>
      <span className="engagement-counter" title={`${views} views`}>
        <Eye className="engagement-counter-icon" size={14} aria-hidden="true" />
        <span className="engagement-counter-value">{formatCount(views)}</span>
      </span>
    </div>
  );
}
