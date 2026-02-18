/**
 * Resolve dynamic date presets to actual dates.
 * This allows "Last 30 days" to always mean 30 days from NOW.
 * @param {Object} filters - The filters object containing datePreset
 * @param {string} type - 'movie' or 'series'/'tv'
 * @returns {Object} - Filters with resolved date values
 */
export function resolveDynamicDatePreset(
  filters: Record<string, unknown> | null | undefined,
  type: string
): Record<string, unknown> {
  if (!filters?.datePreset) {
    return filters || {};
  }

  const resolved: Record<string, unknown> = { ...filters };
  const today = new Date();
  const formatDate = (d: Date): string => d.toISOString().split('T')[0]; // YYYY-MM-DD

  // Determine which date fields to set based on content type
  const isMovie = type === 'movie';
  const fromField = isMovie ? 'releaseDateFrom' : 'airDateFrom';
  const toField = isMovie ? 'releaseDateTo' : 'airDateTo';

  switch (filters.datePreset) {
    case 'last_30_days': {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);
      resolved[fromField] = formatDate(thirtyDaysAgo);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'last_90_days': {
      const ninetyDaysAgo = new Date(today);
      ninetyDaysAgo.setDate(today.getDate() - 90);
      resolved[fromField] = formatDate(ninetyDaysAgo);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'last_180_days': {
      const sixMonthsAgo = new Date(today);
      sixMonthsAgo.setDate(today.getDate() - 180);
      resolved[fromField] = formatDate(sixMonthsAgo);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'last_365_days': {
      const oneYearAgo = new Date(today);
      oneYearAgo.setDate(today.getDate() - 365);
      resolved[fromField] = formatDate(oneYearAgo);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'this_year': {
      const startOfYear = new Date(today.getFullYear(), 0, 1);
      resolved[fromField] = formatDate(startOfYear);
      resolved[toField] = formatDate(today);
      break;
    }
    case 'last_year': {
      const lastYear = today.getFullYear() - 1;
      resolved[fromField] = `${lastYear}-01-01`;
      resolved[toField] = `${lastYear}-12-31`;
      break;
    }

    case 'next_30_days': {
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + 30);
      resolved[fromField] = formatDate(today);
      resolved[toField] = formatDate(futureDate);
      break;
    }
    case 'next_90_days': {
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + 90);
      resolved[fromField] = formatDate(today);
      resolved[toField] = formatDate(futureDate);
      break;
    }
    case 'upcoming': {
      if (isMovie) {
        const sixMonthsLater = new Date(today);
        sixMonthsLater.setMonth(today.getMonth() + 6);
        resolved[fromField] = formatDate(today);
        resolved[toField] = formatDate(sixMonthsLater);
      }
      break;
    }
    case 'era_2020s': {
      resolved[fromField] = '2020-01-01';
      resolved[toField] = '2029-12-31';
      break;
    }
    case 'era_2010s': {
      resolved[fromField] = '2010-01-01';
      resolved[toField] = '2019-12-31';
      break;
    }
    case 'era_2000s': {
      resolved[fromField] = '2000-01-01';
      resolved[toField] = '2009-12-31';
      break;
    }
    case 'era_1990s': {
      resolved[fromField] = '1990-01-01';
      resolved[toField] = '1999-12-31';
      break;
    }
    case 'era_1980s': {
      resolved[fromField] = '1980-01-01';
      resolved[toField] = '1989-12-31';
      break;
    }
    default:
      // Unknown preset, ignore
      break;
  }

  delete resolved.datePreset;
  return resolved;
}
