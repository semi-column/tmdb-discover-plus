import { useState, useEffect } from 'react';

export function useWatchProviders({ type, region, getWatchProviders }) {
  const [watchProviders, setWatchProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadProviders = async () => {
      if (!region || !getWatchProviders) {
        setWatchProviders([]);
        return;
      }
      
      setLoading(true);
      setError(null);
      
      try {
        const providers = await getWatchProviders(type || 'movie', region);
        
        setWatchProviders(
          providers.map((p) => ({
            id: p.provider_id,
            name: p.provider_name,
            logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
          }))
        );
      } catch (err) {
        console.error('Failed to load providers:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    loadProviders();
  }, [type, region, getWatchProviders]);

  return { watchProviders, loading, error };
}
