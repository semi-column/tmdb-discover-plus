import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MarketplaceSortSelect } from './MarketplaceSortSelect';

it('retains a labeled native select and every existing sort option', () => {
  const change = vi.fn();
  render(<MarketplaceSortSelect value="trending" onChange={change} />);
  const select = screen.getByRole('combobox', { name: 'Sort marketplace results' });
  expect(select.tagName).toBe('SELECT');
  expect(select).toHaveValue('trending');
  expect(screen.getAllByRole('option')).toHaveLength(5);
  fireEvent.change(select, { target: { value: 'most-installed' } });
  expect(change).toHaveBeenCalledWith('most-installed');
});
