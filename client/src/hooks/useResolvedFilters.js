import { useState, useEffect } from 'react';

export function useResolvedFilters({
  catalog,
  getPersonById,
  searchPerson,
  getCompanyById,
  searchCompany,
  getKeywordById,
  searchKeyword,
}) {
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [excludeKeywords, setExcludeKeywords] = useState([]);
  const [excludeCompanies, setExcludeCompanies] = useState([]);

  // Converts CSV ID strings (e.g., "123,456") to placeholder objects for initial display
  const toPlaceholdersFromCsv = (csv) => {
    if (!csv) return [];
    return String(csv)
      .split(',')
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
            if (resp && (resp.name || resp.title)) return { id: item.id, name: resp.name || resp.title };
          }
          if (typeof search === 'function') {
            const sres = await search(item.id);
            if (Array.isArray(sres) && sres.length > 0)
              return { id: item.id, name: sres[0].name || sres[0].title || item.id };
          }
        } catch (e) {
          void e;
        }
        return item;
      })
    );
  };

  useEffect(() => {
    if (!catalog) {
      if (selectedPeople.length > 0) setSelectedPeople([]); // eslint-disable-line react-hooks/set-state-in-effect
      if (selectedCompanies.length > 0) setSelectedCompanies([]);
      if (selectedKeywords.length > 0) setSelectedKeywords([]);
      if (excludeKeywords.length > 0) setExcludeKeywords([]);
      if (excludeCompanies.length > 0) setExcludeCompanies([]);
      return;
    }

    const peopleResolved = catalog.filters?.withPeopleResolved || null;
    if (Array.isArray(peopleResolved) && peopleResolved.length > 0) {
      setSelectedPeople(peopleResolved.map((p) => ({ id: String(p.value), name: p.label })));
    } else {
      const initial = toPlaceholdersFromCsv(catalog.filters?.withPeople);
      setSelectedPeople(initial);
      resolveItems(initial, getPersonById, searchPerson).then(setSelectedPeople);
    }

    const companiesResolved = catalog.filters?.withCompaniesResolved || null;
    if (Array.isArray(companiesResolved) && companiesResolved.length > 0) {
      setSelectedCompanies(companiesResolved.map((c) => ({ id: String(c.value), name: c.label })));
    } else {
      const initial = toPlaceholdersFromCsv(catalog.filters?.withCompanies);
      setSelectedCompanies(initial);
      resolveItems(initial, getCompanyById, searchCompany).then(setSelectedCompanies);
    }

    const keywordsResolved = catalog.filters?.withKeywordsResolved || null;
    if (Array.isArray(keywordsResolved) && keywordsResolved.length > 0) {
      setSelectedKeywords(keywordsResolved.map((k) => ({ id: String(k.value), name: k.label })));
    } else {
      const initial = toPlaceholdersFromCsv(catalog.filters?.withKeywords);
      setSelectedKeywords(initial);
      resolveItems(initial, getKeywordById, searchKeyword).then(setSelectedKeywords);
    }

    const excludeKwTotal = toPlaceholdersFromCsv(catalog.filters?.excludeKeywords);
    setExcludeKeywords(excludeKwTotal);
    resolveItems(excludeKwTotal, getKeywordById, searchKeyword).then(setExcludeKeywords);

    const excludeCompTotal = toPlaceholdersFromCsv(catalog.filters?.excludeCompanies);
    setExcludeCompanies(excludeCompTotal);
    resolveItems(excludeCompTotal, getCompanyById, searchCompany).then(setExcludeCompanies);

  }, [ // eslint-disable-next-line react-hooks/exhaustive-deps
    catalog?._id,
  ]);

  useEffect(() => {
    resolveItems(selectedPeople, getPersonById, searchPerson).then(res => {
        if (JSON.stringify(res) !== JSON.stringify(selectedPeople)) setSelectedPeople(res);
    });
  }, [selectedPeople, getPersonById, searchPerson]);

  useEffect(() => {
    resolveItems(selectedCompanies, getCompanyById, searchCompany).then(res => {
         if (JSON.stringify(res) !== JSON.stringify(selectedCompanies)) setSelectedCompanies(res);
    });
  }, [selectedCompanies, getCompanyById, searchCompany]);
  
  return {
    selectedPeople, setSelectedPeople,
    selectedCompanies, setSelectedCompanies,
    selectedKeywords, setSelectedKeywords,
    excludeKeywords, setExcludeKeywords,
    excludeCompanies, setExcludeCompanies,
  };
}
