import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ActiveFiltersBar } from './ActiveFiltersBar';

it('keeps label navigation, single-filter removal, and clear-all as separate actions', () => {
  const clear = vi.fn(),
    clearAll = vi.fn(),
    toggle = vi.fn();
  render(
    <ActiveFiltersBar
      activeFilters={[
        { key: 'sortBy', section: 'filters', label: 'Sort: Release Date (Newest)' },
        { key: 'watchProviders', section: 'streaming', label: '10 streaming service(s)' },
      ]}
      onClearFilter={clear}
      onClearAll={clearAll}
      onToggleSection={toggle}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show Sort: Release Date (Newest) section' }));
  expect(toggle).toHaveBeenCalledWith('filters');
  expect(clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove 10 streaming service(s) filter' }));
  expect(clear).toHaveBeenCalledWith('watchProviders');
  expect(toggle).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(clearAll).toHaveBeenCalledOnce();
});
