import { SearchInput } from '../SearchInput';
import { LabelWithTooltip } from '../Tooltip';

export function PeopleFilters({
    selectedPeople,
    onSelectPeople,
    selectedCompanies,
    onSelectCompanies,
    selectedKeywords,
    onSelectKeywords,
    excludeKeywords,
    onExcludeKeywords,
    excludeCompanies,
    onExcludeCompanies,
    searchPerson,
    searchCompany,
    searchKeyword
}) {
    return (
        <div className="filter-stack">
            <div className="filter-group">
                <LabelWithTooltip
                    label="Cast & Crew"
                    tooltip="Find content featuring specific actors, directors, writers, or other crew members."
                />
                <SearchInput
                    type="person"
                    placeholder="Search actors, directors..."
                    onSearch={searchPerson}
                    selectedItems={selectedPeople}
                    onSelect={onSelectPeople}
                    onRemove={onSelectPeople}
                />
            </div>
            <div className="filter-group">
                <LabelWithTooltip
                    label="Studios / Companies"
                    tooltip="Filter by production companies (e.g., Warner Bros, Pixar)."
                />
                <SearchInput
                    type="company"
                    placeholder="Search production companies..."
                    onSearch={searchCompany}
                    selectedItems={selectedCompanies}
                    onSelect={onSelectCompanies}
                    onRemove={onSelectCompanies}
                />
            </div>
            <div className="filter-group">
                <LabelWithTooltip
                    label="Keywords / Tags"
                    tooltip="Search by themes or topics (e.g., 'time travel', 'heist')."
                />
                <SearchInput
                    type="keyword"
                    placeholder="Search keywords to include..."
                    onSearch={searchKeyword}
                    selectedItems={selectedKeywords}
                    onSelect={onSelectKeywords}
                    onRemove={onSelectKeywords}
                />
            </div>
            <div className="filter-group">
                <LabelWithTooltip
                    label="Exclude Keywords"
                    tooltip="Filter OUT content with these themes/topics."
                />
                <span className="filter-label-hint">Results will NOT contain these keywords</span>
                <SearchInput
                    type="keyword"
                    placeholder="Search keywords to exclude..."
                    onSearch={searchKeyword}
                    selectedItems={excludeKeywords}
                    onSelect={onExcludeKeywords}
                    onRemove={onExcludeKeywords}
                />
            </div>
            <div className="filter-group">
                <LabelWithTooltip
                    label="Exclude Companies"
                    tooltip="Filter OUT content from specific studios."
                />
                <span className="filter-label-hint">Filter out content from these studios</span>
                <SearchInput
                    type="company"
                    placeholder="Search companies to exclude..."
                    onSearch={searchCompany}
                    selectedItems={excludeCompanies}
                    onSelect={onExcludeCompanies}
                    onRemove={onExcludeCompanies}
                />
            </div>
        </div>
    );
}
