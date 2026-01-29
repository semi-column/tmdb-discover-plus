import { useState, useCallback } from 'react';

export function useConfirmDelete(onDelete, timeoutMs = 3000) {
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const requestDelete = useCallback(async (id, e) => {
    if (e) e.stopPropagation();

    if (confirmId === id) {
      setDeletingId(id);
      try {
        await onDelete(id);
      } finally {
        setDeletingId(null);
        setConfirmId(null);
      }
    } else {
      setConfirmId(id);
      setTimeout(() => setConfirmId(null), timeoutMs);
    }
  }, [confirmId, onDelete, timeoutMs]);

  const reset = useCallback(() => {
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
