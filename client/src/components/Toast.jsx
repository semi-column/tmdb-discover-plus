import { useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

export function Toast({ id, message, type = 'success', removeToast, duration = 2500 }) {
  // Create stable callback reference
  const handleClose = useCallback(() => {
    removeToast(id);
  }, [id, removeToast]);

  useEffect(() => {
    const timer = setTimeout(handleClose, duration);
    return () => clearTimeout(timer);
  }, [handleClose, duration]);

  return (
    <div className={`toast ${type}`}>
      <div className="toast-icon">
        {type === 'success' ? (
          <CheckCircle size={20} color="var(--success)" />
        ) : (
          <XCircle size={20} color="var(--error)" />
        )}
      </div>
      <span className="toast-message">{message}</span>
      <button className="btn btn-ghost btn-icon" onClick={handleClose}>
        <X size={16} />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          removeToast={removeToast}
        />
      ))}
    </div>
  );
}
