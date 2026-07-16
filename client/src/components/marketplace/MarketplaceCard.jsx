import { Download, Eye, Heart } from 'lucide-react';
import { getAllSources } from '../../sources';
import { MARKETPLACE_TYPES } from '../../constants/marketplaceTypes';

const SOURCE_LABELS = Object.fromEntries(getAllSources().map((s) => [s.id, s.label]));
const TYPE_LABELS = Object.fromEntries(MARKETPLACE_TYPES.map((t) => [t.id, t.label]));
const MAX_GENRE_CHIPS = 4;

function formatCount(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

/**
 * MarketplaceCard renders a single marketplace result as a compact list row.
 *
 * Expects an entry shaped like MarketplaceSearchCard:
 *   { marketplaceId, name, tags, type, source, genres,
 *     engagement: { likes, installs, trendingScore } }
 *
 * Provenance/author ("by …") is intentionally omitted — there is no meaningful
 * user identity to surface. Callbacks: onPreview(entry), onInstall(entry),
 * onToggleLike(entry).
 */
export function MarketplaceCard({
  entry,
  onPreview,
  onInstall,
  onToggleLike,
  liked = false,
  installing = false,
}) {
  if (!entry) return null;

  const { name, type, source, genres = [], engagement = {} } = entry;
  const { likes = 0, installs = 0 } = engagement;

  const sourceLabel = SOURCE_LABELS[source] || source || 'Unknown';
  const typeLabel = TYPE_LABELS[type] || type;
  const visibleGenres = genres.slice(0, MAX_GENRE_CHIPS);
  const extraGenres = genres.length - visibleGenres.length;

  return (
    <div className="marketplace-row">
      <div className="marketplace-row-info">
        <div className="marketplace-row-heading">
          <span className="marketplace-row-name" title={name}>
            {name}
          </span>
          <span className="source-pill marketplace-row-source" title={`Source: ${sourceLabel}`}>
            <span className={`source-dot ${source}`} />
            {sourceLabel}
          </span>
          {typeLabel && <span className="marketplace-row-type">{typeLabel}</span>}
        </div>

        <div className="marketplace-row-meta">
          {visibleGenres.map((genre) => (
            <span key={genre} className="genre-chip selected marketplace-row-genre">
              {genre}
            </span>
          ))}
          {extraGenres > 0 && (
            <span
              className="genre-chip marketplace-row-genre"
              title={genres.slice(MAX_GENRE_CHIPS).join(', ')}
            >
              +{extraGenres}
            </span>
          )}
          <span className="marketplace-row-stat" title={`${installs} installs`}>
            <Download size={13} aria-hidden="true" />
            {formatCount(installs)}
          </span>
          <span className="marketplace-row-stat" title={`${likes} likes`}>
            <Heart size={13} aria-hidden="true" />
            {formatCount(likes)}
          </span>
        </div>
      </div>

      <div className="marketplace-row-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onPreview?.(entry)}
          title={`Preview ${name}`}
        >
          <Eye size={15} aria-hidden="true" />
          <span className="marketplace-action-label">Preview</span>
        </button>
        <button
          type="button"
          className={`btn btn-ghost btn-icon btn-sm marketplace-like-btn ${liked ? 'liked' : ''}`}
          onClick={() => onToggleLike?.(entry)}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike this catalog' : 'Like this catalog'}
          title={liked ? 'Unlike' : 'Like'}
        >
          <Heart size={15} aria-hidden="true" fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => onInstall?.(entry)}
          disabled={installing}
          title={`Add ${name} to your configuration`}
        >
          <Download size={15} aria-hidden="true" />
          <span className="marketplace-action-label">{installing ? 'Adding...' : 'Add'}</span>
        </button>
      </div>
    </div>
  );
}
