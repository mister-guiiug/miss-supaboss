import { X } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore.ts';

const KIND_STYLES = {
  success: 'border-[var(--sb-ok)]/40',
  error: 'border-[var(--sb-critical)]/50',
  info: 'border-[var(--sb-border)]',
} as const;

export function ToastViewport() {
  const toasts = useUiStore(s => s.toasts);
  const dismiss = useUiStore(s => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-safe-3 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map(t => (
        <div
          key={t.id}
          role="status"
          className={`card pointer-events-auto flex w-full max-w-sm items-center gap-2 border px-3 py-2.5 text-sm shadow-lg ${KIND_STYLES[t.kind]}`}
        >
          <span aria-hidden="true">
            {t.kind === 'success' ? '✅' : t.kind === 'error' ? '⚠️' : 'ℹ️'}
          </span>
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            aria-label="Fermer la notification"
            className="touch-target -mr-1 flex items-center justify-center text-[var(--sb-text-soft)]"
            onClick={() => dismiss(t.id)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
