import { useState, useEffect, useRef, useCallback } from 'react';

export function toPlaceholdersFromCsv(csv, sep = ',') {
  if (!csv) return [];
  return String(csv)
    .split(sep)
    .filter(Boolean)
    .map((id) => ({ id, name: id }));
}

export async function resolveItems(items, fetchById, search) {
  if (!items || items.length === 0) return items;

  const needsResolution = items.some((item) => /^\d+$/.test(item.name) || item.name === item.id);
  if (!needsResolution && items.every((i) => i.name)) return items;
  if (!fetchById && !search) return items;

  return Promise.all(
    items.map(async (item) => {
      if (item.name && !/^\d+$/.test(item.name) && item.name !== item.id) {
        return item;
      }
      try {
        if (typeof fetchById === 'function') {
          const resp = await fetchById(item.id);
          if (resp && (resp.name || resp.title)) {
            return { id: item.id, name: resp.name || resp.title, logo: resp.logo };
          }
        }
        if (typeof search === 'function') {
          const sres = await search(item.id);
          if (Array.isArray(sres) && sres.length > 0) {
            return {
              id: item.id,
              name: sres[0].name || sres[0].title || item.id,
              logo: sres[0].logo,
            };
          }
        }
      } catch {
        // silence
      }
      return item;
    })
  );
}

export function useResolvedFilters({
  catalog,
  getPersonById,
  searchPerson,
  getCompanyById,
  searchCompany,
  getKeywordById,
  searchKeyword,
  getNetworkById,
}) {
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [excludeKeywords, setExcludeKeywords] = useState([]);
  const [excludeCompanies, setExcludeCompanies] = useState([]);
  const [selectedNetworks, setSelectedNetworks] = useState([]);

  const fnRef = useRef({
    getPersonById,
    searchPerson,
    getCompanyById,
    searchCompany,
    getKeywordById,
    searchKeyword,
    getNetworkById,
  });

  useEffect(() => {
    fnRef.current = {
      getPersonById,
      searchPerson,
      getCompanyById,
      searchCompany,
      getKeywordById,
      searchKeyword,
      getNetworkById,
    };
  });

  const resolvedRef = useRef({
    people: undefined,
    companies: undefined,
    keywords: undefined,
    excludeKeywords: undefined,
    excludeCompanies: undefined,
    networks: undefined,
  });

  const resolvePeople = useCallback((filterValue, resolvedValue) => {
    if (resolvedRef.current.people === filterValue) return;
    resolvedRef.current.people = filterValue;

    if (Array.isArray(resolvedValue) && resolvedValue.length > 0) {
      setSelectedPeople(resolvedValue.map((p) => ({ id: String(p.value), name: p.label })));
      return;
    }
    const initial = toPlaceholdersFromCsv(filterValue);
    setSelectedPeople(initial);
    if (initial.length > 0) {
      resolveItems(initial, fnRef.current.getPersonById, fnRef.current.searchPerson).then(
        setSelectedPeople
      );
    }
  }, []);

  const resolveCompanies = useCallback((filterValue, resolvedValue) => {
    if (resolvedRef.current.companies === filterValue) return;
    resolvedRef.current.companies = filterValue;

    if (Array.isArray(resolvedValue) && resolvedValue.length > 0) {
      setSelectedCompanies(resolvedValue.map((c) => ({ id: String(c.value), name: c.label })));
      return;
    }
    const initial = toPlaceholdersFromCsv(filterValue);
    setSelectedCompanies(initial);
    if (initial.length > 0) {
      resolveItems(initial, fnRef.current.getCompanyById, fnRef.current.searchCompany).then(
        setSelectedCompanies
      );
    }
  }, []);

  const resolveKeywords = useCallback((filterValue, resolvedValue) => {
    if (resolvedRef.current.keywords === filterValue) return;
    resolvedRef.current.keywords = filterValue;

    if (Array.isArray(resolvedValue) && resolvedValue.length > 0) {
      setSelectedKeywords(resolvedValue.map((k) => ({ id: String(k.value), name: k.label })));
      return;
    }
    const initial = toPlaceholdersFromCsv(filterValue);
    setSelectedKeywords(initial);
    if (initial.length > 0) {
      resolveItems(initial, fnRef.current.getKeywordById, fnRef.current.searchKeyword).then(
        setSelectedKeywords
      );
    }
  }, []);

  const resolveExcludeKeywords = useCallback((filterValue) => {
    if (resolvedRef.current.excludeKeywords === filterValue) return;
    resolvedRef.current.excludeKeywords = filterValue;

    const initial = toPlaceholdersFromCsv(filterValue);
    setExcludeKeywords(initial);
    if (initial.length > 0) {
      resolveItems(initial, fnRef.current.getKeywordById, fnRef.current.searchKeyword).then(
        setExcludeKeywords
      );
    }
  }, []);

  const resolveExcludeCompanies = useCallback((filterValue) => {
    if (resolvedRef.current.excludeCompanies === filterValue) return;
    resolvedRef.current.excludeCompanies = filterValue;

    const initial = toPlaceholdersFromCsv(filterValue);
    setExcludeCompanies(initial);
    if (initial.length > 0) {
      resolveItems(initial, fnRef.current.getCompanyById, fnRef.current.searchCompany).then(
        setExcludeCompanies
      );
    }
  }, []);

  const resolveNetworks = useCallback((filterValue) => {
    if (resolvedRef.current.networks === filterValue) return;
    resolvedRef.current.networks = filterValue;

    const initial = toPlaceholdersFromCsv(filterValue, '|');
    setSelectedNetworks(initial);
    if (initial.length > 0) {
      resolveItems(initial, fnRef.current.getNetworkById).then(setSelectedNetworks);
    }
  }, []);

  const catalogId = catalog?._id;
  const withPeople = catalog?.filters?.withPeople;
  const withPeopleResolved = catalog?.filters?.withPeopleResolved;
  const withCompanies = catalog?.filters?.withCompanies;
  const withCompaniesResolved = catalog?.filters?.withCompaniesResolved;
  const withKeywords = catalog?.filters?.withKeywords;
  const withKeywordsResolved = catalog?.filters?.withKeywordsResolved;
  const catalogExcludeKeywords = catalog?.filters?.excludeKeywords;
  const catalogExcludeCompanies = catalog?.filters?.excludeCompanies;
  const withNetworks = catalog?.filters?.withNetworks;

  // Effect for resolving filter values - only runs when we have a valid catalog
  useEffect(() => {
    if (!catalogId) {
      // Reset state in a microtask to avoid synchronous setState warning
      // This defers the state update to after the effect completes
      queueMicrotask(() => {
        setSelectedPeople([]);
        setSelectedCompanies([]);
        setSelectedKeywords([]);
        setExcludeKeywords([]);
        setExcludeCompanies([]);
        setSelectedNetworks([]);
        // Reset the resolution tracking ref
        resolvedRef.current = {
          people: undefined,
          companies: undefined,
          keywords: undefined,
          excludeKeywords: undefined,
          excludeCompanies: undefined,
          networks: undefined,
        };
      });
      return;
    }

    // Defer resolve calls to avoid synchronous setState in effect body
    queueMicrotask(() => {
      resolvePeople(withPeople, withPeopleResolved);
      resolveCompanies(withCompanies, withCompaniesResolved);
      resolveKeywords(withKeywords, withKeywordsResolved);
      resolveExcludeKeywords(catalogExcludeKeywords);
      resolveExcludeCompanies(catalogExcludeCompanies);
      resolveNetworks(withNetworks);
    });
  }, [
    catalogId,
    withPeople,
    withPeopleResolved,
    withCompanies,
    withCompaniesResolved,
    withKeywords,
    withKeywordsResolved,
    catalogExcludeKeywords,
    catalogExcludeCompanies,
    withNetworks,
    resolvePeople,
    resolveCompanies,
    resolveKeywords,
    resolveExcludeKeywords,
    resolveExcludeCompanies,
    resolveNetworks,
  ]);

  return {
    selectedPeople,
    setSelectedPeople,
    selectedCompanies,
    setSelectedCompanies,
    selectedKeywords,
    setSelectedKeywords,
    excludeKeywords,
    setExcludeKeywords,
    excludeCompanies,
    setExcludeCompanies,
    selectedNetworks,
    setSelectedNetworks,
  };
}
