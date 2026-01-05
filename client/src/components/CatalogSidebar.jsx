import { Plus, Film, Tv, Trash2, TrendingUp, Flame, Calendar, Star, Play, Radio, Sparkles } from 'lucide-react';

// Icons for preset catalog types
const presetIcons = {
  trending_day: Flame,
  trending_week: TrendingUp,
  now_playing: Play,
  upcoming: Calendar,
  airing_today: Radio,
  on_the_air: Radio,
  top_rated: Star,
  popular: Sparkles,
};

export function CatalogSidebar({ 
  catalogs, 
  activeCatalog, 
  onSelectCatalog, 
  onAddCatalog,
  onAddPresetCatalog,
  onDeleteCatalog,
  presetCatalogs = { movie: [], series: [] },
}) {
  // Check which presets are already added
  const addedPresets = new Set(
    catalogs
      .filter(c => c.filters?.listType && c.filters.listType !== 'discover')
      .map(c => `${c.type}-${c.filters.listType}`)
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h3 className="sidebar-title">Your Catalogs</h3>
        <button 
          className="btn btn-primary btn-sm"
          onClick={onAddCatalog}
          title="Add custom catalog"
        >
          <Plus size={16} />
          Custom
        </button>
      </div>

      <div className="catalog-list">
        {catalogs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Film size={32} />
            </div>
            <p>No catalogs yet</p>
            <p className="text-sm">Add a custom catalog or use presets below</p>
          </div>
        ) : (
          catalogs.map((catalog) => (
            <div
              key={catalog._id || catalog.name}
              className={`catalog-item ${activeCatalog?._id === catalog._id ? 'active' : ''}`}
              onClick={() => onSelectCatalog(catalog)}
            >
              <div className="catalog-item-icon">
                {catalog.type === 'series' ? <Tv size={20} /> : <Film size={20} />}
              </div>
              <div className="catalog-item-info">
                <div className="catalog-item-name">{catalog.name}</div>
                <div className="catalog-item-type">
                  {catalog.type === 'series' ? 'TV Shows' : 'Movies'}
                  {catalog.filters?.listType && catalog.filters.listType !== 'discover' && (
                    <span className="catalog-item-badge">Preset</span>
                  )}
                </div>
              </div>
              <div className="catalog-item-actions">
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCatalog(catalog._id);
                  }}
                  title="Delete catalog"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Preset Catalogs Section */}
      <div className="sidebar-section">
        <h4 className="sidebar-section-title">Quick Add Presets</h4>
        
        {/* Movie Presets */}
        <div className="preset-group">
          <div className="preset-group-header">
            <Film size={14} />
            <span>Movies</span>
          </div>
          <div className="preset-list">
            {(presetCatalogs.movie || []).map((preset) => {
              const isAdded = addedPresets.has(`movie-${preset.value}`);
              const IconComponent = presetIcons[preset.value] || Star;
              return (
                <button
                  key={preset.value}
                  className={`preset-item ${isAdded ? 'added' : ''}`}
                  onClick={() => !isAdded && onAddPresetCatalog('movie', preset)}
                  disabled={isAdded}
                  title={isAdded ? 'Already added' : preset.description}
                >
                  <IconComponent size={14} />
                  <span>{preset.label.replace(/^[^\s]+\s/, '')}</span>
                  {!isAdded && <Plus size={14} className="preset-add-icon" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* TV Presets */}
        <div className="preset-group">
          <div className="preset-group-header">
            <Tv size={14} />
            <span>TV Shows</span>
          </div>
          <div className="preset-list">
            {(presetCatalogs.series || []).map((preset) => {
              const isAdded = addedPresets.has(`series-${preset.value}`);
              const IconComponent = presetIcons[preset.value] || Star;
              return (
                <button
                  key={preset.value}
                  className={`preset-item ${isAdded ? 'added' : ''}`}
                  onClick={() => !isAdded && onAddPresetCatalog('series', preset)}
                  disabled={isAdded}
                  title={isAdded ? 'Already added' : preset.description}
                >
                  <IconComponent size={14} />
                  <span>{preset.label.replace(/^[^\s]+\s/, '')}</span>
                  {!isAdded && <Plus size={14} className="preset-add-icon" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
