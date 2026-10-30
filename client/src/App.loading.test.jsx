import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { useAppController } from './hooks/useAppController';

vi.mock('./hooks/useAppController', () => ({ useAppController: vi.fn() }));
vi.mock('./services/api', () => ({ api: { getStats: () => new Promise(() => {}) } }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
});

it.each([
  { pageLoading: true, authChecked: false, referenceLoading: false },
  { pageLoading: false, authChecked: true, referenceLoading: true },
])(
  'uses the editor-first mobile loading shell during %j',
  ({ pageLoading, authChecked, referenceLoading }) => {
    useAppController.mockReturnValue({
      state: { pageLoading, userConfigs: [] },
      actions: {},
      data: { config: { authChecked }, tmdb: { loading: referenceLoading } },
    });
    const { container } = render(<App />);
    expect(container.querySelector('.app')).toHaveClass('is-builder');
    expect(screen.getByRole('status')).toHaveTextContent('Loading catalog workspace...');
    expect(
      container.querySelector('.mobile-builder-skeleton .mobile-workspace-navigation')
    ).toBeInTheDocument();
    expect(
      container.querySelector('.mobile-builder-skeleton .mobile-editor-actions')
    ).toBeInTheDocument();
    expect(container.querySelector('.sidebar')).not.toBeInTheDocument();
  }
);

it('preserves the sidebar-based reference loading layout on desktop', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useAppController.mockReturnValue({
    state: { pageLoading: false, userConfigs: [] },
    actions: {},
    data: { config: { authChecked: true }, tmdb: { loading: true } },
  });
  const { container } = render(<App />);
  expect(container.querySelector('.sidebar .catalog-list')).toBeInTheDocument();
  expect(container.querySelector('.mobile-builder-skeleton')).not.toBeInTheDocument();
});
