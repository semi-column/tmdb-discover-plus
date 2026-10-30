import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MobileCatalogManager } from './MobileCatalogManager';

it('provides a normal management view with a focused back action, not a modal', () => {
  const close = vi.fn();
  const previous = document.body.style.overflow;
  render(
    <MobileCatalogManager onClose={close}>
      <button type="button">New Catalog</button>
    </MobileCatalogManager>
  );
  expect(screen.getByRole('region', { name: 'Manage catalogs' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe(previous);
  const back = screen.getByRole('button', { name: 'Back to workspace' });
  expect(back).toHaveFocus();
  fireEvent.click(back);
  expect(close).toHaveBeenCalledOnce();
});
