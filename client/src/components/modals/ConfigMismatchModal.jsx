import { AlertTriangle, Home, LogIn } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

export function ConfigMismatchModal({ isOpen, onGoToOwn, onLoginNew }) {
  const modalRef = useModalA11y(isOpen, onGoToOwn);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div
        className="modal-card"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Access Restricted"
        style={{ maxWidth: '450px' }}
      >
        <div className="modal-header">
          <div className="modal-icon warning">
            <AlertTriangle size={24} />
          </div>
          <h2 className="modal-title">Access Restricted</h2>
        </div>

        <div className="modal-body">
          <p className="text-secondary" style={{ marginBottom: '20px', lineHeight: '1.5' }}>
            This configuration was created with a different TMDB API key. For security, you can only
            access configurations that match your current API key.
          </p>

          <div className="alert alert-info" style={{ marginBottom: '24px' }}>
            <strong>What would you like to do?</strong>
          </div>
        </div>

        <div
          className="modal-footer"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={onGoToOwn}
          >
            <Home size={18} />
            Go to my configurations
          </button>

          <button
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={onLoginNew}
          >
            <LogIn size={18} />
            Log in with a different key
          </button>
        </div>
      </div>
    </div>
  );
}
