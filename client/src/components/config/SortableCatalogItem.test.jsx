import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SortableCatalogItem } from './SortableCatalogItem';

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null }),
}));

it('does not select a catalog when keyboard events originate from its drag handle', () => {
  const select = vi.fn();
  const catalog = { _id: 'catalog-1', name: 'Movies', type: 'movie', source: 'tmdb', filters: {} };
  render(
    <SortableCatalogItem
      catalog={catalog}
      onSelect={select}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
    />
  );
  const drag = screen.getByRole('button', { name: 'Drag to reorder' });
  fireEvent.keyDown(drag, { key: ' ' });
  fireEvent.keyDown(drag, { key: 'Enter' });
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(drag.closest('.catalog-item-main'), { key: 'Enter' });
  expect(select).toHaveBeenCalledWith(catalog);
});

it('provides bounded mobile reorder commands without selecting the catalog', () => {
  const select = vi.fn(),
    move = vi.fn();
  const catalog = { _id: 'catalog-1', name: 'Movies', type: 'movie', source: 'tmdb', filters: {} };
  render(
    <SortableCatalogItem
      catalog={catalog}
      isActive
      onSelect={select}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      onMove={move}
      canMoveUp={false}
      canMoveDown
    />
  );
  expect(screen.getByRole('button', { name: 'Move catalog up' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Move catalog down' }));
  expect(move).toHaveBeenCalledWith(1);
  expect(select).not.toHaveBeenCalled();
});
