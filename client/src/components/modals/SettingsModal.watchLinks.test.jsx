import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';

const { preferences, setPreferences } = vi.hoisted(() => ({
  preferences: { defaultLanguage: 'en' },
  setPreferences: vi.fn(),
}));

vi.mock('../../context/AppContext', () => ({
  useCatalog: () => ({ preferences, setPreferences }),
  useTMDBData: () => ({ languages: [] }),
  useAppActions: () => ({ addToast: vi.fn(), handleLogout: vi.fn() }),
}));
vi.mock('../config/ArtworkSettingsSection', () => ({ ArtworkSettingsPanel: () => null }));
vi.mock('../config/ApiKeysSection', () => ({ ApiKeysSection: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  delete preferences.enableWatchLinks;
});

it('lets the user enable viewing links without replacing other preferences', () => {
  render(<SettingsModal isOpen onClose={vi.fn()} initialSection="watchLinks" />);
  const checkbox = screen.getByRole('checkbox', { name: 'Show viewing links in Stremio' });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  expect(setPreferences).toHaveBeenCalledExactlyOnceWith({
    defaultLanguage: 'en',
    enableWatchLinks: true,
  });
  expect(
    screen.getByText(/Only providers in catalogs filtered to Subscription alone/)
  ).toBeInTheDocument();
  expect(screen.getByText(/Links open TMDB's viewing options/)).toBeInTheDocument();
});

it('reflects and can disable a previously saved choice', () => {
  preferences.enableWatchLinks = true;
  render(<SettingsModal isOpen onClose={vi.fn()} initialSection="watchLinks" />);
  const checkbox = screen.getByRole('checkbox', { name: 'Show viewing links in Stremio' });
  expect(checkbox).toBeChecked();
  fireEvent.click(checkbox);
  expect(setPreferences).toHaveBeenCalledExactlyOnceWith({
    defaultLanguage: 'en',
    enableWatchLinks: false,
  });
});
