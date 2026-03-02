import { useState, useCallback } from 'react';
import { generateCatalog } from '../services/gemini';

export function useAICatalog() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [generatedCatalog, setGeneratedCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [resolutionResults, setResolutionResults] = useState(null);

  const reset = useCallback(() => {
    setIsGenerating(false);
    setIsResolving(false);
    setGeneratedCatalog(null);
    setError(null);
    setResolutionResults(null);
  }, []);

  const generateFromPrompt = useCallback(async (apiKey, userMessage, existingCatalog) => {
    setIsGenerating(true);
    setError(null);
    setGeneratedCatalog(null);
    setResolutionResults(null);

    try {
      const result = await generateCatalog(apiKey, userMessage, existingCatalog);
      setGeneratedCatalog(result);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const resolveEntities = useCallback(async (entitiesToResolve, tmdbApi, region) => {
    if (!entitiesToResolve || Object.keys(entitiesToResolve).length === 0) {
      return { filters: {}, formState: {}, warnings: [] };
    }

    setIsResolving(true);
    const warnings = [];
    const filters = {};
    const formState = {};

    try {
      if (entitiesToResolve.people?.length) {
        const resolved = [];
        for (const name of entitiesToResolve.people) {
          try {
            const results = await tmdbApi.searchPerson(name);
            const match = Array.isArray(results) ? results[0] : results?.results?.[0];
            if (match) {
              resolved.push({ id: match.id, name: match.name, profile_path: match.profile_path });
            } else {
              warnings.push(`Person not found: "${name}"`);
            }
          } catch {
            warnings.push(`Failed to look up: "${name}"`);
          }
        }
        if (resolved.length) {
          formState.selectedPeople = resolved;
          filters.withPeople = resolved.map((p) => p.id).join(',');
        }
      }

      if (entitiesToResolve.companies?.length) {
        const resolved = [];
        for (const name of entitiesToResolve.companies) {
          try {
            const results = await tmdbApi.searchCompany(name);
            const match = Array.isArray(results) ? results[0] : results?.results?.[0];
            if (match) {
              resolved.push({ id: match.id, name: match.name, logo_path: match.logo_path });
            } else {
              warnings.push(`Company not found: "${name}"`);
            }
          } catch {
            warnings.push(`Failed to look up company: "${name}"`);
          }
        }
        if (resolved.length) {
          formState.selectedCompanies = resolved;
          filters.withCompanies = resolved.map((c) => c.id).join(',');
        }
      }

      if (entitiesToResolve.excludeCompanies?.length) {
        const resolved = [];
        for (const name of entitiesToResolve.excludeCompanies) {
          try {
            const results = await tmdbApi.searchCompany(name);
            const match = Array.isArray(results) ? results[0] : results?.results?.[0];
            if (match) {
              resolved.push({ id: match.id, name: match.name, logo_path: match.logo_path });
            } else {
              warnings.push(`Company not found: "${name}"`);
            }
          } catch {
            warnings.push(`Failed to look up company: "${name}"`);
          }
        }
        if (resolved.length) {
          formState.excludeCompanies = resolved;
          filters.excludeCompanies = resolved.map((c) => c.id).join(',');
        }
      }

      if (entitiesToResolve.keywords?.length) {
        const resolved = [];
        for (const name of entitiesToResolve.keywords) {
          try {
            const results = await tmdbApi.searchKeyword(name);
            const match = Array.isArray(results) ? results[0] : results?.results?.[0];
            if (match) {
              resolved.push({ id: match.id, name: match.name });
            } else {
              warnings.push(`Keyword not found: "${name}"`);
            }
          } catch {
            warnings.push(`Failed to look up keyword: "${name}"`);
          }
        }
        if (resolved.length) {
          formState.selectedKeywords = resolved;
          filters.withKeywords = resolved.map((k) => k.id).join(',');
        }
      }

      if (entitiesToResolve.excludeKeywords?.length) {
        const resolved = [];
        for (const name of entitiesToResolve.excludeKeywords) {
          try {
            const results = await tmdbApi.searchKeyword(name);
            const match = Array.isArray(results) ? results[0] : results?.results?.[0];
            if (match) {
              resolved.push({ id: match.id, name: match.name });
            } else {
              warnings.push(`Keyword not found: "${name}"`);
            }
          } catch {
            warnings.push(`Failed to look up keyword: "${name}"`);
          }
        }
        if (resolved.length) {
          formState.excludeKeywords = resolved;
          filters.excludeKeywords = resolved.map((k) => k.id).join(',');
        }
      }

      if (entitiesToResolve.networks?.length) {
        const resolved = [];
        for (const name of entitiesToResolve.networks) {
          try {
            const results = await tmdbApi.searchTVNetworks(name);
            const match = Array.isArray(results) ? results[0] : results?.results?.[0];
            if (match) {
              resolved.push({ id: match.id, name: match.name, logo_path: match.logo_path });
            } else {
              warnings.push(`Network not found: "${name}"`);
            }
          } catch {
            warnings.push(`Failed to look up network: "${name}"`);
          }
        }
        if (resolved.length) {
          formState.selectedNetworks = resolved;
          filters.withNetworks = resolved.map((n) => n.id).join('|');
        }
      }

      if (entitiesToResolve.watchProviders?.length) {
        const watchRegion = region || 'US';
        try {
          const providerData = await tmdbApi.getWatchProviders('movie', watchRegion);
          const providerList = providerData?.results || providerData || [];

          const resolvedIds = [];
          for (const name of entitiesToResolve.watchProviders) {
            const lowerName = name.toLowerCase();
            const match = providerList.find(
              (p) =>
                p.provider_name?.toLowerCase() === lowerName ||
                p.provider_name?.toLowerCase().includes(lowerName)
            );
            if (match) {
              resolvedIds.push(match.provider_id);
            } else {
              warnings.push(`Streaming service not found: "${name}"`);
            }
          }

          if (resolvedIds.length) {
            filters.watchProviders = resolvedIds;
            filters.watchRegion = watchRegion;
          }
        } catch {
          warnings.push('Failed to look up streaming services');
        }
      }

      const result = { filters, formState, warnings };
      setResolutionResults(result);
      return result;
    } finally {
      setIsResolving(false);
    }
  }, []);

  return {
    generateFromPrompt,
    resolveEntities,
    isGenerating,
    isResolving,
    generatedCatalog,
    setGeneratedCatalog,
    resolutionResults,
    error,
    reset,
  };
}
