import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Eye, 
  Save, 
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
  X
} from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { MultiSelect } from './MultiSelect';
import { SearchInput } from './SearchInput';
import { RangeSlider, SingleSlider } from './RangeSlider';

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

export function CatalogEditor({ 
  catalog, 
  genres = { movie: [], series: [] }, 
  genresLoading = false,
  refreshGenres = () => {},
  languages = [], 
  countries = [],
  sortOptions = { movie: [], series: [] }, 
  // eslint-disable-next-line no-unused-vars
  listTypes = { movie: [], series: [] },
  releaseTypes = [],
  tvStatuses = [],
  tvTypes = [],
  monetizationTypes = [],
  certifications = { movie: {}, series: {} },
  watchRegions = [],
  tvNetworks = [],
  onUpdate, 
  onPreview,
  onSave,
  // eslint-disable-next-line no-unused-vars
  isSaving,
  searchPerson,
  searchCompany,
  searchKeyword,
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
  const [expandedSections, setExpandedSections] = useState({
    basic: true,
    genres: true,
    filters: true,
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

  // Handle clicks on Include genre chips
  const handleIncludeGenreClick = useCallback((genreId) => {
    setLocalCatalog(prev => {
      const current = prev || DEFAULT_CATALOG;
      const included = current.filters?.genres || [];
      const excluded = current.filters?.excludeGenres || [];
      
      // Toggle: if already included, remove it; otherwise add it
      const isIncluded = included.includes(genreId);
      const newIncluded = isIncluded
        ? included.filter(id => id !== genreId)
        : [...included, genreId];
      
      // Remove from exclude list if present (mutual exclusivity)
      const newExcluded = excluded.filter(id => id !== genreId);
      
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

  // Handle clicks on Exclude genre chips
  const handleExcludeGenreClick = useCallback((genreId) => {
    setLocalCatalog(prev => {
      const current = prev || DEFAULT_CATALOG;
      const included = current.filters?.genres || [];
      const excluded = current.filters?.excludeGenres || [];
      
      // Toggle: if already excluded, remove it; otherwise add it
      const isExcluded = excluded.includes(genreId);
      const newExcluded = isExcluded
        ? excluded.filter(id => id !== genreId)
        : [...excluded, genreId];
      
      // Remove from include list if present (mutual exclusivity)
      const newIncluded = included.filter(id => id !== genreId);
      
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
            console.debug('[CatalogEditor] Resolving people ids:', initial.map(i => i.id));
            const resolved = await Promise.all(initial.map(async item => {
              if (item.name && !/^\d+$/.test(item.name)) return item;
              try {
                if (typeof getPersonById === 'function') {
                  console.debug('[CatalogEditor] getPersonById ->', item.id);
                  const resp = await getPersonById(item.id);
                  console.debug('[CatalogEditor] getPersonById resp ->', item.id, resp);
                  if (resp && resp.name) return { id: item.id, name: resp.name };
                }
                if (typeof searchPerson === 'function') {
                  console.debug('[CatalogEditor] searchPerson ->', item.id);
                  const sres = await searchPerson(item.id);
                  console.debug('[CatalogEditor] searchPerson resp ->', item.id, sres?.length);
                  if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || item.id };
                }
              } catch (err) {
                console.debug('[CatalogEditor] error resolving person', item.id, err);
              }
              return item;
            }));
            console.debug('[CatalogEditor] Resolved people:', resolved);
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
            console.debug('[CatalogEditor] Resolving company ids:', initial.map(i => i.id));
            const resolved = await Promise.all(initial.map(async item => {
              if (item.name && !/^\d+$/.test(item.name)) return item;
              try {
                if (typeof getCompanyById === 'function') {
                  console.debug('[CatalogEditor] getCompanyById ->', item.id);
                  const resp = await getCompanyById(item.id);
                  console.debug('[CatalogEditor] getCompanyById resp ->', item.id, resp);
                  if (resp && resp.name) return { id: item.id, name: resp.name };
                }
                if (typeof searchCompany === 'function') {
                  console.debug('[CatalogEditor] searchCompany ->', item.id);
                  const sres = await searchCompany(item.id);
                  console.debug('[CatalogEditor] searchCompany resp ->', item.id, sres?.length);
                  if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || sres[0].title || item.id };
                }
              } catch (err) {
                console.debug('[CatalogEditor] error resolving company', item.id, err);
              }
              return item;
            }));
            console.debug('[CatalogEditor] Resolved companies:', resolved);
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
            console.debug('[CatalogEditor] Resolving keyword ids:', initial.map(i => i.id));
            const resolved = await Promise.all(initial.map(async item => {
              if (item.name && !/^\d+$/.test(item.name)) return item;
              try {
                if (typeof getKeywordById === 'function') {
                  console.debug('[CatalogEditor] getKeywordById ->', item.id);
                  const resp = await getKeywordById(item.id);
                  console.debug('[CatalogEditor] getKeywordById resp ->', item.id, resp);
                  if (resp && resp.name) return { id: item.id, name: resp.name };
                }
                if (typeof searchKeyword === 'function') {
                  console.debug('[CatalogEditor] searchKeyword ->', item.id);
                  const sres = await searchKeyword(item.id);
                  console.debug('[CatalogEditor] searchKeyword resp ->', item.id, sres?.length);
                  if (Array.isArray(sres) && sres.length > 0) return { id: item.id, name: sres[0].name || item.id };
                }
              } catch (err) {
                console.debug('[CatalogEditor] error resolving keyword', item.id, err);
              }
              return item;
            }));
            console.debug('[CatalogEditor] Resolved keywords:', resolved);
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
      console.debug('[CatalogEditor] Resolving newly-selected people:', selectedPeople.map(p => p.id));
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
          } catch (err) {
            console.debug('[CatalogEditor] error resolving newly-selected person', item.id, err);
          }
          return item;
        }));
        if (!cancelled) {
          console.debug('[CatalogEditor] Resolved newly-selected people ->', resolved);
          setSelectedPeople(resolved);
        }
      } catch (err) {
        console.debug('[CatalogEditor] Error resolving newly-selected people batch', err);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedPeople, getPersonById, searchPerson]);

  useEffect(() => {
    let cancelled = false;
    const hasNumeric = selectedCompanies.some(c => /^\d+$/.test(String(c.name)));
    if (!hasNumeric) return;

    (async () => {
      console.debug('[CatalogEditor] Resolving newly-selected companies:', selectedCompanies.map(c => c.id));
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
          } catch (err) {
            console.debug('[CatalogEditor] error resolving newly-selected company', item.id, err);
          }
          return item;
        }));
        if (!cancelled) {
          console.debug('[CatalogEditor] Resolved newly-selected companies ->', resolved);
          setSelectedCompanies(resolved);
        }
      } catch (err) {
        console.debug('[CatalogEditor] Error resolving newly-selected companies batch', err);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedCompanies, getCompanyById, searchCompany]);

  useEffect(() => {
    let cancelled = false;
    const hasNumeric = selectedKeywords.some(k => /^\d+$/.test(String(k.name)));
    if (!hasNumeric) return;

    (async () => {
      console.debug('[CatalogEditor] Resolving newly-selected keywords:', selectedKeywords.map(k => k.id));
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
          } catch (err) {
            console.debug('[CatalogEditor] error resolving newly-selected keyword', item.id, err);
          }
          return item;
        }));
        if (!cancelled) {
          console.debug('[CatalogEditor] Resolved newly-selected keywords ->', resolved);
          setSelectedKeywords(resolved);
        }
      } catch (err) {
        console.debug('[CatalogEditor] Error resolving newly-selected keywords batch', err);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedKeywords, getKeywordById, searchKeyword]);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
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
    
    // Also calculate dates for immediate preview display
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    let fromDate, toDate;
    
    if (preset.days) {
      fromDate = new Date(Date.now() - preset.days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      toDate = todayStr;
    } else if (preset.year) {
      // This year: from Jan 1 to today
      fromDate = `${CURRENT_YEAR}-01-01`;
      toDate = todayStr;
    } else if (preset.lastYear) {
      // Last year: full year
      fromDate = `${CURRENT_YEAR - 1}-01-01`;
      toDate = `${CURRENT_YEAR - 1}-12-31`;
    }

    const isMovie = localCatalog?.type === 'movie';
    handleFiltersChange(isMovie ? 'releaseDateFrom' : 'airDateFrom', fromDate);
    handleFiltersChange(isMovie ? 'releaseDateTo' : 'airDateTo', toDate);
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

  // eslint-disable-next-line no-unused-vars
  const handleSave = () => {
    const catalogToSave = {
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
    if (catalog?._id) {
      onUpdate(catalog._id, catalogToSave);
    }
    onSave();
  };

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

  return (
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

        {/* Core Filters Section - Only show for Custom Discover */}
        {!isPresetCatalog && (
        <div className="filter-section">
          <button className="filter-section-header" onClick={() => toggleSection('filters')}>
            <Settings size={18} />
            <div className="filter-section-title-group">
              <h4 className="filter-section-title">Sort & Filter</h4>
              <span className="filter-section-desc">Sorting, language, year, rating</span>
            </div>
            {expandedSections.filters ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {expandedSections.filters && (
            <div className="filter-section-content">
              {/* Sort, Language, Country */}
              {supportsFullFilters && (
                <>
                  <div className="filter-grid">
                    <div className="filter-group">
                      <label className="filter-label">Sort By</label>
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
                      <label className="filter-label">Language</label>
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
                      <label className="filter-label">Country</label>
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
                      min={1900}
                      max={CURRENT_YEAR + 2}
                      step={1}
                      value={[
                        localCatalog?.filters?.yearFrom || 1900,
                        localCatalog?.filters?.yearTo || CURRENT_YEAR + 2
                      ]}
                      onChange={handleYearRangeChange}
                      formatValue={(v) => v}
                    />
                  </div>

                  {/* Rating Range Slider */}
                  <div style={{ marginTop: '20px' }}>
                    <RangeSlider
                      label="Rating"
                      min={0}
                      max={10}
                      step={0.5}
                      value={[
                        localCatalog?.filters?.ratingMin || 0,
                        localCatalog?.filters?.ratingMax || 10
                      ]}
                      onChange={handleRatingRangeChange}
                      formatValue={(v) => v.toFixed(1)}
                    />
                  </div>

                  {/* Runtime Range Slider */}
                  <div style={{ marginTop: '20px' }}>
                    <RangeSlider
                      label="Runtime (minutes)"
                      min={0}
                      max={400}
                      step={5}
                      value={[
                        localCatalog?.filters?.runtimeMin || 0,
                        localCatalog?.filters?.runtimeMax || 400
                      ]}
                      onChange={handleRuntimeRangeChange}
                      formatValue={(v) => v === 0 ? 'Any' : v === 400 ? '400+' : `${v}m`}
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

              {/* Minimum Votes Slider - Only for discover/random */}
              {supportsFullFilters && (
                <div style={{ marginTop: '20px' }}>
                  <SingleSlider
                    label="Minimum Votes"
                    min={0}
                    max={10000}
                    step={100}
                    value={localCatalog?.filters?.voteCountMin ?? 100}
                    onChange={(v) => handleFiltersChange('voteCountMin', v)}
                    formatValue={(v) => v.toLocaleString()}
                  />
                </div>
              )}
            </div>
          )}
        </div>        )}
        {/* Release/Air Date Section - Only for discover/random */}
        {supportsFullFilters && (
        <div className="filter-section">
          <button className="filter-section-header" onClick={() => toggleSection('release')}>
            <Calendar size={18} />
            <div className="filter-section-title-group">
              <h4 className="filter-section-title">{isMovie ? 'Release' : 'Air Date'} & Classification</h4>
              <span className="filter-section-desc">Date ranges, age ratings, release type</span>
            </div>
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
                  <label className="filter-label">
                    {isMovie ? 'Release' : 'Episode Air'} Date From
                    {!isMovie && <span className="filter-label-hint">When episodes aired</span>}
                  </label>
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
                  <label className="filter-label">
                    {isMovie ? 'Release' : 'Episode Air'} Date To
                  </label>
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
                    <label className="filter-label">
                      Show Premiered From
                      <span className="filter-label-hint">When show first aired (premiere date)</span>
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={localCatalog?.filters?.firstAirDateFrom || ''}
                      onChange={(e) => handleFiltersChange('firstAirDateFrom', e.target.value)}
                    />
                  </div>
                  <div className="filter-group">
                    <label className="filter-label">Show Premiered To</label>
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
                      <label className="filter-label">Release Type</label>
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
                      <label className="filter-label">Age Rating</label>
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
                    <label className="filter-label">
                      Release Region
                      <span className="filter-label-hint">Use regional release dates instead of worldwide premiere</span>
                    </label>
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
                      <label className="filter-label">Show Status</label>
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
                      <label className="filter-label">Show Type</label>
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

        {/* Streaming Section - Only for discover/random */}
        {supportsFullFilters && (
        <div className="filter-section">
          <button className="filter-section-header" onClick={() => toggleSection('streaming')}>
            <Play size={18} />
            <div className="filter-section-title-group">
              <h4 className="filter-section-title">Where to Watch</h4>
              <span className="filter-section-desc">Filter by streaming services and original networks</span>
            </div>
            {expandedSections.streaming ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {expandedSections.streaming && (
            <div className="filter-section-content">
              {/* TV Networks - only show for TV content */}
              {localCatalog?.type === 'series' && tvNetworks.length > 0 && (
                <div className="filter-group" style={{ marginBottom: '16px' }}>
                  <label className="filter-label">
                    Original Networks
                    <span className="filter-label-hint">Where the show originally aired (HBO, Netflix Originals, etc.)</span>
                  </label>
                  <MultiSelect
                    options={tvNetworks.map(n => ({ code: String(n.id), name: n.name }))}
                    value={(localCatalog?.filters?.withNetworks || '').split('|').filter(Boolean)}
                    onChange={(values) => handleFiltersChange('withNetworks', values.join('|'))}
                    placeholder="Any network"
                    searchPlaceholder="Search networks..."
                    labelKey="name"
                    valueKey="code"
                  />
                </div>
              )}

              {/* Streaming availability filters */}
              <div className="filter-two-col">
                <div className="filter-group">
                  <label className="filter-label">Your Region</label>
                  <SearchableSelect
                    options={watchRegions.map(r => ({ code: r.iso_3166_1, name: r.english_name }))}
                    value={localCatalog?.filters?.watchRegion || ''}
                    onChange={(value) => handleFiltersChange('watchRegion', value)}
                    placeholder="Select your region"
                    searchPlaceholder="Search regions..."
                    labelKey="name"
                    valueKey="code"
                  />
                </div>
                <div className="filter-group">
                  <label className="filter-label">Availability Type</label>
                  <MultiSelect
                    options={monetizationTypes}
                    value={localCatalog?.filters?.watchMonetizationTypes || []}
                    onChange={(value) => handleFiltersChange('watchMonetizationTypes', value)}
                    placeholder="Any"
                    labelKey="label"
                    valueKey="value"
                  />
                </div>
              </div>

              <div style={{ marginTop: '16px' }}>
                <label className="filter-label">
                  Streaming Services
                  <span className="filter-label-hint">
                    {localCatalog?.filters?.watchRegion && watchProviders.length > 0
                      ? 'Where you can currently watch in your region'
                      : 'Select your region to see available services'}
                  </span>
                </label>
                {localCatalog?.filters?.watchRegion && watchProviders.length > 0 ? (
                  <div className="provider-grid">
                    {watchProviders.slice(0, 20).map((provider) => (
                      <div
                        key={provider.id}
                        className={`provider-item ${(localCatalog?.filters?.watchProviders || []).includes(provider.id) ? 'selected' : ''}`}
                        onClick={() => handleProviderToggle(provider.id)}
                      >
                        {provider.logo ? (
                          <img src={provider.logo} alt={provider.name} className="provider-logo" />
                        ) : (
                          <div className="provider-logo" style={{ background: 'var(--bg-tertiary)' }} />
                        )}
                        <span className="provider-name">{provider.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="filter-hint" style={{ marginTop: '8px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                    Choose a region above to see streaming services available in that area
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Genres Section - Only for discover/random */}
        {supportsFullFilters && (
  <div className="filter-section">
    <button className="filter-section-header" onClick={() => toggleSection('genres')}>
      <Sparkles size={18} />
      <div className="filter-section-title-group">
        <h4 className="filter-section-title">Genres</h4>
        {selectedGenres.length > 0 && (
          <span className="filter-section-desc">{selectedGenres.length} selected</span>
        )}
      </div>
      {expandedSections.genres ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
    </button>

    {expandedSections.genres && (
      <div className="filter-section-content">
        {!genresLoadedForType ? (
          <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              {genresLoading ? 'Loading genres...' : 'Genres not available. This usually means TMDB metadata failed to load.'}
            </p>
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => refreshGenres()} disabled={genresLoading}>
                {genresLoading ? 'Refreshing...' : 'Retry loading genres'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Include Genres Section */}
            <div style={{ marginBottom: '20px' }}>
              <label className="filter-label" style={{ marginBottom: '8px', display: 'block' }}>
                Include Genres
                <span className="filter-label-hint"> Show content from these genres</span>
              </label>
              <div className="genre-grid">
                {currentGenres.map((genre) => (
                  <button
                    key={genre.id}
                    type="button"
                    className={`genre-chip ${selectedGenres.includes(genre.id) ? 'selected' : ''}`}
                    onClick={() => handleIncludeGenreClick(genre.id)}
                  >
                    <span className="genre-chip-label">{genre.name}</span>
                    {selectedGenres.includes(genre.id) && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>

            {/* Exclude Genres Section */}
            <div>
              <label className="filter-label" style={{ marginBottom: '8px', display: 'block' }}>
                Exclude Genres
                <span className="filter-label-hint"> Hide content from these genres</span>
              </label>
              <div className="genre-grid">
                {currentGenres.map((genre) => (
                  <button
                    key={genre.id}
                    type="button"
                    className={`genre-chip exclude ${excludedGenres.includes(genre.id) ? 'selected' : ''}`}
                    onClick={() => handleExcludeGenreClick(genre.id)}
                  >
                    <span className="genre-chip-label">{genre.name}</span>
                    {excludedGenres.includes(genre.id) && <X size={14} />}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    )}
  </div>
)}

        {/* People & Studios Section - Only for discover/random */}
        {supportsFullFilters && (
        <div className="filter-section">
          <button className="filter-section-header" onClick={() => toggleSection('people')}>
            <Users size={18} />
            <div className="filter-section-title-group">
              <h4 className="filter-section-title">People & Studios</h4>
              <span className="filter-section-desc">Filter by cast, crew, or production company</span>
            </div>
            {expandedSections.people ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {expandedSections.people && (
            <div className="filter-section-content">
              <div className="filter-stack">
                <div className="filter-group">
                  <label className="filter-label">Cast & Crew</label>
                  <SearchInput
                    type="person"
                    placeholder="Search actors, directors..."
                    onSearch={searchPerson}
                    selectedItems={selectedPeople}
                    onSelect={setSelectedPeople}
                    onRemove={setSelectedPeople}
                  />
                </div>
                <div className="filter-group">
                  <label className="filter-label">Studios / Companies</label>
                  <SearchInput
                    type="company"
                    placeholder="Search production companies..."
                    onSearch={searchCompany}
                    selectedItems={selectedCompanies}
                    onSelect={setSelectedCompanies}
                    onRemove={setSelectedCompanies}
                  />
                </div>
                <div className="filter-group">
                  <label className="filter-label">Keywords / Tags</label>
                  <SearchInput
                    type="keyword"
                    placeholder="Search keywords to include..."
                    onSearch={searchKeyword}
                    selectedItems={selectedKeywords}
                    onSelect={setSelectedKeywords}
                    onRemove={setSelectedKeywords}
                  />
                </div>
                <div className="filter-group">
                  <label className="filter-label">
                    Exclude Keywords
                    <span className="filter-label-hint">Results will NOT contain these keywords</span>
                  </label>
                  <SearchInput
                    type="keyword"
                    placeholder="Search keywords to exclude..."
                    onSearch={searchKeyword}
                    selectedItems={excludeKeywords}
                    onSelect={setExcludeKeywords}
                    onRemove={setExcludeKeywords}
                  />
                </div>
                <div className="filter-group">
                  <label className="filter-label">
                    Exclude Companies
                    <span className="filter-label-hint">Filter out content from these studios</span>
                  </label>
                  <SearchInput
                    type="company"
                    placeholder="Search companies to exclude..."
                    onSearch={searchCompany}
                    selectedItems={excludeCompanies}
                    onSelect={setExcludeCompanies}
                    onRemove={setExcludeCompanies}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
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
                  <span>Only show items with IMDB IDs</span>
                </label>
                {/* Include Adult - Only for discover/random */}
                {supportsFullFilters && (
                <label 
                  className="checkbox-label-row"
                  onClick={() => handleFiltersChange('includeAdult', !localCatalog?.filters?.includeAdult)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={`checkbox ${localCatalog?.filters?.includeAdult ? 'checked' : ''}`}>
                    {localCatalog?.filters?.includeAdult && <Check size={14} />}
                  </div>
                  <span>Include adult content</span>
                </label>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Preview Section */}
        <div className="preview-section">
          <div className="preview-header">
            <h4 className="preview-title">
              <Eye size={18} />
              Preview
            </h4>
            {previewData && (
              <span className="preview-count">
                {previewData.totalResults?.toLocaleString()} results
              </span>
            )}
          </div>

          {previewLoading && (
            <div className="preview-loading">
              <Loader size={32} className="animate-spin" />
              <p>Loading preview...</p>
            </div>
          )}

          {!previewLoading && previewError && (
            <div className="preview-error">
              <p>{previewError}</p>
              <button className="btn btn-secondary" onClick={loadPreview}>
                <RefreshCw size={16} />
                Retry
              </button>
            </div>
          )}

          {!previewLoading && !previewError && previewData && (
            <div className="preview-grid">
              {previewData.metas.map((item) => {
                // Build TMDB URL - use tmdbId if available, otherwise extract from id
                const tmdbId = item.tmdbId || (item.id?.startsWith('tmdb:') ? item.id.replace('tmdb:', '') : null);
                const tmdbUrl = tmdbId 
                  ? `https://www.themoviedb.org/${item.type === 'series' ? 'tv' : 'movie'}/${tmdbId}`
                  : null;
                
                return (
                  <a 
                    key={item.id} 
                    className="preview-card"
                    href={tmdbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`View "${item.name}" on TMDB`}
                  >
                    {item.poster ? (
                      <img src={item.poster} alt={item.name} loading="lazy" />
                    ) : (
                      <div className="preview-card-placeholder">
                        <ImageOff size={24} />
                      </div>
                    )}
                    <div className="preview-card-overlay">
                      <div className="preview-card-title">{item.name}</div>
                      <div className="preview-card-meta">
                        {item.releaseInfo && <span>{item.releaseInfo}</span>}
                        {item.imdbRating && (
                          <span className="preview-card-rating">
                            <Star size={10} fill="currentColor" />
                            {item.imdbRating}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}

          {!previewLoading && !previewError && !previewData && (
            <div className="preview-empty">
              <Eye size={32} />
              <p>Configure filters and click Preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
