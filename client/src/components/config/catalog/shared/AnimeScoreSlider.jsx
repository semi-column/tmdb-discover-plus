export function AnimeScoreSlider({ min = 0, max, maxValue = 100, label = 'Score', onChange }) {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <label className="text-secondary" style={{ fontSize: '12px', minWidth: '40px' }}>
        {label}
      </label>
      <input
        type="number"
        className="input"
        value={min || ''}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0, max)}
        placeholder="Min"
        min={0}
        max={maxValue}
        style={{ width: '70px', height: '32px', fontSize: '13px' }}
      />
      <span className="text-secondary">–</span>
      <input
        type="number"
        className="input"
        value={max != null ? max : ''}
        onChange={(e) => {
          const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
          onChange(min, val);
        }}
        placeholder="Max"
        min={0}
        max={maxValue}
        style={{ width: '70px', height: '32px', fontSize: '13px' }}
      />
    </div>
  );
}
