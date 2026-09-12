import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { usePageScrollLock } from '../../lib/usePageScrollLock';

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Centred modal: blurred backdrop, 24px radius, scale-in entry, scrollable body
 * with the action row pinned below it. Focus moves into the panel on open and
 * Escape closes.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  usePageScrollLock(open);

  // Deliberately keyed on `open` alone: callers pass a new `onClose` closure
  // on every render, and re-running this on every keystroke inside the dialog
  // would re-focus the panel and steal focus from whatever input is active.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div className="absolute inset-0 bg-[#0B2530]/35 backdrop-blur-md animate-fade-in" onClick={onClose} />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-3xl border border-hairline bg-white shadow-overlay outline-none animate-scale-in ${WIDTHS[size] || WIDTHS.md}`}
        data-lenis-prevent
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
          <div className="min-w-0">
            <h2 id="dialog-title" className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="ui-icon-btn -mr-1.5 -mt-1" aria-label="Close dialog">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-hairline bg-surface-subtle px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
