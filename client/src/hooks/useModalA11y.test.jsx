import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useModalA11y } from './useModalA11y';

function Dialog({ onClose, name = 'Test dialog' }) {
  const ref = useModalA11y(true, onClose);
  return (
    <div ref={ref} role="dialog" aria-label={name}>
      <button type="button" onKeyDown={(event) => event.stopPropagation()}>
        First {name}
      </button>
      <button type="button" onKeyDown={(event) => event.stopPropagation()}>
        Last {name}
      </button>
    </div>
  );
}

it('handles Escape despite stopped bubbling, traps focus, and restores scroll and focus', async () => {
  const onClose = vi.fn();
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const previous = document.body.style.overflow;
  const view = render(<Dialog onClose={onClose} />);
  const first = screen.getByRole('button', { name: 'First Test dialog' });
  const last = screen.getByRole('button', { name: 'Last Test dialog' });
  await waitFor(() => expect(first).toHaveFocus());
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.body.style.overflow).toBe(previous);
  expect(opener).toHaveFocus();
  opener.remove();
});

it('dismisses only the topmost dialog and keeps scrolling locked until both close', async () => {
  const outerClose = vi.fn(),
    innerClose = vi.fn();
  const outer = render(<Dialog onClose={outerClose} name="Outer" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'First Outer' })).toHaveFocus());
  const inner = render(<Dialog onClose={innerClose} name="Inner" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'First Inner' })).toHaveFocus());
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(innerClose).toHaveBeenCalledOnce();
  expect(outerClose).not.toHaveBeenCalled();
  inner.unmount();
  expect(document.body.style.overflow).toBe('hidden');
  outer.unmount();
  expect(document.body.style.overflow).not.toBe('hidden');
});

it('allows an open select inside a dialog to handle Escape first', async () => {
  const close = vi.fn(),
    dismissSelect = vi.fn();
  function SelectDialog() {
    const ref = useModalA11y(true, close);
    return (
      <div ref={ref} role="dialog" aria-label="Select dialog">
        <div className="searchable-select open">
          <input
            aria-label="Search options"
            onKeyDown={(event) => {
              if (event.key === 'Escape') dismissSelect();
            }}
          />
        </div>
      </div>
    );
  }
  render(<SelectDialog />);
  const input = screen.getByRole('textbox', { name: 'Search options' });
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(dismissSelect).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});
