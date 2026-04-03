import { SearchableSelect } from '../../../forms/SearchableSelect';

export function AnimeSeasonSelector({ season, year, onSeasonChange, onYearChange, seasonOptions }) {
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 60 }, (_, i) => {
    const y = currentYear + 1 - i;
    return { value: String(y), label: String(y) };
  });

  const safeSeasonOptions = (seasonOptions || []).map((s) => ({
    value: s.value,
    label: s.label,
  }));

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <SearchableSelect
          options={safeSeasonOptions}
          value={season || ''}
          onChange={(val) => onSeasonChange(val || undefined)}
          placeholder="Any Season"
          searchPlaceholder="Search..."
          labelKey="label"
          valueKey="value"
        />
      </div>
      <div style={{ flex: 1 }}>
        <SearchableSelect
          options={yearOptions}
          value={year ? String(year) : ''}
          onChange={(val) => onYearChange(val ? parseInt(val, 10) : undefined)}
          placeholder="Any Year"
          searchPlaceholder="Search year..."
          labelKey="label"
          valueKey="value"
        />
      </div>
    </div>
  );
}
