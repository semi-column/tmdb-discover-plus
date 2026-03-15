export type CertificateEntry = { certification?: string; order?: number };
export type CertificateRatingsByCountry = Record<string, string[]>;
export type CertificateSourceMap = Record<string, CertificateEntry[]>;

/**
 * Build a normalized country -> certification ratings map from any number of sources.
 * Each source is expected to contain country ISO code keys and certification entries.
 */
export function buildCommonCertificateRatingsByCountry(
  ...sourceMaps: CertificateSourceMap[]
): CertificateRatingsByCountry {
  const commonRatingsByCountry: CertificateRatingsByCountry = {};

  for (const sourceMap of sourceMaps) {
    for (const [countryCode, entries] of Object.entries(sourceMap || {})) {
      if (!Array.isArray(entries) || entries.length === 0) continue;

      const orderedEntries = [...entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const ratings = orderedEntries
        .map((entry) => String(entry?.certification ?? '').trim())
        .filter((rating) => rating.length > 0);

      if (ratings.length === 0) continue;

      const existingRatings = commonRatingsByCountry[countryCode] || [];
      commonRatingsByCountry[countryCode] = Array.from(new Set([...existingRatings, ...ratings]));
    }
  }

  return commonRatingsByCountry;
}
