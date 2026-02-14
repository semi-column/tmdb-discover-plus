import { memo } from 'react';
import { Download as ArrowDownTrayIcon, Upload as ArrowUpTrayIcon } from 'lucide-react';

export const CatalogImportExport = memo(function CatalogImportExport({ localCatalog, onImport }) {
  const handleExport = () => {
    const dataStr = JSON.stringify(localCatalog, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(localCatalog.name || 'catalog').replace(/\s+/g, '_')}_config.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (
          imported &&
          typeof imported === 'object' &&
          typeof imported.name === 'string' &&
          (imported.type === 'movie' || imported.type === 'series') &&
          typeof imported.filters === 'object' &&
          imported.filters !== null
        ) {
          const { _id, ...rest } = imported;
          onImport(rest);
        } else {
          alert(
            'Invalid catalog format: requires name (string), type (movie|series), and filters (object)'
          );
        }
      } catch (err) {
        void err;
        alert('Failed to parse JSON');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <>
      <button className="btn btn-secondary" title="Export Catalog Config" onClick={handleExport}>
        <ArrowDownTrayIcon size={16} />
      </button>
      <label
        className="btn btn-secondary"
        title="Import Catalog Config"
        style={{ cursor: 'pointer' }}
      >
        <ArrowUpTrayIcon size={16} />
        <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
      </label>
    </>
  );
});
