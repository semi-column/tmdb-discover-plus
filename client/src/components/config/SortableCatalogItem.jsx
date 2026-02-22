import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Film, Tv, GripVertical, Trash2, Copy } from 'lucide-react';

export function SortableCatalogItem({ catalog, isActive, onSelect, onDelete, onDuplicate }) {
  const getCatalogKey = (cat) => String(cat?._id || cat?.id || cat?.name);
  const id = getCatalogKey(catalog);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`catalog-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={() => onSelect(catalog)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect(catalog);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="catalog-item-icon">
        {catalog.type === 'series' ? <Tv size={20} /> : <Film size={20} />}
      </div>
      <div className="catalog-item-info">
        <div className="catalog-item-name">{catalog.name}</div>
        <div className="catalog-item-type">
          {catalog.type === 'series' ? 'TV Shows' : 'Movies'}
          {catalog.source === 'imdb' && (
            <span className="catalog-item-badge catalog-item-badge--imdb">IMDb</span>
          )}
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
            onDuplicate(catalog._id);
          }}
          title="Duplicate catalog"
          type="button"
        >
          <Copy size={16} />
        </button>
        <button
          className="btn btn-ghost btn-icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(catalog._id);
          }}
          title="Delete catalog"
          type="button"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
