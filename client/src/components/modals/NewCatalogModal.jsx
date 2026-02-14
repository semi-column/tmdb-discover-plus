import { useState } from 'react';
import { X } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

export function NewCatalogModal({ isOpen, onClose, onAdd }) {
  const [name, setName] = useState('');
  const modalRef = useModalA11y(isOpen, onClose);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAdd({
      name: name.trim(),
      type: 'movie',
      filters: {
        listType: 'discover',
        genres: [],
        sortBy: 'popularity.desc',
        voteCountMin: 0,
      },
      enabled: true,
    });

    setName('');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create New Catalog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">Create New Catalog</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="filter-group">
              <label className="filter-label">Catalog Name</label>
              <input
                type="text"
                className="input"
                style={{ paddingLeft: '14px' }}
                placeholder="e.g., Top Rated Sci-Fi, Hindi Movies, Netflix Shows"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <span className="filter-label-hint" style={{ marginTop: '8px' }}>
                You can configure content type and filters after creating
              </span>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              Create Catalog
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
