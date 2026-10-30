import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InstallModal } from './InstallModal';
import { DISCORD_URL } from '../../constants/links';

it('keeps the Discord callout independent of header styles and removes the Tip', () => {
  render(
    <InstallModal isOpen onClose={vi.fn()} installUrl="https://addon.test/config/manifest.json" />
  );
  const link = screen.getByRole('link', { name: 'Join Discord' });
  expect(link).toHaveAttribute('href', DISCORD_URL);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveClass('install-community-btn');
  expect(link).not.toHaveClass('header-community-btn');
  expect(screen.queryByText(/Tip:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Stremio may cache addon data/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Install to Stremio' })).toBeInTheDocument();
});

it('still copies the manifest URL and provides the Stremio Web link', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const manifest = 'https://addon.test/config/manifest.json';
  render(<InstallModal isOpen onClose={vi.fn()} installUrl={manifest} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(manifest));
  expect(screen.getByRole('link', { name: 'Open Stremio Web' })).toHaveAttribute(
    'href',
    `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifest)}`
  );
});
