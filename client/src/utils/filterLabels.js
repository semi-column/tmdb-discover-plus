const toTitleCase = (text) => text.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

export const humanizeFilterValue = (value) => {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (!text.length) return '';

  return toTitleCase(
    text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
};

export const humanizeSortValue = (value) => {
  if (value === undefined || value === null) return '';

  let raw = String(value).trim();
  if (!raw.length) return '';

  let direction;

  if (raw.startsWith('-')) {
    direction = 'desc';
    raw = raw.slice(1);
  } else if (raw.startsWith('+')) {
    direction = 'asc';
    raw = raw.slice(1);
  }

  const suffixMatch = raw.match(/^(.*?)[._-](asc|desc)$/i);
  if (suffixMatch) {
    raw = suffixMatch[1];
    direction = suffixMatch[2].toLowerCase();
  }

  const fieldLabel = humanizeFilterValue(raw);
  if (!direction) return fieldLabel;

  return `${fieldLabel} (${direction === 'asc' ? 'Ascending' : 'Descending'})`;
};

export const resolveOptionLabel = (
  options,
  value,
  { valueKey = 'value', labelKey = 'label', fallbackFormatter = humanizeFilterValue } = {}
) => {
  if (value === undefined || value === null || value === '') return '';

  const match = Array.isArray(options)
    ? options.find((item) => item?.[valueKey] === value)
    : undefined;
  const label = match?.[labelKey];

  if (label !== undefined && label !== null && label !== '') {
    return String(label);
  }

  return fallbackFormatter(value);
};

export const resolveSortLabel = (options, value, config = {}) =>
  resolveOptionLabel(options, value, {
    ...config,
    fallbackFormatter: humanizeSortValue,
  });
