import { Calendar, Layers, Play, Settings, Sparkles, Users } from 'lucide-react';
import { memo, useEffect, useMemo } from 'react';
import { FilterPanel } from '../../FilterPanel';
import { FilterSection } from '../../FilterSection';
import { GenreSelector } from '../../GenreSelector';
import { OptionsPanel } from '../../OptionsPanel';
import { PeopleFilters } from '../../PeopleFilters';
import { ReleaseFilters } from '../../ReleaseFilters';
import { StremioExtras } from '../../StremioExtras';
import { StreamFilters } from '../../StreamFilters';

import { SearchInput } from '../../../../forms/SearchInput';
import { SearchableSelect } from '../../../../forms/SearchableSelect';

export const TmdbFilterPanel = memo(function TmdbFilterPanel({
  localCatalog,
  onFiltersChange,
  sortOptions,
  originalLanguages,
  countries,
  safeCountries,
  safeCertifications,
  safeGenres,
  releaseTypes,
  tvStatuses,
  tvTypes,
  watchRegions,
  watchProviders,
  monetizationTypes,
  tvNetworkOptions,
  selectedNetworks,
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
  searchPerson,
  searchCompany,
  searchKeyword,
  searchCollection,
  getCompanyById,
  getCollectionById,
  handleTVNetworkSearch,
  handleTriStateGenreClick,
  genresLoading,
  refreshGenres,
  expandedSections,
  onToggleSection,
  activeFilters,
  isPresetCatalog,
  supportsFullFilters,
  selectedCollection,
  setSelectedCollection,
  selectedStudio,
  setSelectedStudio,
}) {
  const catalogType = localCatalog?.type || 'movie';
  const isMovie = catalogType === 'movie';
  const isCollectionMode = catalogType === 'collection';
  const collectionMode = localCatalog?.filters?.listType === 'studio' ? 'studio' : 'collection';
  const isStudioMode = isCollectionMode && collectionMode === 'studio';

  const currentGenres = safeGenres[catalogType] || [];
  const selectedGenres = localCatalog?.filters?.genres || [];
  const excludedGenres = localCatalog?.filters?.excludeGenres || [];
  const certCountry = localCatalog?.filters?.certificationCountry || 'US';
  const certOptions = (safeCertifications[catalogType] || {})[certCountry] || [];
  const certCountryCodes = Object.keys(safeCertifications[catalogType] || {});
  const certCountries = safeCountries.filter((c) => certCountryCodes.includes(c.iso_3166_1));
  const getFilterCount = (section) => activeFilters.filter((f) => f.section === section).length;
  const collectionSortOptions = useMemo(() => {
    return (sortOptions?.movie || []).filter(
      (option) =>
        option.value === 'collection_order' ||
        option.value === 'release_date.desc' ||
        option.value === 'release_date.asc' ||
        option.value === 'title.asc' ||
        option.value === 'title.desc' ||
        option.value === 'popularity.desc' ||
        option.value === 'popularity.asc' ||
        option.value === 'vote_average.desc' ||
        option.value === 'vote_average.asc' ||
        option.value === 'vote_count.desc' ||
        option.value === 'vote_count.asc'
    );
  }, [sortOptions]);
  const collectionModeOptions = useMemo(
    () => [
      { value: 'collection', label: 'Collection' },
      { value: 'studio', label: 'Studio' },
    ],
    []
  );

  useEffect(() => {
    const currentCollectionId = localCatalog?.filters?.collectionId;
    if (!isCollectionMode || isStudioMode || !currentCollectionId || !getCollectionById) return;
    if (selectedCollection && String(selectedCollection.id) === String(currentCollectionId)) return;

    let cancelled = false;
    getCollectionById(currentCollectionId, localCatalog?.filters?.displayLanguage || '')
      .then((collection) => {
        if (cancelled || !collection) return;
        setSelectedCollection({
          id: collection.id,
          name: collection.name,
          poster_path: collection.poster_path,
          backdrop_path: collection.backdrop_path,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    getCollectionById,
    isCollectionMode,
    isStudioMode,
    localCatalog?.filters?.collectionId,
    localCatalog?.filters?.displayLanguage,
    selectedCollection,
    setSelectedCollection,
  ]);

  useEffect(() => {
    const currentStudioId = localCatalog?.filters?.studioId;
    if (!isCollectionMode || !isStudioMode || !currentStudioId || !getCompanyById) return;
    if (selectedStudio && String(selectedStudio.id) === String(currentStudioId)) return;

    let cancelled = false;
    getCompanyById(currentStudioId)
      .then((company) => {
        if (cancelled || !company) return;
        setSelectedStudio({
          id: company.id,
          name: company.name,
          logo_path: company.logoPath || null,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    getCompanyById,
    isCollectionMode,
    isStudioMode,
    localCatalog?.filters?.studioId,
    selectedStudio,
    setSelectedStudio,
  ]);

  return (
    <>
      {isCollectionMode && (
        <FilterSection
          id="collection"
          title="Collection / Studio"
          description="Choose one TMDB collection or one studio filmography"
          icon={Sparkles}
          isOpen={expandedSections.collection}
          onToggle={onToggleSection}
          badgeCount={
            isStudioMode
              ? localCatalog?.filters?.studioId
                ? 1
                : 0
              : localCatalog?.filters?.collectionId
                ? 1
                : 0
          }
        >
          <div className="filter-group">
            <span className="filter-label">Mode</span>
            <SearchableSelect
              options={collectionModeOptions}
              value={collectionMode}
              onChange={(value) => {
                if (value === 'studio') {
                  onFiltersChange('listType', 'studio');
                  onFiltersChange('collectionId', undefined);
                  onFiltersChange('collectionName', undefined);
                  onFiltersChange(
                    'studioId',
                    selectedStudio?.id ? String(selectedStudio.id) : localCatalog?.filters?.studioId
                  );
                  onFiltersChange(
                    'studioName',
                    selectedStudio?.name || localCatalog?.filters?.studioName
                  );
                  onFiltersChange('sortBy', undefined);
                  return;
                }

                onFiltersChange('listType', 'collection');
                onFiltersChange('studioId', undefined);
                onFiltersChange('studioName', undefined);
                onFiltersChange(
                  'collectionId',
                  selectedCollection?.id
                    ? String(selectedCollection.id)
                    : localCatalog?.filters?.collectionId
                );
                onFiltersChange(
                  'collectionName',
                  selectedCollection?.name || localCatalog?.filters?.collectionName
                );
                onFiltersChange(
                  'sortBy',
                  localCatalog?.filters?.listType === 'collection' && localCatalog?.filters?.sortBy
                    ? localCatalog.filters.sortBy
                    : 'collection_order'
                );
              }}
              placeholder="Collection"
              searchPlaceholder="Search..."
              labelKey="label"
              valueKey="value"
              allowClear={false}
            />
          </div>

          {!isStudioMode && (
            <>
              <div className="filter-group">
                <span className="filter-label">Find collection</span>
                <SearchInput
                  type="collection"
                  placeholder="Search TMDB collections..."
                  onSearch={async (query) => {
                    const response = await searchCollection(
                      query,
                      1,
                      localCatalog?.filters?.displayLanguage || ''
                    );
                    return response?.results || [];
                  }}
                  selectedItems={selectedCollection}
                  onSelect={(item) => {
                    const normalized = {
                      id: item.id,
                      name: item.name,
                      poster_path: item.posterPath || null,
                      backdrop_path: item.backdropPath || null,
                    };
                    setSelectedCollection(normalized);
                    onFiltersChange('listType', 'collection');
                    onFiltersChange('collectionId', String(normalized.id));
                    onFiltersChange('collectionName', normalized.name);
                    onFiltersChange('sortBy', localCatalog?.filters?.sortBy || 'collection_order');
                  }}
                  onRemove={() => {
                    setSelectedCollection(null);
                    onFiltersChange('listType', 'collection');
                    onFiltersChange('collectionId', undefined);
                    onFiltersChange('collectionName', undefined);
                    onFiltersChange('sortBy', 'collection_order');
                  }}
                  multiple={false}
                />
              </div>

              <div className="filter-group" style={{ marginTop: 12 }}>
                <span className="filter-label">Collection order</span>
                <SearchableSelect
                  options={collectionSortOptions}
                  value={localCatalog?.filters?.sortBy || 'collection_order'}
                  onChange={(value) => onFiltersChange('sortBy', value)}
                  placeholder="Collection Order"
                  searchPlaceholder="Search..."
                  labelKey="label"
                  valueKey="value"
                  allowClear={false}
                />
              </div>
            </>
          )}

          {isStudioMode && (
            <>
              <div className="filter-group">
                <span className="filter-label">Find studio</span>
                <SearchInput
                  type="company"
                  placeholder="Search TMDB studios..."
                  onSearch={async (query) => {
                    const response = await searchCompany(query);
                    return response || [];
                  }}
                  selectedItems={selectedStudio}
                  onSelect={(item) => {
                    const normalized = {
                      id: item.id,
                      name: item.name,
                      logo_path: item.logoPath || null,
                    };
                    setSelectedStudio(normalized);
                    onFiltersChange('listType', 'studio');
                    onFiltersChange('studioId', String(normalized.id));
                    onFiltersChange('studioName', normalized.name);
                    onFiltersChange('collectionId', undefined);
                    onFiltersChange('collectionName', undefined);
                    onFiltersChange('sortBy', undefined);
                  }}
                  onRemove={() => {
                    setSelectedStudio(null);
                    onFiltersChange('listType', 'studio');
                    onFiltersChange('studioId', undefined);
                    onFiltersChange('studioName', undefined);
                  }}
                  multiple={false}
                />
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Studio mode lists non-adult movies credited to this company using the official TMDB
                API, including video titles, ordered by popularity. Discover filters are disabled.
                Streaming availability is not the same as a studio credit.
              </div>
            </>
          )}
        </FilterSection>
      )}

      {!isPresetCatalog && !isCollectionMode && (
        <FilterSection
          id="filters"
          title="Sort & Filter"
          description="Sorting, language, year, rating"
          icon={Settings}
          isOpen={expandedSections.filters}
          onToggle={onToggleSection}
          badgeCount={getFilterCount('filters')}
        >
          <FilterPanel
            localCatalog={localCatalog}
            onFiltersChange={onFiltersChange}
            sortOptions={sortOptions}
            originalLanguages={originalLanguages}
            countries={countries}
          />
        </FilterSection>
      )}

      {supportsFullFilters && (
        <FilterSection
          id="release"
          title={`${isMovie ? 'Release' : 'Air Date'} & Classification`}
          description="Date ranges, age ratings, release type"
          icon={Calendar}
          isOpen={expandedSections.release}
          onToggle={onToggleSection}
          badgeCount={getFilterCount('release')}
        >
          <ReleaseFilters
            localCatalog={localCatalog}
            onFiltersChange={onFiltersChange}
            isMovie={isMovie}
            countries={countries}
            releaseTypes={releaseTypes}
            tvStatuses={tvStatuses}
            tvTypes={tvTypes}
            certOptions={certOptions}
            certCountries={certCountries}
          />
        </FilterSection>
      )}

      {supportsFullFilters && (
        <FilterSection
          id="streaming"
          title="Where to Watch"
          description="Filter by streaming services and original networks"
          icon={Play}
          isOpen={expandedSections.streaming}
          onToggle={onToggleSection}
          badgeCount={getFilterCount('streaming')}
        >
          <StreamFilters
            type={catalogType}
            tvNetworks={tvNetworkOptions}
            selectedNetworks={selectedNetworks}
            watchRegions={watchRegions}
            watchProviders={watchProviders}
            monetizationTypes={monetizationTypes}
            onNetworkSearch={handleTVNetworkSearch}
            filters={localCatalog?.filters || {}}
            onFiltersChange={onFiltersChange}
          />
        </FilterSection>
      )}

      {supportsFullFilters && (
        <FilterSection
          id="genres"
          title="Genres"
          description={
            activeFilters.find((f) => f.section === 'genres')?.label ||
            'Select genres to include/exclude'
          }
          icon={Sparkles}
          isOpen={expandedSections.genres}
          onToggle={onToggleSection}
          badgeCount={getFilterCount('genres')}
        >
          <GenreSelector
            genres={currentGenres}
            selectedGenres={selectedGenres}
            excludedGenres={excludedGenres}
            genreMatchMode={localCatalog?.filters?.genreMatchMode || 'any'}
            onInclude={handleTriStateGenreClick}
            onExclude={handleTriStateGenreClick}
            onClear={handleTriStateGenreClick}
            onSetMatchMode={(mode) => onFiltersChange('genreMatchMode', mode)}
            loading={genresLoading}
            onRefresh={refreshGenres}
          />
        </FilterSection>
      )}

      {supportsFullFilters && (
        <FilterSection
          id="people"
          title={isMovie ? 'People & Studios' : 'Studios & Keywords'}
          description={
            isMovie
              ? 'Filter by cast, crew, or production company'
              : 'Filter by production companies and keywords'
          }
          icon={Users}
          isOpen={expandedSections.people}
          onToggle={onToggleSection}
          badgeCount={getFilterCount('people')}
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
            showPeople={isMovie}
          />
        </FilterSection>
      )}

      {supportsFullFilters ? (
        <FilterSection
          id="options"
          title="Options"
          description="Include adult, video, randomize, or discover-only results"
          icon={Settings}
          isOpen={expandedSections.options}
          onToggle={onToggleSection}
        >
          <OptionsPanel
            localCatalog={localCatalog}
            onFiltersChange={onFiltersChange}
            isMovie={isMovie}
          />
        </FilterSection>
      ) : (
        !isCollectionMode && (
          <div className="preset-empty-state">
            <Sparkles size={32} className="preset-empty-icon" />
            <span className="preset-empty-text">
              This is a curated preset from TMDB and cannot be modified.
            </span>
          </div>
        )
      )}

      {!isCollectionMode && (
        <FilterSection
          id="extras"
          title="Stremio Extras"
          description="Expose filter dropdowns inside Stremio"
          icon={Layers}
          isOpen={expandedSections.extras}
          onToggle={onToggleSection}
          badgeCount={(localCatalog?.filters?.stremioExtras || []).length}
        >
          <StremioExtras localCatalog={localCatalog} onFiltersChange={onFiltersChange} />
        </FilterSection>
      )}
    </>
  );
});
