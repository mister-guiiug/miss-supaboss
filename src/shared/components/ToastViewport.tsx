import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore.ts';
import { useI18n } from '../../i18n/index.ts';

const KIND_STYLES = {
  success: 'border-[var(--sb-ok)]/40',
  error: 'border-[var(--sb-critical)]/50',
  info: 'border-[var(--sb-border)]',
} as const;

const KIND_ICON = {
  success: CircleCheck,
  error: TriangleAlert,
  info: Info,
} as const;

const KIND_ICON_COLOR = {
  success: 'text-[var(--sb-ok)]',
  error: 'text-[var(--sb-critical)]',
  info: 'text-[var(--sb-text-soft)]',
} as const;

export function ToastViewport() {
  const { t } = useI18n();
  const toasts = useUiStore(s => s.toasts);
  const dismiss = useUiStore(s => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-safe-3 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map(toast => {
        const Icon = KIND_ICON[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className={`card pointer-events-auto flex w-full max-w-sm items-center gap-2 border px-3 py-2.5 text-sm shadow-lg ${KIND_STYLES[toast.kind]}`}
          >
            <Icon
              size={18}
              aria-hidden="true"
              className={`shrink-0 ${KIND_ICON_COLOR[toast.kind]}`}
            />
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              aria-label={t('common.dismissToast')}
              className="touch-target -mr-1 flex items-center justify-center text-[var(--sb-text-soft)]"
              onClick={() => dismiss(toast.id)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
