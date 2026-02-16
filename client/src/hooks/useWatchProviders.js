import { useState, useEffect } from 'react';

export function useWatchProviders({ type, region, getWatchProviders }) {
  const [fetchedProviders, setFetchedProviders] = useState([]);
  const [fetchedKey, setFetchedKey] = useState(null);
  const [error, setError] = useState(null);

  const shouldFetch = !!(region && getWatchProviders);
  const fetchKey = shouldFetch ? `${type || 'movie'}|${region}` : null;

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
        if (!cancelled) setFetchedKey(fetchKey);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldFetch, type, region, getWatchProviders]);

  const watchProviders = shouldFetch ? fetchedProviders : [];
  const loading = shouldFetch && fetchKey !== fetchedKey;

  return { watchProviders, loading, error };
}
