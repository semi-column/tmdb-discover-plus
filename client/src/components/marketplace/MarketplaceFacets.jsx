import { useState } from 'react';
import { Film, Tv, Sparkles, Layers, Plus, X } from 'lucide-react';

/**
 * Source facets — the 7 marketplace sources (Requirement 3.5 allow-list),
 * matching the SOURCES list used in NewCatalogModal.
 */
const SOURCES = [
  { id: 'tmdb', label: 'TMDB' },
  { id: 'imdb', label: 'IMDb' },
  { id: 'anilist', label: 'AniList' },
  { id: 'mal', label: 'MAL' },
  { id: 'kitsu', label: 'Kitsu' },
  { id: 'simkl', label: 'Simkl' },
  { id: 'trakt', label: 'Trakt' },
];

/**
 * Type facets — the 4 marketplace content types (Requirement 3.4 allow-list).
 */
const TYPES = [
  { id: 'movie', label: 'Movies', Icon: Film },
  { id: 'series', label: 'Series', Icon: Tv },
  { id: 'anime', label: 'Anime', Icon: Sparkles },
  { id: 'collection', label: 'Collections', Icon: Layers },
];

/**
 * MarketplaceFacets — source/type/genre facet controls for marketplace search.
 *
 * Selecting a facet toggles it on; selecting it again clears it. Source and
 * type are single-select (one active value or undefined); genres are a
 * multi-value chip list with a free-text add input. Any change reports the
 * full next facet selection via `onChange`. (Requirement 6.2 — facets filter)
 *
 * Props:
 *   - source: string|undefined   currently selected source facet
 *   - type: string|undefined     currently selected type facet
 *   - genres: string[]           currently selected genre facets
 *   - onChange: ({ source, type, genres }) => void
 *
 * Requirements: 6.1, 6.2
 */
export function MarketplaceFacets({ source, type, genres = [], onChange }) {
  const [genreInput, setGenreInput] = useState('');

  const emit = (next) => onChange?.({ source, type, genres, ...next });

  const toggleSource = (id) => emit({ source: source === id ? undefined : id });
  const toggleType = (id) => emit({ type: type === id ? undefined : id });

  const addGenre = (raw) => {
    const value = raw.trim();
    if (!value) return;
    const exists = genres.some((g) => g.toLowerCase() === value.toLowerCase());
    if (exists) {
      setGenreInput('');
      return;
    }
    emit({ genres: [...genres, value] });
    setGenreInput('');
  };

  const removeGenre = (g) => emit({ genres: genres.filter((x) => x !== g) });

  const handleGenreKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addGenre(genreInput);
    }
  };

  return (
    <div className="marketplace-facets">
      {/* Source facets */}
      <div className="filter-group">
        <span className="filter-label">Source</span>
        <div className="source-selector">
          <button
            type="button"
            className={`source-pill ${!source ? 'active' : ''}`}
            onClick={() => emit({ source: undefined })}
            aria-pressed={!source}
            title="Search across all sources"
          >
            All sources
          </button>
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`source-pill ${source === s.id ? 'active' : ''}`}
              onClick={() => toggleSource(s.id)}
              aria-pressed={source === s.id}
            >
              <span className={`source-dot ${s.id}`} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Type facets */}
      <div className="filter-group" style={{ marginTop: '16px' }}>
        <span className="filter-label">Type</span>
        <div className="content-type-toggle" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`type-btn ${type === t.id ? 'active' : ''}`}
              onClick={() => toggleType(t.id)}
              aria-pressed={type === t.id}
            >
              <t.Icon size={16} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Genre facets */}
      <div className="filter-group" style={{ marginTop: '16px' }}>
        <span className="filter-label">Genres</span>
        <div
          className="marketplace-genre-input"
          style={{ display: 'flex', gap: '6px', marginBottom: genres.length ? '8px' : 0 }}
        >
          <input
            type="text"
            className="input"
            placeholder="Add a genre..."
            value={genreInput}
            onChange={(e) => setGenreInput(e.target.value)}
            onKeyDown={handleGenreKeyDown}
            aria-label="Add a genre facet"
          />
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => addGenre(genreInput)}
            disabled={!genreInput.trim()}
            aria-label="Add genre"
            title="Add genre"
          >
            <Plus size={16} />
          </button>
        </div>
        {genres.length > 0 && (
          <div
            className="marketplace-genre-chips"
            style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}
          >
            {genres.map((g) => (
              <button
                key={g}
                type="button"
                className="genre-chip selected"
                onClick={() => removeGenre(g)}
                aria-label={`Remove genre ${g}`}
                title={`Remove ${g}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                {g}
                <X size={12} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
