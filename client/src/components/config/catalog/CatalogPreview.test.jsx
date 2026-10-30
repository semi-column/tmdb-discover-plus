import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CatalogPreview } from './CatalogPreview';

it('opens an accessible preview, focuses close, locks scrolling, and dismisses with Escape', async () => {
  const close = vi.fn();
  const view = render(
    <CatalogPreview isModal isOpen onClose={close} loading={false} data={{ metas: [] }} />
  );
  expect(screen.getByRole('dialog', { name: 'Catalog preview' })).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Close preview' });
  await waitFor(() => expect(button).toHaveFocus());
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  view.rerender(<CatalogPreview isModal isOpen={false} onClose={close} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body.style.overflow).not.toBe('hidden');
});

it('does not close when interacting with retry or its keyboard events', () => {
  const close = vi.fn(),
    retry = vi.fn();
  render(<CatalogPreview isModal isOpen onClose={close} onRetry={retry} error="Unavailable" />);
  const button = screen.getByRole('button', { name: 'Retry' });
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});

it('keeps desktop previews inline without changing body scrolling', () => {
  const previous = document.body.style.overflow;
  render(<CatalogPreview isModal={false} loading={false} data={{ metas: [] }} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe(previous);
  expect(screen.getByText('No results found for the current filters.')).toBeInTheDocument();
});
