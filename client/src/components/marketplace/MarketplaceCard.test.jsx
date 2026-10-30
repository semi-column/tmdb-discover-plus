import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MarketplaceCard } from './MarketplaceCard';

vi.mock('../../sources', () => ({ getAllSources: () => [{ id: 'tmdb', label: 'TMDB' }] }));

it('retains the compact row actions and disables adding while installing', () => {
  const entry = {
    marketplaceId: 'one',
    name: 'Documentaries',
    type: 'movie',
    source: 'tmdb',
    genres: ['Documentary'],
    engagement: { likes: 1, installs: 2 },
  };
  const preview = vi.fn(),
    install = vi.fn(),
    like = vi.fn();
  const props = { entry, onPreview: preview, onInstall: install, onToggleLike: like };
  const view = render(<MarketplaceCard {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview Documentaries' }));
  fireEvent.click(screen.getByRole('button', { name: 'Like this catalog' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Documentaries to your configuration' }));
  expect(preview).toHaveBeenCalledWith(entry);
  expect(like).toHaveBeenCalledWith(entry);
  expect(install).toHaveBeenCalledWith(entry);
  view.rerender(<MarketplaceCard {...props} installing />);
  expect(screen.getByRole('button', { name: 'Adding Documentaries' })).toBeDisabled();
});
