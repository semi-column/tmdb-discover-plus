import { Plus, Film, Tv, Trash2, TrendingUp, Flame, Calendar, Star, Play, Radio, Sparkles, ChevronDown, GripVertical } from 'lucide-react';
import { useState, useEffect } from 'react';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

// Check if we're on mobile
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  return isMobile;
};

export function CatalogSidebar({ 
  catalogs, 
  activeCatalog, 
  onSelectCatalog, 
  onAddCatalog,
  onAddPresetCatalog,
  onDeleteCatalog,
  onReorderCatalogs,
  presetCatalogs = { movie: [], series: [] },
}) {
  const isMobile = useIsMobile();
  const [moviePresetsCollapsed, setMoviePresetsCollapsed] = useState(isMobile);
  const [tvPresetsCollapsed, setTvPresetsCollapsed] = useState(isMobile);

  // Update collapse state when screen size changes
  useEffect(() => {
    setMoviePresetsCollapsed(isMobile);
    setTvPresetsCollapsed(isMobile);
  }, [isMobile]);

  // Check which presets are already added
  const addedPresets = new Set(
    catalogs
      .filter(c => c.filters?.listType && c.filters.listType !== 'discover')
      .map(c => `${c.type}-${c.filters.listType}`)
  );

  const getCatalogKey = (catalog) => String(catalog?._id || catalog?.id || catalog?.name);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over) return;
    if (!active?.id || !over?.id) return;
    if (active.id === over.id) return;
    if (typeof onReorderCatalogs !== 'function') return;

    const oldIndex = catalogs.findIndex(c => getCatalogKey(c) === String(active.id));
    const newIndex = catalogs.findIndex(c => getCatalogKey(c) === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(catalogs, oldIndex, newIndex);
    onReorderCatalogs(reordered);
  };

  const SortableCatalogItem = ({ catalog }) => {
    const id = getCatalogKey(catalog);
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`catalog-item ${activeCatalog?._id === catalog._id ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
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
            className="btn btn-ghost btn-icon catalog-drag-handle"
            type="button"
            title="Drag to reorder"
            aria-label="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteCatalog(catalog._id);
            }}
            title="Delete catalog"
            type="button"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    );
  };

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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={catalogs.map(getCatalogKey)}
              strategy={verticalListSortingStrategy}
            >
              {catalogs.map((catalog) => (
                <SortableCatalogItem
                  key={getCatalogKey(catalog)}
                  catalog={catalog}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Preset Catalogs Section */}
      <div className="sidebar-section">
        <h4 className="sidebar-section-title">Quick Add Presets</h4>
        
        {/* Movie Presets */}
        <div className={`preset-group ${moviePresetsCollapsed ? 'collapsed' : ''}`}>
          <div 
            className="preset-group-header"
            onClick={() => setMoviePresetsCollapsed(!moviePresetsCollapsed)}
          >
            <Film size={14} />
            <span>Movies</span>
            <ChevronDown size={14} className="chevron" />
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
        <div className={`preset-group ${tvPresetsCollapsed ? 'collapsed' : ''}`}>
          <div 
            className="preset-group-header"
            onClick={() => setTvPresetsCollapsed(!tvPresetsCollapsed)}
          >
            <Tv size={14} />
            <span>TV Shows</span>
            <ChevronDown size={14} className="chevron" />
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
