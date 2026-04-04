export function AnimeFormatSelector({ selected = [], options = [], onChange }) {
  const toggle = (value) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="imdb-chip-wrap">
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            className={`genre-chip ${isSelected ? 'selected' : ''}`}
            onClick={() => toggle(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
