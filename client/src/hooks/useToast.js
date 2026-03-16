import { useState, useCallback, useRef } from 'react';

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const counterRef = useRef(0);

  const addToast = useCallback((message, type = 'success') => {
    setToasts((prev) => {
      const now = Date.now();
      const recentDupe = prev.find((t) => t.message === message && now - t.createdAt < 2000);
      if (recentDupe) return prev;
      counterRef.current += 1;
      return [...prev, { id: counterRef.current, message, type, createdAt: now }];
    });
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
