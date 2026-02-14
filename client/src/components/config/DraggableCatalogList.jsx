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
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableCatalogItem } from './SortableCatalogItem';

export function DraggableCatalogList({
  catalogs,
  activeCatalog,
  onSelectCatalog,
  onDeleteCatalog,
  onDuplicateCatalog,
  onReorderCatalogs,
  getCatalogKey,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || !active?.id || !over?.id || active.id === over.id) return;
    if (typeof onReorderCatalogs !== 'function') return;

    const oldIndex = catalogs.findIndex((c) => getCatalogKey(c) === String(active.id));
    const newIndex = catalogs.findIndex((c) => getCatalogKey(c) === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    onReorderCatalogs(arrayMove(catalogs, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={catalogs.map(getCatalogKey)} strategy={verticalListSortingStrategy}>
        {catalogs.map((catalog) => (
          <SortableCatalogItem
            key={getCatalogKey(catalog)}
            catalog={catalog}
            isActive={activeCatalog?._id === catalog._id}
            onSelect={onSelectCatalog}
            onDelete={onDeleteCatalog}
            onDuplicate={onDuplicateCatalog}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
