import { useState, useEffect } from 'react';

const toPlaceholdersFromCsv = (csv, sep = ',') => {
  if (!csv) return [];
  return String(csv)
    .split(sep)
    .filter(Boolean)
    .map((id) => ({ id, name: id }));
};

const resolveItems = async (items, fetchById, search) => {
  if (!items || items.length === 0) return items;
  const needsResolution = items.some((item) => /^\d+$/.test(item.name) || item.name === item.id);
  
  if (!needsResolution && items.every(i => i.name)) return items;

  if (!fetchById && !search) return items;

  return await Promise.all(
    items.map(async (item) => {
      if (item.name && !/^\d+$/.test(item.name) && item.name !== item.id) return item;
      
      try {
        if (typeof fetchById === 'function') {
          const resp = await fetchById(item.id);
          if (resp && (resp.name || resp.title)) {
            return { id: item.id, name: resp.name || resp.title, logo: resp.logo };
          }
        }
        if (typeof search === 'function') {
          const sres = await search(item.id);
          if (Array.isArray(sres) && sres.length > 0)
            return { id: item.id, name: sres[0].name || sres[0].title || item.id, logo: sres[0].logo };
        }
      } catch {
        // silence resolution errors
      }
      return item;
    })
  );
};

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

  useEffect(() => {
    if (!catalog) {
      // Defer state resets to avoid synchronous cascading render warning
      Promise.resolve().then(() => {
        setSelectedPeople((prev) => (prev.length > 0 ? [] : prev));
        setSelectedCompanies((prev) => (prev.length > 0 ? [] : prev));
        setSelectedKeywords((prev) => (prev.length > 0 ? [] : prev));
        setExcludeKeywords((prev) => (prev.length > 0 ? [] : prev));
        setExcludeCompanies((prev) => (prev.length > 0 ? [] : prev));
        setSelectedNetworks((prev) => (prev.length > 0 ? [] : prev));
      });
      return;
    }

    // Wrap all state updates in a microtask to avoid synchronous cascading render warning
    Promise.resolve().then(() => {
      const { filters } = catalog;

      // People
      if (Array.isArray(filters?.withPeopleResolved) && filters.withPeopleResolved.length > 0) {
        setSelectedPeople(filters.withPeopleResolved.map((p) => ({ id: String(p.value), name: p.label })));
      } else {
        const initial = toPlaceholdersFromCsv(filters?.withPeople);
        setSelectedPeople(initial);
        resolveItems(initial, getPersonById, searchPerson).then(setSelectedPeople);
      }

      // Companies
      if (Array.isArray(filters?.withCompaniesResolved) && filters.withCompaniesResolved.length > 0) {
        setSelectedCompanies(filters.withCompaniesResolved.map((c) => ({ id: String(c.value), name: c.label })));
      } else {
        const initial = toPlaceholdersFromCsv(filters?.withCompanies);
        setSelectedCompanies(initial);
        resolveItems(initial, getCompanyById, searchCompany).then(setSelectedCompanies);
      }

      // Keywords
      if (Array.isArray(filters?.withKeywordsResolved) && filters.withKeywordsResolved.length > 0) {
        setSelectedKeywords(filters.withKeywordsResolved.map((k) => ({ id: String(k.value), name: k.label })));
      } else {
        const initial = toPlaceholdersFromCsv(filters?.withKeywords);
        setSelectedKeywords(initial);
        resolveItems(initial, getKeywordById, searchKeyword).then(setSelectedKeywords);
      }

      // Exclude Keywords
      const initialExcludeKw = toPlaceholdersFromCsv(filters?.excludeKeywords);
      setExcludeKeywords(initialExcludeKw);
      resolveItems(initialExcludeKw, getKeywordById, searchKeyword).then(setExcludeKeywords);

      // Exclude Companies
      const initialExcludeComp = toPlaceholdersFromCsv(filters?.excludeCompanies);
      setExcludeCompanies(initialExcludeComp);
      resolveItems(initialExcludeComp, getCompanyById, searchCompany).then(setExcludeCompanies);

      // Networks
      const initialNetworks = toPlaceholdersFromCsv(filters?.withNetworks, '|');
      setSelectedNetworks(initialNetworks);
      resolveItems(initialNetworks, getNetworkById).then(setSelectedNetworks);
    });

  }, [
    catalog,
    getPersonById,
    searchPerson,
    getCompanyById,
    searchCompany,
    getKeywordById,
    searchKeyword,
    getNetworkById
  ]);
  
  return {
    selectedPeople, setSelectedPeople,
    selectedCompanies, setSelectedCompanies,
    selectedKeywords, setSelectedKeywords,
    excludeKeywords, setExcludeKeywords,
    excludeCompanies, setExcludeCompanies,
    selectedNetworks, setSelectedNetworks,
  };
}
