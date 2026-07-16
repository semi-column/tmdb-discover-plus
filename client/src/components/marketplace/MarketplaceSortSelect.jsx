/**
 * Allowed marketplace sort modes (Requirement 8.1).
 */
const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'most-installed', label: 'Most Installed' },
  { value: 'newest', label: 'Newest' },
  { value: 'trending', label: 'Trending' },
];

/**
 * MarketplaceSortSelect — sort-mode selector for marketplace search results.
 *
 * Exposes only the allowed sort modes: relevance, popular, most-installed,
 * newest, and trending. (Requirement 8.1)
 *
 * Props:
 *   - value: string         currently selected sort mode
 *   - onChange: (mode) => void invoked with the selected sort value
 *   - id: string            optional select id (for the associated label)
 */
export function MarketplaceSortSelect({ value = 'relevance', onChange, id = 'marketplace-sort' }) {
  return (
    <select
      id={id}
      className="select marketplace-sort-select"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      aria-label="Sort marketplace results"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
