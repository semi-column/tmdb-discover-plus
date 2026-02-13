import { useState, useCallback } from 'react';

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    setToasts((prev) => {
      const recentDupe = prev.find((t) => t.message === message && Date.now() - t.id < 2000);
      if (recentDupe) return prev;
      return [...prev, { id: Date.now(), message, type }];
    });
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
