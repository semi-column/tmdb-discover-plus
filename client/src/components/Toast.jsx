import { useEffect } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

export function Toast({ message, type = 'success', onClose, duration = 4000 }) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

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
      <button className="btn btn-ghost btn-icon" onClick={onClose}>
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
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}
