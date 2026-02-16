import { useState, useCallback, useRef, useEffect } from 'react';

export function useConfirmDelete(onDelete, timeoutMs = 3000) {
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const requestDelete = useCallback(
    async (id, e) => {
      if (e) e.stopPropagation();

      if (confirmId === id) {
        clearTimeout(timerRef.current);
        setDeletingId(id);
        try {
          await onDelete(id);
        } finally {
          setDeletingId(null);
          setConfirmId(null);
        }
      } else {
        clearTimeout(timerRef.current);
        setConfirmId(id);
        timerRef.current = setTimeout(() => setConfirmId(null), timeoutMs);
      }
    },
    [confirmId, onDelete, timeoutMs]
  );

  const reset = useCallback(() => {
    clearTimeout(timerRef.current);
    setConfirmId(null);
    setDeletingId(null);
  }, []);

  return {
    confirmId,
    deletingId,
    requestDelete,
    reset,
  };
}
