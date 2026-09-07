import React, { useEffect, useRef } from 'react';

export default function AdminModalBackdrop({ children, onClose, canClose = true, labelledBy, className = 'admin-mail-backdrop' }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(document.activeElement);

  useEffect(() => {
    const previousFocus = previousFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(document.activeElement)) {
        (dialog.querySelector('input:not([readonly]), textarea, button, [tabindex="0"]') || dialog).focus();
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && canClose) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      const items = Array.from(dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
        .filter((element) => element.getClientRects().length > 0);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const focusOutside = !dialog.contains(document.activeElement) || document.activeElement === dialog;
      if (event.shiftKey && (document.activeElement === first || focusOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [canClose, onClose]);

  return (
    <div ref={dialogRef} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onClick={(event) => { if (event.target === event.currentTarget && canClose) onClose(); }}>
      {children}
    </div>
  );
}
