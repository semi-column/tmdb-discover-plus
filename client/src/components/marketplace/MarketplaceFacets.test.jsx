import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MarketplaceFacets } from './MarketplaceFacets';
import { MARKETPLACE_TYPES } from '../../constants/marketplaceTypes';

vi.mock('../../sources', () => ({ getAllSources: () => [{ id: 'tmdb', label: 'TMDB' }] }));

it('keeps type filters icon-only with accessible names and hover labels', () => {
  const change = vi.fn();
  render(<MarketplaceFacets source={[]} onChange={change} />);
  for (const type of MARKETPLACE_TYPES) {
    const button = screen.getByRole('button', { name: type.label, exact: true });
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button).toHaveAttribute('title', type.label);
  }
  fireEvent.click(screen.getByRole('button', { name: MARKETPLACE_TYPES[0].label, exact: true }));
  expect(change).toHaveBeenCalledWith({ source: [], type: MARKETPLACE_TYPES[0].id });
});
