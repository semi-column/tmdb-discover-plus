export function AnimeFormatSelector({ selected = [], options = [], onChange }) {
  const toggle = (value) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`btn btn-sm ${selected.includes(opt.value) ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => toggle(opt.value)}
          style={{ fontSize: '12px', padding: '4px 10px' }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
