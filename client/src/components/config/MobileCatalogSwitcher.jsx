import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Film,
  Layers,
  List,
  Search,
  Settings2,
  Sparkles,
  Tv,
} from 'lucide-react';

const keyOf = (catalog) => String(catalog?._id || catalog?.id || catalog?.name);
const TYPE_ICONS = { movie: Film, series: Tv, anime: Sparkles, collection: Layers };

export function MobileCatalogSwitcher({
  catalogs,
  activeCatalog,
  isMarketplaceMode,
  onSelect,
  onManage,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const filtered = catalogs.filter((catalog) =>
    catalog.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus({ preventScroll: true });
    const outside = (event) => {
      if (!panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const finish = (action) => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus({ preventScroll: true });
    action();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-secondary mobile-catalog-picker"
        aria-label="Switch catalog"
        aria-expanded={open}
        aria-controls="mobile-catalog-choices"
        onClick={() => {
          setOpen(!open);
          setQuery('');
        }}
      >
        <List size={18} />
        <span>
          <small>{catalogs.length} catalogs</small>
          <strong>
            {isMarketplaceMode ? 'Marketplace' : activeCatalog?.name || 'Choose a catalog'}
          </strong>
        </span>
        <ChevronDown size={16} className={open ? 'rotate' : ''} />
      </button>
      {open && (
        <section
          ref={panelRef}
          id="mobile-catalog-choices"
          className="mobile-catalog-choices"
          aria-label="Choose catalog"
        >
          <label className="mobile-catalog-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search catalogs"
              aria-label="Search catalogs"
            />
          </label>
          <ul className="mobile-catalog-options" aria-label="Catalog choices">
            {filtered.map((catalog) => {
              const Icon = TYPE_ICONS[catalog.type] || Film;
              const selected = !isMarketplaceMode && keyOf(activeCatalog) === keyOf(catalog);
              return (
                <li key={keyOf(catalog)}>
                  <button
                    type="button"
                    className={`mobile-catalog-option ${selected ? 'selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => finish(() => onSelect(catalog))}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span>
                      <strong>{catalog.name}</strong>
                      <small>
                        {catalog.source || 'tmdb'}
                        {catalog.enabled === false ? ' · Disabled' : ''}
                      </small>
                    </span>
                    {selected && <Check size={16} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
            {!filtered.length && (
              <li className="mobile-catalog-no-results">
                {catalogs.length ? 'No matching catalogs' : 'No catalogs yet'}
              </li>
            )}
          </ul>
          <button type="button" className="mobile-catalog-manage" onClick={() => finish(onManage)}>
            <Settings2 size={17} /> Manage catalogs
          </button>
        </section>
      )}
    </>
  );
}
