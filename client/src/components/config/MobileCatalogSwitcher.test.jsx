import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MobileCatalogSwitcher } from './MobileCatalogSwitcher';

const catalogs = [
  { _id: 'one', name: 'Netflix Movies', type: 'movie', source: 'tmdb' },
  { _id: 'two', name: 'Classic Science Fiction', type: 'series', source: 'imdb' },
];

it('opens inline without a dialog, searches, selects, and collapses', () => {
  const select = vi.fn();
  render(
    <MobileCatalogSwitcher
      catalogs={catalogs}
      activeCatalog={catalogs[0]}
      onSelect={select}
      onManage={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Switch catalog' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'Search catalogs' })).toHaveFocus();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'science' } });
  expect(screen.queryByRole('button', { name: /Netflix Movies/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Classic Science Fiction/ }));
  expect(select).toHaveBeenCalledWith(catalogs[1]);
  expect(screen.queryByRole('region', { name: 'Choose catalog' })).not.toBeInTheDocument();
});

it('provides management and Escape without locking document scrolling', () => {
  const manage = vi.fn();
  const previous = document.body.style.overflow;
  render(
    <MobileCatalogSwitcher
      catalogs={catalogs}
      activeCatalog={catalogs[0]}
      onSelect={vi.fn()}
      onManage={manage}
    />
  );
  const trigger = screen.getByRole('button', { name: 'Switch catalog' });
  fireEvent.click(trigger);
  expect(document.body.style.overflow).toBe(previous);
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Manage catalogs' }));
  expect(manage).toHaveBeenCalledOnce();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
