import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openModals = [];
let previousBodyOverflow;

export function useModalA11y(isOpen, onClose) {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement;
    if (openModals.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openModals.push(modalRef);

    const timer = setTimeout(() => {
      const modal = modalRef.current;
      if (!modal) return;
      const first = modal.querySelector(FOCUSABLE_SELECTOR);
      if (first) first.focus();
    }, 0);

    const handleKeyDown = (e) => {
      if (openModals.at(-1) !== modalRef) return;
      if (e.key === 'Escape') {
        if (
          e.target.closest?.(
            '.searchable-select.open, .multi-select.open, [role="combobox"][aria-expanded="true"]'
          )
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (e.key !== 'Tab') return;

      const modal = modalRef.current;
      if (!modal) return;

      const focusable = [...modal.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (
        e.shiftKey &&
        (document.activeElement === first || !modal.contains(document.activeElement))
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last || !modal.contains(document.activeElement))
      ) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown, true);
      const wasTopmost = openModals.at(-1) === modalRef;
      openModals.splice(openModals.indexOf(modalRef), 1);
      if (openModals.length === 0) document.body.style.overflow = previousBodyOverflow;
      if (
        wasTopmost &&
        previousFocusRef.current?.isConnected &&
        typeof previousFocusRef.current.focus === 'function'
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  return modalRef;
}
