import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

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
      } catch (err) {
        console.warn('Filter resolution failed', err);
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

  // Shared shape behind resolvePeople/resolveCompanies/resolveKeywords/resolveExcludeKeywords/
  // resolveExcludeCompanies/resolveNetworks: skip if the raw filter value hasn't changed, apply
  // already-resolved `{value, label}` pairs directly, otherwise show CSV placeholders immediately
  // and resolve real names asynchronously by id (or by search fallback). `resolvedRef`/`fnRef` are
  // closed over (not passed as call arguments) so refs are only ever read inside the callback that
  // runs later, never synchronously while building the resolver during render.
  const makeResolver = useCallback(
    (refKey, setter, fetchByIdKey, searchKey, csvSep = ',') =>
      (filterValue, resolvedValue) => {
        if (resolvedRef.current[refKey] === filterValue) return;
        resolvedRef.current[refKey] = filterValue;

        if (Array.isArray(resolvedValue) && resolvedValue.length > 0) {
          setter(resolvedValue.map((item) => ({ id: String(item.value), name: item.label })));
          return;
        }
        const initial = toPlaceholdersFromCsv(filterValue, csvSep);
        setter(initial);
        if (initial.length > 0) {
          resolveItems(
            initial,
            fnRef.current[fetchByIdKey],
            searchKey ? fnRef.current[searchKey] : undefined
          ).then(setter);
        }
      },
    []
  );

  const resolvePeople = useMemo(
    () => makeResolver('people', setSelectedPeople, 'getPersonById', 'searchPerson'),
    [makeResolver]
  );

  const resolveCompanies = useMemo(
    () => makeResolver('companies', setSelectedCompanies, 'getCompanyById', 'searchCompany'),
    [makeResolver]
  );

  const resolveKeywords = useMemo(
    () => makeResolver('keywords', setSelectedKeywords, 'getKeywordById', 'searchKeyword'),
    [makeResolver]
  );

  const resolveExcludeKeywords = useMemo(
    () => makeResolver('excludeKeywords', setExcludeKeywords, 'getKeywordById', 'searchKeyword'),
    [makeResolver]
  );

  const resolveExcludeCompanies = useMemo(
    () => makeResolver('excludeCompanies', setExcludeCompanies, 'getCompanyById', 'searchCompany'),
    [makeResolver]
  );

  const resolveNetworks = useMemo(
    () => makeResolver('networks', setSelectedNetworks, 'getNetworkById', null, '|'),
    [makeResolver]
  );

  const catalogId = catalog?._id;
  const catalogFormState = catalog?.formState;
  const withPeople = catalog?.filters?.withPeople;
  const withPeopleResolved = catalog?.filters?.withPeopleResolved;
  const withCompanies = catalog?.filters?.withCompanies;
  const withCompaniesResolved = catalog?.filters?.withCompaniesResolved;
  const withKeywords = catalog?.filters?.withKeywords;
  const withKeywordsResolved = catalog?.filters?.withKeywordsResolved;
  const catalogExcludeKeywords = catalog?.filters?.excludeKeywords;
  const catalogExcludeCompanies = catalog?.filters?.excludeCompanies;
  const withNetworks = catalog?.filters?.withNetworks;

  useEffect(() => {
    if (!catalogId) {
      queueMicrotask(() => {
        setSelectedPeople([]);
        setSelectedCompanies([]);
        setSelectedKeywords([]);
        setExcludeKeywords([]);
        setExcludeCompanies([]);
        setSelectedNetworks([]);
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

    if (catalogFormState) {
      queueMicrotask(() => {
        if (catalogFormState.selectedPeople?.length > 0) {
          resolvedRef.current.people = withPeople;
          setSelectedPeople(catalogFormState.selectedPeople);
        } else {
          resolvePeople(withPeople, withPeopleResolved);
        }

        if (catalogFormState.selectedCompanies?.length > 0) {
          resolvedRef.current.companies = withCompanies;
          setSelectedCompanies(catalogFormState.selectedCompanies);
        } else {
          resolveCompanies(withCompanies, withCompaniesResolved);
        }

        if (catalogFormState.selectedKeywords?.length > 0) {
          resolvedRef.current.keywords = withKeywords;
          setSelectedKeywords(catalogFormState.selectedKeywords);
        } else {
          resolveKeywords(withKeywords, withKeywordsResolved);
        }

        if (catalogFormState.excludeKeywords?.length > 0) {
          resolvedRef.current.excludeKeywords = catalogExcludeKeywords;
          setExcludeKeywords(catalogFormState.excludeKeywords);
        } else {
          resolveExcludeKeywords(catalogExcludeKeywords);
        }

        if (catalogFormState.excludeCompanies?.length > 0) {
          resolvedRef.current.excludeCompanies = catalogExcludeCompanies;
          setExcludeCompanies(catalogFormState.excludeCompanies);
        } else {
          resolveExcludeCompanies(catalogExcludeCompanies);
        }

        if (catalogFormState.selectedNetworks?.length > 0) {
          resolvedRef.current.networks = withNetworks;
          setSelectedNetworks(catalogFormState.selectedNetworks);
        } else {
          resolveNetworks(withNetworks);
        }
      });
      return;
    }

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
    catalogFormState,
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
