import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Eye,
  RefreshCw,
  Star,
  Check,
  Loader,
  ImageOff,
  Film,
  Tv,
  ChevronDown,
  ChevronUp,
  Calendar,
  Play,
  Users,
  Settings,
  Sparkles,
  X,
  Shuffle,
  Zap
} from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { MultiSelect } from './MultiSelect';
import { SearchInput } from './SearchInput';
import { RangeSlider, SingleSlider } from './RangeSlider';
import { LabelWithTooltip } from './Tooltip';
import { FilterSection } from './catalog/FilterSection';
import { GenreSelector } from './catalog/GenreSelector';
import { StreamFilters } from './catalog/StreamFilters';
import { PeopleFilters } from './catalog/PeopleFilters';
import { CatalogPreview } from './catalog/CatalogPreview';

const DEFAULT_CATALOG = {
  name: '',
  type: 'movie',
  filters: {
    genres: [],
    excludeGenres: [],
    sortBy: 'popularity.desc',
    imdbOnly: false,
    voteCountMin: 100,
  },
  enabled: true,
};

const CURRENT_YEAR = new Date().getFullYear();

// Date presets for quick selection
// These store a preset key that the backend resolves dynamically
const DATE_PRESETS = [
  { label: 'Last 30 days', value: 'last_30_days', days: 30 },
  { label: 'Last 90 days', value: 'last_90_days', days: 90 },
  { label: 'Last 6 months', value: 'last_180_days', days: 180 },
  { label: 'This year', value: 'this_year', year: true },
  { label: 'Last year', value: 'last_year', lastYear: true },
];

// Filter Templates for quick setup
const FILTER_TEMPLATES = [
  {
    id: 'hidden_gems',
    name: 'Hidden Gems',
    icon: 'gem',
    description: 'Underrated high-quality content',
    filters: {
      sortBy: 'vote_average.desc',
      voteCountMin: 50,
      ratingMin: 7.5,
      ratingMax: 10,
    }
  },
  {
    id: 'recent_hits',
    name: 'Recent Hits',
    icon: 'trending',
    description: 'Popular content from this year',
    filters: {
      sortBy: 'popularity.desc',
      yearFrom: CURRENT_YEAR,
      yearTo: CURRENT_YEAR,
      ratingMin: 6,
    }
  },
  {
    id: 'classics',
    name: 'Classics',
    icon: 'classic',
    description: 'Timeless favorites before 2000',
    filters: {
      sortBy: 'vote_average.desc',
      yearFrom: 1950,
      yearTo: 1999,
      voteCountMin: 500,
      ratingMin: 7.5,
    }
  },
  {
    id: 'family_night',
    name: 'Family Night',
    icon: 'family',
    description: 'Fun for all ages',
    filters: {
      sortBy: 'popularity.desc',
      certifications: ['G', 'PG'],
      ratingMin: 6,
    }
  },
];

export function CatalogEditor({
  catalog,
  genres = { movie: [], series: [] },
  genresLoading = false,
  refreshGenres = () => { },
  languages = [],
  countries = [],
  sortOptions = { movie: [], series: [] },
  releaseTypes = [],
  tvStatuses = [],
  tvTypes = [],
  monetizationTypes = [],
  certifications = { movie: {}, series: {} },
  watchRegions = [],
  tvNetworks = [],
  onUpdate,
  onPreview,
  searchPerson,
  searchCompany,
  searchKeyword,
  searchTVNetworks,
  getPersonById,
  getCompanyById,
  getKeywordById,
  getWatchProviders,
}) {
  // tmdb helper methods provided by parent via props (from useTMDB)
  // parent passes searchPerson/searchCompany/searchKeyword and getWatchProviders
  // but we also expect optional resolvers bound to the same hook if available
  // (App passes useTMDB methods; ensure parent uses them)
  const [localCatalog, setLocalCatalog] = useState(catalog || DEFAULT_CATALOG);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [watchProviders, setWatchProviders] = useState([]);
  const [selectedDatePreset, setSelectedDatePreset] = useState(null);
  const [tvNetworkOptions, setTVNetworkOptions] = useState(tvNetworks);
  const [expandedSections, setExpandedSections] = useState({
    basic: false,
    genres: false,
    filters: false,
    release: false,
    streaming: false,
    people: false,
    options: false,
  });

  // Selected items for search inputs
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  // Exclude filters
  const [excludeKeywords, setExcludeKeywords] = useState([]);
  const [excludeCompanies, setExcludeCompanies] = useState([]);
  const initialSyncRef = useRef(true);
  const syncTimeoutRef = useRef(null);
  const prevCatalogIdRef = useRef(null);

  // Keep a growing union of known networks so previously selected IDs always have labels.
  useEffect(() => {
    setTVNetworkOptions(prev => {
      const byId = new Map();
      (prev || []).forEach(n => {
        if (n && n.id != null) byId.set(String(n.id), n);
      });
      (tvNetworks || []).forEach(n => {
        if (n && n.id != null) {
          const key = String(n.id);
          if (!byId.has(key)) byId.set(key, n);
        }
      });
      return Array.from(byId.values());
    });
  }, [tvNetworks]);

  const handleTVNetworkSearch = useCallback(async (query) => {
    if (!searchTVNetworks) return;
    const q = String(query || '').trim();
    if (q.length < 2) return;
    try {
      const results = await searchTVNetworks(q);
      if (!Array.isArray(results) || results.length === 0) return;
      setTVNetworkOptions(prev => {
        const byId = new Map();
        (prev || []).forEach(n => {
          if (n && n.id != null) byId.set(String(n.id), n);
        });
        results.forEach(n => {
          if (n && n.id != null) {
            const key = String(n.id);
            if (!byId.has(key)) byId.set(key, n);
          }
        });
        return Array.from(byId.values());
      });
    } catch {
      // best effort: network search shouldn't break the editor
    }
  }, [searchTVNetworks]);

  // Tri-state genre click: neutral -> include -> exclude -> neutral
  const handleTriStateGenreClick = useCallback((genreId) => {
    setLocalCatalog(prev => {
      const current = prev || DEFAULT_CATALOG;
      const included = current.filters?.genres || [];
      const excluded = current.filters?.excludeGenres || [];

      const isIncluded = included.includes(genreId);
      const isExcluded = excluded.includes(genreId);

      let newIncluded, newExcluded;

      if (isIncluded) {
        // include -> exclude
        newIncluded = included.filter(id => id !== genreId);
        newExcluded = [...excluded, genreId];
      } else if (isExcluded) {
        // exclude -> neutral
        newIncluded = included;
        newExcluded = excluded.filter(id => id !== genreId);
      } else {
        // neutral -> include
        newIncluded = [...included, genreId];
        newExcluded = excluded;
      }

      return {
        ...current,
        filters: {
          ...current.filters,
          genres: newIncluded,
          excludeGenres: newExcluded
        }
      };
    });
  }, []);

  // Get genre state for tri-state display
  const getGenreState = useCallback((genreId) => {
    const included = localCatalog?.filters?.genres || [];
    const excluded = localCatalog?.filters?.excludeGenres || [];
    if (included.includes(genreId)) return 'include';
    if (excluded.includes(genreId)) return 'exclude';
    return 'neutral';
  }, [localCatalog?.filters?.genres, localCatalog?.filters?.excludeGenres]);

  useEffect(() => {
    if (catalog) {
      setLocalCatalog(catalog);

      // Initialize date preset from stored filter
      if (catalog.filters?.datePreset) {
        const presetMatch = DATE_PRESETS.find(p => p.value === catalog.filters.datePreset);
        setSelectedDatePreset(presetMatch ? presetMatch.label : null);
      } else {
        setSelectedDatePreset(null);
      }

      // Prefer server-resolved placeholder arrays when available
      const peopleResolved = catalog.filters?.withPeopleResolved || null;
      const companiesResolved = catalog.filters?.withCompaniesResolved || null;
      const keywordsResolved = catalog.filters?.withKeywordsResolved || null;

      const toPlaceholdersFromCsv = (csv) => {
        if (!csv) return [];
        return String(csv).split(',').filter(Boolean).map(id => ({ id, name: id }));
      };

      if (Array.isArray(peopleResolved) && peopleResolved.length > 0) {
        setSelectedPeople(peopleResolved.map(p => ({ id: String(p.value), name: p.label })));
      } else {
        const csv = catalog.filters?.withPeople || '';
        const initial = toPlaceholdersFromCsv(csv);
        (async () => {
          if (initial.length > 0 && (typeof getPersonById === 'function' || typeof searchPerson === 'function')) {
            const resolved = await Promise.all(initial.map(async item => {
              if (item.name && !/^\d+$/.test(item.name)) return item;
              try {
                if (typeof getPersonById === 'function') {
                  const resp = await getPersonById(item.id);
                  if (resp && resp.name) return { id: item.id, name: resp.name };
                }
                if (typeof searchPerson === 'function') {
                  const sres = await searchPerson(item.id);
                  if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || item.id };
                }
              } catch {
                // ignore resolution errors; keep placeholder
              }
              return item;
            }));
            setSelectedPeople(resolved);
          } else {
            setSelectedPeople(initial);
          }
        })();
      }

      if (Array.isArray(companiesResolved) && companiesResolved.length > 0) {
        setSelectedCompanies(companiesResolved.map(c => ({ id: String(c.value), name: c.label })));
      } else {
        const csv = catalog.filters?.withCompanies || '';
        const initial = toPlaceholdersFromCsv(csv);
        // Resolve numeric-only ids into names when possible
        (async () => {
          if (initial.length > 0 && (typeof getCompanyById === 'function' || typeof searchCompany === 'function')) {
            const resolved = await Promise.all(initial.map(async item => {
              if (item.name && !/^\d+$/.test(item.name)) return item;
              try {
                if (typeof getCompanyById === 'function') {
                  const resp = await getCompanyById(item.id);
                  if (resp && resp.name) return { id: item.id, name: resp.name };
                }
                if (typeof searchCompany === 'function') {
                  const sres = await searchCompany(item.id);
                  if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || sres[0].title || item.id };
                }
              } catch {
                // ignore resolution errors; keep placeholder
              }
              return item;
            }));
            setSelectedCompanies(resolved);
          } else {
            setSelectedCompanies(initial);
          }
        })();
      }

      if (Array.isArray(keywordsResolved) && keywordsResolved.length > 0) {
        setSelectedKeywords(keywordsResolved.map(k => ({ id: String(k.value), name: k.label })));
      } else {
        const csv = catalog.filters?.withKeywords || '';
        const initial = toPlaceholdersFromCsv(csv);
        (async () => {
          if (initial.length > 0 && (typeof getKeywordById === 'function' || typeof searchKeyword === 'function')) {
            const resolved = await Promise.all(initial.map(async item => {
              if (item.name && !/^\d+$/.test(item.name)) return item;
              try {
                if (typeof getKeywordById === 'function') {
                  const resp = await getKeywordById(item.id);
                  if (resp && resp.name) return { id: item.id, name: resp.name };
                }
                if (typeof searchKeyword === 'function') {
                  const sres = await searchKeyword(item.id);
                  if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || item.id };
                }
              } catch {
                // ignore resolution errors; keep placeholder
              }
              return item;
            }));
            setSelectedKeywords(resolved);
          } else {
            setSelectedKeywords(initial);
          }
        })();
      }

      // Initialize exclude keywords
      const excludeKwCsv = catalog.filters?.excludeKeywords || '';
      const excludeKwInitial = toPlaceholdersFromCsv(excludeKwCsv);
      if (excludeKwInitial.length > 0 && typeof getKeywordById === 'function') {
        (async () => {
          const resolved = await Promise.all(excludeKwInitial.map(async item => {
            if (item.name && !/^\d+$/.test(item.name)) return item;
            try {
              const resp = await getKeywordById(item.id);
              if (resp && resp.name) return { id: item.id, name: resp.name };
            } catch { /* ignore */ }
            return item;
          }));
          setExcludeKeywords(resolved);
        })();
      } else {
        setExcludeKeywords(excludeKwInitial);
      }

      // Initialize exclude companies
      const excludeCompCsv = catalog.filters?.excludeCompanies || '';
      const excludeCompInitial = toPlaceholdersFromCsv(excludeCompCsv);
      if (excludeCompInitial.length > 0 && typeof getCompanyById === 'function') {
        (async () => {
          const resolved = await Promise.all(excludeCompInitial.map(async item => {
            if (item.name && !/^\d+$/.test(item.name)) return item;
            try {
              const resp = await getCompanyById(item.id);
              if (resp && resp.name) return { id: item.id, name: resp.name };
            } catch { /* ignore */ }
            return item;
          }));
          setExcludeCompanies(resolved);
        })();
      } else {
        setExcludeCompanies(excludeCompInitial);
      }

      // Only clear preview when switching to a different catalog (by id).
      // Parent may re-create the same catalog object (new reference) which shouldn't clear preview.
      const prevId = prevCatalogIdRef.current;
      const newId = catalog._id || null;
      if (prevId !== newId) {
        setPreviewData(null);
      }
      prevCatalogIdRef.current = newId;
    } else {
      setLocalCatalog(DEFAULT_CATALOG);
      setSelectedPeople([]);
      setSelectedCompanies([]);
      setSelectedKeywords([]);
      setExcludeKeywords([]);
      setExcludeCompanies([]);
      setPreviewData(null);
      prevCatalogIdRef.current = null;
    }
  }, [catalog, getPersonById, getCompanyById, getKeywordById, searchPerson, searchCompany, searchKeyword]);

  // Keep local changes synced back to parent so switching catalogs preserves state
  useEffect(() => {
    // Don't sync immediately after receiving a new `catalog` prop
    if (!catalog || !catalog._id) return; // nothing to sync if no id

    if (initialSyncRef.current) {
      // Skip the first effect run which comes from prop sync
      initialSyncRef.current = false;
      return;
    }

    // Debounce updates to avoid rapid parent updates while typing
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      if (typeof onUpdate === 'function') {
        // Include current selected people/companies/keywords as comma lists
        const merged = {
          ...localCatalog,
          filters: {
            ...localCatalog.filters,
            withPeople: selectedPeople.map(p => p.id).join(',') || undefined,
            withCompanies: selectedCompanies.map(c => c.id).join(',') || undefined,
            withKeywords: selectedKeywords.map(k => k.id).join(',') || undefined,
            excludeKeywords: excludeKeywords.map(k => k.id).join(',') || undefined,
            excludeCompanies: excludeCompanies.map(c => c.id).join(',') || undefined,
          }
        };
        onUpdate(catalog._id, merged);
      }
    }, 250);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    };
  }, [localCatalog, selectedPeople, selectedCompanies, selectedKeywords, excludeKeywords, excludeCompanies, catalog, onUpdate]);

  // Load watch providers when region changes
  useEffect(() => {
    const loadProviders = async () => {
      const region = localCatalog?.filters?.watchRegion;
      if (region && getWatchProviders) {
        try {
          const providers = await getWatchProviders(localCatalog?.type || 'movie', region);
          setWatchProviders(providers.map(p => ({
            id: p.provider_id,
            name: p.provider_name,
            logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null
          })));
        } catch (err) {
          console.error('Failed to load providers:', err);
        }
      }
    };
    loadProviders();
  }, [localCatalog?.filters?.watchRegion, localCatalog?.type, getWatchProviders]);

  // If user selects a numeric id (e.g., just added an actor by id) resolve it immediately.
  // This handles the case where CatalogEditor mounted before resolvers were available
  // and the user adds a person/company/keyword without saving the catalog first.
  useEffect(() => {
    let cancelled = false;
    const hasNumeric = selectedPeople.some(p => /^\d+$/.test(String(p.name)));
    if (!hasNumeric) return;

    (async () => {
      try {
        const resolved = await Promise.all(selectedPeople.map(async item => {
          if (item.name && !/^\d+$/.test(String(item.name))) return item;
          try {
            if (typeof getPersonById === 'function') {
              const resp = await getPersonById(item.id);
              if (resp && resp.name) return { id: item.id, name: resp.name };
            }
            if (typeof searchPerson === 'function') {
              const sres = await searchPerson(item.id);
              if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || item.id };
            }
          } catch {
            // ignore resolution errors; keep placeholder
          }
          return item;
        }));
        if (!cancelled) {
          setSelectedPeople(resolved);
        }
      } catch {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [selectedPeople, getPersonById, searchPerson]);

  useEffect(() => {
    let cancelled = false;
    const hasNumeric = selectedCompanies.some(c => /^\d+$/.test(String(c.name)));
    if (!hasNumeric) return;

    (async () => {
      try {
        const resolved = await Promise.all(selectedCompanies.map(async item => {
          if (item.name && !/^\d+$/.test(String(item.name))) return item;
          try {
            if (typeof getCompanyById === 'function') {
              const resp = await getCompanyById(item.id);
              if (resp && resp.name) return { id: item.id, name: resp.name };
            }
            if (typeof searchCompany === 'function') {
              const sres = await searchCompany(item.id);
              if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || sres[0].title || item.id };
            }
          } catch {
            // ignore resolution errors; keep placeholder
          }
          return item;
        }));
        if (!cancelled) {
          setSelectedCompanies(resolved);
        }
      } catch {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [selectedCompanies, getCompanyById, searchCompany]);

  useEffect(() => {
    let cancelled = false;
    const hasNumeric = selectedKeywords.some(k => /^\d+$/.test(String(k.name)));
    if (!hasNumeric) return;

    (async () => {
      try {
        const resolved = await Promise.all(selectedKeywords.map(async item => {
          if (item.name && !/^\d+$/.test(String(item.name))) return item;
          try {
            if (typeof getKeywordById === 'function') {
              const resp = await getKeywordById(item.id);
              if (resp && resp.name) return { id: item.id, name: resp.name };
            }
            if (typeof searchKeyword === 'function') {
              const sres = await searchKeyword(item.id);
              if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || item.id };
            }
          } catch {
            // ignore resolution errors; keep placeholder
          }
          return item;
        }));
        if (!cancelled) {
          setSelectedKeywords(resolved);
        }
      } catch {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [selectedKeywords, getKeywordById, searchKeyword]);

  const toggleSection = (section) => {
    setExpandedSections(prev => {
      const isCurrentlyExpanded = prev[section];
      // If closing, just close it. If opening, close all others first.
      if (isCurrentlyExpanded) {
        return { ...prev, [section]: false };
      } else {
        // Collapse all sections, then open just this one
        const allClosed = Object.keys(prev).reduce((acc, key) => {
          acc[key] = false;
          return acc;
        }, {});
        return { ...allClosed, [section]: true };
      }
    });
  };

  const handleFiltersChange = useCallback((key, value) => {
    setLocalCatalog(prev => {
      const current = prev || DEFAULT_CATALOG;
      return {
        ...current,
        filters: {
          ...current.filters,
          [key]: value
        }
      };
    });
  }, []);

  const handleNameChange = useCallback((name) => {
    setLocalCatalog(prev => ({ ...prev, name }));
  }, []);

  const handleTypeChange = useCallback((type) => {
    setLocalCatalog(prev => {
      const updated = {
        ...prev,
        type,
        filters: {
          ...prev.filters,
          genres: [],
          excludeGenres: [],
          // Reset sortBy to default when changing type as options differ
          sortBy: 'popularity.desc',
        }
      };
      // Immediately update parent so sidebar reflects the change
      if (catalog?._id) {
        onUpdate(catalog._id, updated);
      }
      return updated;
    });
  }, [catalog?._id, onUpdate]);

  const handleYearRangeChange = useCallback((range) => {
    setLocalCatalog(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        yearFrom: range[0],
        yearTo: range[1]
      }
    }));
  }, []);

  const handleRatingRangeChange = useCallback((range) => {
    setLocalCatalog(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        ratingMin: range[0],
        ratingMax: range[1]
      }
    }));
  }, []);

  const handleRuntimeRangeChange = useCallback((range) => {
    setLocalCatalog(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        runtimeMin: range[0] === 0 ? undefined : range[0],
        runtimeMax: range[1] === 400 ? undefined : range[1]
      }
    }));
  }, []);

  const handleDatePreset = useCallback((preset) => {
    setSelectedDatePreset(preset.label);

    // Store the dynamic preset value - backend will calculate actual dates at request time
    handleFiltersChange('datePreset', preset.value);

    // Clear any manually set dates since we're using a dynamic preset
    const isMovie = localCatalog?.type === 'movie';
    handleFiltersChange(isMovie ? 'releaseDateFrom' : 'airDateFrom', undefined);
    handleFiltersChange(isMovie ? 'releaseDateTo' : 'airDateTo', undefined);
  }, [localCatalog?.type, handleFiltersChange]);

  const handleProviderToggle = useCallback((providerId) => {
    setLocalCatalog(prev => {
      const current = prev || DEFAULT_CATALOG;
      const currentProviders = current.filters?.watchProviders || [];
      const newProviders = currentProviders.includes(providerId)
        ? currentProviders.filter(id => id !== providerId)
        : [...currentProviders, providerId];
      return {
        ...current,
        filters: {
          ...current.filters,
          watchProviders: newProviders
        }
      };
    });
  }, []);

  const loadPreview = async () => {
    if (!localCatalog) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const filters = {
        ...localCatalog.filters,
        withPeople: selectedPeople.map(p => p.id).join(',') || undefined,
        withCompanies: selectedCompanies.map(c => c.id).join(',') || undefined,
        withKeywords: selectedKeywords.map(k => k.id).join(',') || undefined,
        excludeKeywords: excludeKeywords.map(k => k.id).join(',') || undefined,
        excludeCompanies: excludeCompanies.map(c => c.id).join(',') || undefined,
      };
      const data = await onPreview(localCatalog.type || 'movie', filters);
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Compute active filters for the summary bar
  const getActiveFilters = useCallback(() => {
    const filters = localCatalog?.filters || {};
    const active = [];

    // Genres
    if (filters.genres?.length > 0) {
      const genreNames = filters.genres.map(id => {
        const genre = (genres[localCatalog?.type] || []).find(g => g.id === id);
        return genre?.name || id;
      }).slice(0, 2);
      const extra = filters.genres.length > 2 ? ` +${filters.genres.length - 2}` : '';
      active.push({ key: 'genres', label: `Genres: ${genreNames.join(', ')}${extra}`, section: 'genres' });
    }

    // Excluded Genres
    if (filters.excludeGenres?.length > 0) {
      active.push({ key: 'excludeGenres', label: `Excluding ${filters.excludeGenres.length} genre(s)`, section: 'genres' });
    }

    // Original language (filter)
    if (filters.language) {
      const lang = languages.find(l => l.code === filters.language);
      active.push({ key: 'language', label: `Original language: ${lang?.name || filters.language}`, section: 'filters' });
    }

    // Display language (localization)
    if (filters.displayLanguage) {
      const lang = languages.find(l => l.code === filters.displayLanguage);
      active.push({ key: 'displayLanguage', label: `Display language: ${lang?.name || filters.displayLanguage}`, section: 'filters' });
    }

    // Country
    if (filters.originCountry) {
      const country = countries.find(c => c.code === filters.originCountry);
      active.push({ key: 'originCountry', label: `Country: ${country?.name || filters.originCountry}`, section: 'filters' });
    }

    // Year Range
    if (filters.yearFrom || filters.yearTo) {
      const from = filters.yearFrom || 'Any';
      const to = filters.yearTo || 'Now';
      active.push({ key: 'year', label: `Year: ${from}-${to}`, section: 'filters' });
    }

    // Rating
    if (filters.ratingMin > 0 || filters.ratingMax < 10) {
      active.push({ key: 'rating', label: `Rating: ${filters.ratingMin || 0}-${filters.ratingMax || 10}`, section: 'filters' });
    }

    // Runtime
    if (filters.runtimeMin || filters.runtimeMax) {
      active.push({ key: 'runtime', label: `Runtime: ${filters.runtimeMin || 0}-${filters.runtimeMax || '∞'}min`, section: 'filters' });
    }

    // Date Preset (dynamic date filters)
    if (filters.datePreset) {
      const presetMatch = DATE_PRESETS.find(p => p.value === filters.datePreset);
      const label = presetMatch ? presetMatch.label : filters.datePreset;
      active.push({ key: 'datePreset', label: `Date: ${label}`, section: 'release' });
    } else if (filters.releaseDateFrom || filters.releaseDateTo || filters.airDateFrom || filters.airDateTo) {
      // Manual date range (only show if no preset is active)
      active.push({ key: 'releaseDate', label: 'Release date set', section: 'release' });
    }

    // Streaming
    if (filters.watchProviders?.length > 0) {
      active.push({ key: 'watchProviders', label: `${filters.watchProviders.length} streaming service(s)`, section: 'streaming' });
    }

    // People
    if (selectedPeople.length > 0) {
      active.push({ key: 'people', label: `${selectedPeople.length} cast/crew`, section: 'people' });
    }

    // Keywords
    if (selectedKeywords.length > 0) {
      active.push({ key: 'keywords', label: `${selectedKeywords.length} keyword(s)`, section: 'people' });
    }

    return active;
  }, [localCatalog, genres, languages, countries, selectedPeople, selectedKeywords]);

  // Clear a specific filter
  const clearFilter = useCallback((filterKey) => {
    switch (filterKey) {
      case 'genres':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, genres: [] } }));
        break;
      case 'excludeGenres':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, excludeGenres: [] } }));
        break;
      case 'language':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, language: undefined } }));
        break;
      case 'displayLanguage':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, displayLanguage: undefined } }));
        break;
      case 'originCountry':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, originCountry: undefined } }));
        break;
      case 'year':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, yearFrom: undefined, yearTo: undefined } }));
        break;
      case 'rating':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, ratingMin: 0, ratingMax: 10 } }));
        break;
      case 'runtime':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, runtimeMin: undefined, runtimeMax: undefined } }));
        break;
      case 'datePreset':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, datePreset: undefined } }));
        setSelectedDatePreset(null);
        break;
      case 'releaseDate':
        setLocalCatalog(prev => ({
          ...prev,
          filters: {
            ...prev.filters,
            releaseDateFrom: undefined,
            releaseDateTo: undefined,
            airDateFrom: undefined,
            airDateTo: undefined,
            datePreset: undefined,
          }
        }));
        setSelectedDatePreset(null);
        break;
      case 'watchProviders':
        setLocalCatalog(prev => ({ ...prev, filters: { ...prev.filters, watchProviders: [] } }));
        break;
      case 'people':
        setSelectedPeople([]);
        break;
      case 'keywords':
        setSelectedKeywords([]);
        break;
      default:
        break;
    }
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setLocalCatalog(prev => ({
      ...prev,
      filters: {
        ...DEFAULT_CATALOG.filters,
        sortBy: prev.filters?.sortBy || 'popularity.desc',
      }
    }));
    setSelectedPeople([]);
    setSelectedCompanies([]);
    setSelectedKeywords([]);
    setExcludeKeywords([]);
    setExcludeCompanies([]);
    setSelectedDatePreset(null);
  }, []);

  // Apply a filter template
  const applyTemplate = useCallback((template) => {
    setLocalCatalog(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        ...template.filters,
      }
    }));
  }, []);

  // Surprise Me - random sensible filters
  const handleSurpriseMe = useCallback(() => {
    const currentGenreList = genres[localCatalog?.type] || [];
    if (currentGenreList.length === 0) return;

    // Pick 1-2 random genres
    const shuffled = [...currentGenreList].sort(() => Math.random() - 0.5);
    const randomGenres = shuffled.slice(0, Math.floor(Math.random() * 2) + 1).map(g => g.id);

    // Random decade
    const decades = [1980, 1990, 2000, 2010, 2020];
    const randomDecade = decades[Math.floor(Math.random() * decades.length)];

    // Random minimum rating
    const ratings = [6, 6.5, 7, 7.5];
    const randomRating = ratings[Math.floor(Math.random() * ratings.length)];

    setLocalCatalog(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        genres: randomGenres,
        yearFrom: randomDecade,
        yearTo: randomDecade + 9,
        ratingMin: randomRating,
        sortBy: Math.random() > 0.5 ? 'vote_average.desc' : 'popularity.desc',
      }
    }));
  }, [genres, localCatalog?.type]);

  // Early return if no catalog selected
  if (!catalog) {
    return (
      <div className="editor-panel">
        <div className="empty-state">
          <div className="empty-state-icon">
            <Sparkles size={48} />
          </div>
          <h3>Create Your First Catalog</h3>
          <p>Click "Add" in the sidebar to start building a custom catalog with TMDB filters</p>
        </div>
      </div>
    );
  }

  const catalogType = localCatalog?.type || 'movie';
  const isMovie = catalogType === 'movie';
  const currentGenres = genres[catalogType] || [];
  const genresLoadedForType = Array.isArray(currentGenres) && currentGenres.length > 0;
  const selectedGenres = localCatalog?.filters?.genres || [];
  const excludedGenres = localCatalog?.filters?.excludeGenres || [];
  const currentCertifications = certifications[catalogType] || {};
  const certCountry = localCatalog?.filters?.certificationCountry || 'US';
  const certOptions = currentCertifications[certCountry] || [];

  // Check if current list type supports full discover filters
  // Only 'discover' (no listType or explicitly 'discover') supports all filters
  // Random is now a sort option, not a list type
  const currentListType = localCatalog?.filters?.listType || 'discover';
  const isPresetCatalog = currentListType && currentListType !== 'discover';
  const supportsFullFilters = !isPresetCatalog;

  // Get active filters for summary bar
  const activeFilters = getActiveFilters();

  // Count active filters per section for badges
  const getFilterCountForSection = (sectionKey) => {
    const sectionFilters = activeFilters.filter(f => f.section === sectionKey);
    return sectionFilters.length;
  };

  return (
    <div className="editor-container">
      <div className="editor-panel">
        {/* Header */}
        <div className="editor-header">
          <div className="editor-title">
            {isMovie ? <Film size={22} /> : <Tv size={22} />}
            <input
              type="text"
              className="editor-name-input"
              placeholder="Catalog Name..."
              value={localCatalog?.name || ''}
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>
          <div className="editor-actions">
            <button
              className="btn btn-secondary"
              onClick={loadPreview}
              disabled={previewLoading}
            >
              {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
              Preview
            </button>
          </div>
        </div>

        <div className="editor-content">
          {/* Content Type Toggle */}
          <div className="content-type-toggle">
            <button
              className={`type-btn ${isMovie ? 'active' : ''}`}
              onClick={() => handleTypeChange('movie')}
            >
              <Film size={18} />
              Movies
            </button>
            <button
              className={`type-btn ${!isMovie ? 'active' : ''}`}
              onClick={() => handleTypeChange('series')}
            >
              <Tv size={18} />
              TV Shows
            </button>
          </div>

          {/* Quick Actions Bar */}
          {supportsFullFilters && (
            <div className="quick-actions-bar">
              <div className="quick-actions-row">
                <button
                  className="quick-action-btn surprise-btn"
                  onClick={handleSurpriseMe}
                  title="Apply random filters for discovery"
                >
                  <Shuffle size={16} />
                  Surprise Me
                </button>
                <div className="template-divider" />
                {FILTER_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    className="quick-action-btn template-btn"
                    onClick={() => applyTemplate(template)}
                    title={template.description}
                  >
                    <Zap size={14} />
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active Filters Summary */}
          {activeFilters.length > 0 && (
            <div className="active-filters-bar">
              <div className="active-filters-chips">
                {activeFilters.map(filter => (
                  <div
                    key={filter.key}
                    className="active-filter-chip"
                    onClick={() => toggleSection(filter.section)}
                  >
                    <span>{filter.label}</span>
                    <button
                      className="chip-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFilter(filter.key);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="clear-all-btn"
                onClick={clearAllFilters}
              >
                Clear All
              </button>
            </div>
          )}

          {/* Core Filters Section - Only show for Custom Discover */}
          {!isPresetCatalog && (
            <div className="filter-section">
              <button className="filter-section-header" onClick={() => toggleSection('filters')}>
                <Settings size={18} />
                <div className="filter-section-title-group">
                  <h4 className="filter-section-title">Sort & Filter</h4>
                  <span className="filter-section-desc">Sorting, language, year, rating</span>
                </div>
                {getFilterCountForSection('filters') > 0 && (
                  <span className="filter-count-badge">{getFilterCountForSection('filters')}</span>
                )}
                {expandedSections.filters ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {expandedSections.filters && (
                <div className="filter-section-content">
                  {/* Sort, Language, Country */}
                  {supportsFullFilters && (
                    <>
                      <div className="filter-grid">
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Sort By"
                            tooltip="How to order your results. Popular shows what's trending now, while rating shows critically acclaimed content."
                          />
                          <SearchableSelect
                            options={sortOptions[localCatalog?.type] || sortOptions.movie || []}
                            value={localCatalog?.filters?.sortBy || 'popularity.desc'}
                            onChange={(value) => handleFiltersChange('sortBy', value)}
                            placeholder="Most Popular"
                            searchPlaceholder="Search..."
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>

                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Original Language"
                            tooltip="Filter by the original language of the content (e.g., select 'Japanese' for anime, 'Korean' for K-dramas)."
                          />
                          <SearchableSelect
                            options={languages}
                            value={localCatalog?.filters?.language || ''}
                            onChange={(value) => handleFiltersChange('language', value)}
                            placeholder="Any"
                            searchPlaceholder="Search languages..."
                            labelKey="name"
                            valueKey="code"
                          />
                        </div>

                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Display Language"
                            tooltip="Localize titles and overviews (when available) to this language. Tip: set Display Language to English while keeping Original Language set to Japanese/Korean/etc."
                          />
                          <SearchableSelect
                            options={languages}
                            value={localCatalog?.filters?.displayLanguage || ''}
                            onChange={(value) => handleFiltersChange('displayLanguage', value)}
                            placeholder="Default"
                            searchPlaceholder="Search languages..."
                            labelKey="name"
                            valueKey="code"
                          />
                        </div>

                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Country"
                            tooltip="Filter by country of origin. Useful for finding British shows, Bollywood movies, etc."
                          />
                          <SearchableSelect
                            options={countries}
                            value={localCatalog?.filters?.originCountry || ''}
                            onChange={(value) => handleFiltersChange('originCountry', value)}
                            placeholder="Any"
                            searchPlaceholder="Search countries..."
                            labelKey="name"
                            valueKey="code"
                          />
                        </div>
                      </div>

                      {/* Year Range Slider */}
                      <div style={{ marginTop: '24px' }}>
                        <RangeSlider
                          label="Year Range"
                          tooltip="Filter by release year or first air date. Great for finding classics or recent releases."
                          min={1900}
                          max={CURRENT_YEAR + 2}
                          step={1}
                          value={[
                            localCatalog?.filters?.yearFrom || 1900,
                            localCatalog?.filters?.yearTo || CURRENT_YEAR + 2
                          ]}
                          onChange={handleYearRangeChange}
                          formatValue={(v) => v}
                          showInputs
                        />
                      </div>

                      {/* Rating Range Slider */}
                      <div style={{ marginTop: '20px' }}>
                        <RangeSlider
                          label="Rating"
                          tooltip="TMDB average user rating (0-10 scale). Higher ratings indicate better reviews."
                          min={0}
                          max={10}
                          step={0.1}
                          value={[
                            localCatalog?.filters?.ratingMin || 0,
                            localCatalog?.filters?.ratingMax || 10
                          ]}
                          onChange={handleRatingRangeChange}
                          formatValue={(v) => v.toFixed(1)}
                          showInputs
                        />
                      </div>

                      {/* Runtime Range Slider */}
                      <div style={{ marginTop: '20px' }}>
                        <RangeSlider
                          label="Runtime (minutes)"
                          tooltip="Filter by total runtime. Perfect for finding quick watches or epic adventures."
                          min={0}
                          max={400}
                          step={1}
                          value={[
                            localCatalog?.filters?.runtimeMin || 0,
                            localCatalog?.filters?.runtimeMax || 400
                          ]}
                          onChange={handleRuntimeRangeChange}
                          formatValue={(v) => v === 0 ? 'Any' : v === 400 ? '400+' : `${v}m`}
                          showInputs
                        />
                        <div className="runtime-presets" style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className={`date-preset ${localCatalog?.filters?.runtimeMax === 60 && !localCatalog?.filters?.runtimeMin ? 'active' : ''}`}
                            onClick={() => handleRuntimeRangeChange([0, 60])}
                          >
                            Short (&lt;60m)
                          </button>
                          <button
                            type="button"
                            className={`date-preset ${localCatalog?.filters?.runtimeMin === 90 && localCatalog?.filters?.runtimeMax === 120 ? 'active' : ''}`}
                            onClick={() => handleRuntimeRangeChange([90, 120])}
                          >
                            Standard (90-120m)
                          </button>
                          <button
                            type="button"
                            className={`date-preset ${localCatalog?.filters?.runtimeMin === 150 && localCatalog?.filters?.runtimeMax === 400 ? 'active' : ''}`}
                            onClick={() => handleRuntimeRangeChange([150, 400])}
                          >
                            Long (&gt;150m)
                          </button>
                          <button
                            type="button"
                            className={`date-preset ${localCatalog?.filters?.runtimeMin === 180 ? 'active' : ''}`}
                            onClick={() => handleRuntimeRangeChange([180, 400])}
                          >
                            Epic (&gt;3h)
                          </button>
                          <button
                            type="button"
                            className="date-preset"
                            onClick={() => handleRuntimeRangeChange([0, 400])}
                          >
                            Any
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* For non-discover modes - no filters apply, show info message */}
                  {!supportsFullFilters && (
                    <div className="list-type-info">
                      <p className="filter-hint">
                        ℹ️ Pre-made lists like Trending, Popular, etc. don't support filters.
                        They show globally popular content as ranked by TMDB.
                      </p>
                      <p className="filter-hint" style={{ marginTop: '8px' }}>
                        💡 <strong>Want to filter by country, language, or genre?</strong> Use "🔍 Custom Discover" which gives you full control over all filters.
                      </p>
                    </div>
                  )}
                  {supportsFullFilters && (
                    <div style={{ marginTop: '20px' }}>
                      <SingleSlider
                        label="Minimum Votes"
                        tooltip="Requires this many user ratings. Higher values filter out obscure titles and ensure quality."
                        min={0}
                        max={10000}
                        step={1}
                        value={localCatalog?.filters?.voteCountMin ?? 100}
                        onChange={(v) => handleFiltersChange('voteCountMin', v)}
                        formatValue={(v) => v.toLocaleString()}
                        showInput
                      />
                    </div>
                  )}
                </div>
              )}
            </div>)}
          {supportsFullFilters && (
            <div className="filter-section">
              <button className="filter-section-header" onClick={() => toggleSection('release')}>
                <Calendar size={18} />
                <div className="filter-section-title-group">
                  <h4 className="filter-section-title">{isMovie ? 'Release' : 'Air Date'} & Classification</h4>
                  <span className="filter-section-desc">Date ranges, age ratings, release type</span>
                </div>
                {getFilterCountForSection('release') > 0 && (
                  <span className="filter-count-badge">{getFilterCountForSection('release')}</span>
                )}
                {expandedSections.release ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {expandedSections.release && (
                <div className="filter-section-content">
                  {/* Date Presets */}
                  <div className="date-presets">
                    {DATE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        className={`date-preset ${selectedDatePreset === preset.label ? 'active' : ''}`}
                        onClick={() => handleDatePreset(preset)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="filter-two-col">
                    <div className="filter-group">
                      <LabelWithTooltip
                        label={isMovie ? 'Release Date From' : 'Episode Air Date From'}
                        tooltip={isMovie ? 'Filter movies released on or after this date' : 'Filter shows that had episodes airing on or after this date'}
                      />
                      <input
                        type="date"
                        className="input"
                        value={localCatalog?.filters?.[isMovie ? 'releaseDateFrom' : 'airDateFrom'] || ''}
                        onChange={(e) => {
                          setSelectedDatePreset(null);
                          handleFiltersChange('datePreset', undefined); // Clear dynamic preset when manually editing
                          handleFiltersChange(isMovie ? 'releaseDateFrom' : 'airDateFrom', e.target.value);
                        }}
                      />
                    </div>
                    <div className="filter-group">
                      <LabelWithTooltip
                        label={isMovie ? 'Release Date To' : 'Episode Air Date To'}
                        tooltip={isMovie ? 'Filter movies released on or before this date' : 'Filter shows that had episodes airing on or before this date'}
                      />
                      <input
                        type="date"
                        className="input"
                        value={localCatalog?.filters?.[isMovie ? 'releaseDateTo' : 'airDateTo'] || ''}
                        onChange={(e) => {
                          setSelectedDatePreset(null);
                          handleFiltersChange('datePreset', undefined); // Clear dynamic preset when manually editing
                          handleFiltersChange(isMovie ? 'releaseDateTo' : 'airDateTo', e.target.value);
                        }}
                      />
                    </div>
                  </div>

                  {/* First Air Date for TV - when show premiered */}
                  {!isMovie && (
                    <div className="filter-two-col" style={{ marginTop: '16px' }}>
                      <div className="filter-group">
                        <LabelWithTooltip
                          label="Show Premiered From"
                          tooltip="Filter by when the TV show first aired. This is the date of the very first episode, not individual episode air dates."
                        />
                        <span className="filter-label-hint">When show first aired (premiere date)</span>
                        <input
                          type="date"
                          className="input"
                          value={localCatalog?.filters?.firstAirDateFrom || ''}
                          onChange={(e) => handleFiltersChange('firstAirDateFrom', e.target.value)}
                        />
                      </div>
                      <div className="filter-group">
                        <LabelWithTooltip
                          label="Show Premiered To"
                          tooltip="Latest premiere date to include. Shows that first aired before or on this date."
                        />
                        <input
                          type="date"
                          className="input"
                          value={localCatalog?.filters?.firstAirDateTo || ''}
                          onChange={(e) => handleFiltersChange('firstAirDateTo', e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {isMovie ? (
                    <>
                      <div className="filter-two-col" style={{ marginTop: '16px' }}>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Release Type"
                            tooltip="How the movie was released: Theatrical (cinemas), Digital (streaming/download), Physical (DVD/Blu-ray), TV broadcast, etc."
                          />
                          <MultiSelect
                            options={releaseTypes}
                            value={localCatalog?.filters?.releaseTypes || []}
                            onChange={(value) => handleFiltersChange('releaseTypes', value)}
                            placeholder="All types"
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Age Rating"
                            tooltip="Content certification/age rating (e.g., PG-13, R, TV-MA). Varies by country - US ratings shown by default."
                          />
                          <MultiSelect
                            options={certOptions.map(c => ({ value: c.certification, label: c.certification }))}
                            value={localCatalog?.filters?.certifications || []}
                            onChange={(value) => handleFiltersChange('certifications', value)}
                            placeholder="Any"
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>
                      </div>
                      <div className="filter-group" style={{ marginTop: '16px' }}>
                        <LabelWithTooltip
                          label="Release Region"
                          tooltip="Filter by when content was released in a specific country. Useful since movies often premiere at different times worldwide."
                        />
                        <span className="filter-label-hint">Use regional release dates instead of worldwide premiere</span>
                        <SearchableSelect
                          options={[{ code: '', name: 'Worldwide (default)' }, ...countries]}
                          value={localCatalog?.filters?.region || ''}
                          onChange={(value) => handleFiltersChange('region', value)}
                          placeholder="Worldwide"
                          searchPlaceholder="Search countries..."
                          labelKey="name"
                          valueKey="code"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="filter-two-col" style={{ marginTop: '16px' }}>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Show Status"
                            tooltip="Whether the TV show is currently Returning Series, Ended, Canceled, In Production, or Pilot status."
                          />
                          <SearchableSelect
                            options={[{ value: '', label: 'Any' }, ...tvStatuses]}
                            value={localCatalog?.filters?.tvStatus || ''}
                            onChange={(value) => handleFiltersChange('tvStatus', value)}
                            placeholder="Any"
                            searchPlaceholder="Search..."
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>
                        <div className="filter-group">
                          <LabelWithTooltip
                            label="Show Type"
                            tooltip="Format of TV show: Scripted (regular series), Reality, Documentary, Talk Show, News, Miniseries, etc."
                          />
                          <SearchableSelect
                            options={[{ value: '', label: 'Any' }, ...tvTypes]}
                            value={localCatalog?.filters?.tvType || ''}
                            onChange={(value) => handleFiltersChange('tvType', value)}
                            placeholder="Any"
                            searchPlaceholder="Search..."
                            labelKey="label"
                            valueKey="value"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {supportsFullFilters && (
            <FilterSection
              id="streaming"
              title="Where to Watch"
              description="Filter by streaming services and original networks"
              icon={Play}
              isOpen={expandedSections.streaming}
              onToggle={toggleSection}
              badgeCount={getFilterCountForSection('streaming')}
            >
              <StreamFilters
                type={localCatalog?.type}
                tvNetworks={tvNetworkOptions}
                watchRegions={watchRegions}
                watchProviders={watchProviders}
                monetizationTypes={monetizationTypes}
                onNetworkSearch={handleTVNetworkSearch}
                filters={localCatalog?.filters || {}}
                onFiltersChange={handleFiltersChange}
              />
            </FilterSection>
          )}

          {supportsFullFilters && (
            <FilterSection
              id="genres"
              title="Genres"
              description={activeFilters.find(f => f.section === 'genres')?.label || 'Select genres to include/exclude'}
              icon={Sparkles}
              isOpen={expandedSections.genres}
              onToggle={toggleSection}
              badgeCount={getFilterCountForSection('genres')}
            >
              <GenreSelector
                genres={currentGenres}
                selectedGenres={selectedGenres}
                excludedGenres={excludedGenres}
                genreMatchMode={localCatalog?.filters?.genreMatchMode || 'any'}
                onInclude={(id) => handleTriStateGenreClick(id)}
                onExclude={(id) => handleTriStateGenreClick(id)}
                onClear={(id) => handleTriStateGenreClick(id)}
                onSetMatchMode={(mode) => handleFiltersChange('genreMatchMode', mode)}
                loading={genresLoading}
                onRefresh={refreshGenres}
              />
            </FilterSection>
          )}
          {supportsFullFilters && (
            <FilterSection
              id="people"
              title="People & Studios"
              description="Filter by cast, crew, or production company"
              icon={Users}
              isOpen={expandedSections.people}
              onToggle={toggleSection}
              badgeCount={getFilterCountForSection('people')}
            >
              <PeopleFilters
                selectedPeople={selectedPeople}
                onSelectPeople={setSelectedPeople}
                selectedCompanies={selectedCompanies}
                onSelectCompanies={setSelectedCompanies}
                selectedKeywords={selectedKeywords}
                onSelectKeywords={setSelectedKeywords}
                excludeKeywords={excludeKeywords}
                onExcludeKeywords={setExcludeKeywords}
                excludeCompanies={excludeCompanies}
                onExcludeCompanies={setExcludeCompanies}
                searchPerson={searchPerson}
                searchCompany={searchCompany}
                searchKeyword={searchKeyword}
              />
            </FilterSection>
          )}

          {/* Options Section */}
          <div className="filter-section">
            <button className="filter-section-header" onClick={() => toggleSection('options')}>
              <Settings size={18} />
              <div className="filter-section-title-group">
                <h4 className="filter-section-title">Options</h4>
              </div>
              {expandedSections.options ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {expandedSections.options && (
              <div className="filter-section-content">
                <div className="checkbox-grid">
                  <label
                    className="checkbox-label-row"
                    onClick={() => handleFiltersChange('imdbOnly', !localCatalog?.filters?.imdbOnly)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={`checkbox ${localCatalog?.filters?.imdbOnly ? 'checked' : ''}`}>
                      {localCatalog?.filters?.imdbOnly && <Check size={14} />}
                    </div>
                    <LabelWithTooltip
                      label="Only show items with IMDB IDs"
                      tooltip="Filter to only content that has an IMDB entry. Ensures compatibility with addons that require IMDB IDs."
                    />
                  </label>
                  {supportsFullFilters && (
                    <label
                      className="checkbox-label-row"
                      onClick={() => handleFiltersChange('includeAdult', !localCatalog?.filters?.includeAdult)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className={`checkbox ${localCatalog?.filters?.includeAdult ? 'checked' : ''}`}>
                        {localCatalog?.filters?.includeAdult && <Check size={14} />}
                      </div>
                      <LabelWithTooltip
                        label="Include adult content"
                        tooltip="Include adult/18+ rated content in results. Disabled by default."
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Mobile Preview Button - at end of filters for easy access */}
          <div className="mobile-preview-btn-container">
            <button
              className="btn btn-secondary mobile-preview-btn"
              onClick={loadPreview}
              disabled={previewLoading}
            >
              {previewLoading ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
              Preview
            </button>
          </div>
        </div>
      </div>

      {/* Preview Panel - Separate Box */}
      <CatalogPreview
        loading={previewLoading}
        error={previewError}
        data={previewData}
        onRetry={loadPreview}
        onLoadPreview={loadPreview}
      />
    </div>
  );
}
