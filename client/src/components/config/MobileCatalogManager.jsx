import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';

export function MobileCatalogManager({ onClose, children }) {
  const backRef = useRef(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="mobile-catalog-management" aria-label="Manage catalogs">
      <header className="mobile-catalog-management-header">
        <button ref={backRef} type="button" className="btn btn-secondary" onClick={onClose}>
          <ArrowLeft size={17} /> Back to workspace
        </button>
        <h2>Manage catalogs</h2>
      </header>
      {children}
    </section>
  );
}
