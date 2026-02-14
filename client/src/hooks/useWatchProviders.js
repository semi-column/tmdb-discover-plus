import { useState, useEffect } from 'react';

export function useWatchProviders({ type, region, getWatchProviders }) {
  const [fetchedProviders, setFetchedProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const shouldFetch = !!(region && getWatchProviders);

  useEffect(() => {
    if (!shouldFetch) return;

    let cancelled = false;

    getWatchProviders(type || 'movie', region)
      .then((providers) => {
        if (cancelled) return;
        setFetchedProviders(
          providers.map((p) => ({
            id: p.provider_id,
            name: p.provider_name,
            logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
          }))
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldFetch, type, region, getWatchProviders]);

  const watchProviders = shouldFetch ? fetchedProviders : [];

  return { watchProviders, loading, error };
}
