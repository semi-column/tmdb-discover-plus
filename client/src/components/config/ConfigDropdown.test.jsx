import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfigDropdown } from './ConfigDropdown';

it('retains the full configuration name and dismisses with Escape', () => {
  const name = 'My Streaming Catalogs for the Whole Family';
  render(
    <ConfigDropdown
      configs={[{ userId: 'test', configName: name, catalogs: [] }]}
      currentUserId="test"
      currentConfigName={name}
      currentCatalogs={[]}
      onSelectConfig={vi.fn()}
      onDeleteConfig={vi.fn()}
      onCreateNew={vi.fn()}
    />
  );
  const trigger = screen.getByTitle(name);
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByText(name)).toHaveLength(2);
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Your Configurations (1)')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  const outside = document.createElement('input');
  document.body.append(outside);
  outside.focus();
  fireEvent.keyDown(outside, { key: 'Escape' });
  expect(outside).toHaveFocus();
  outside.remove();
});
