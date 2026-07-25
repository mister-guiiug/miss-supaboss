import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../../i18n/index.ts';

/**
 * Feuille de confirmation modale (mobile-first, bottom sheet). Utilisée pour
 * TOUTE action pause/restore — jamais d'action irréversible sans accord.
 */
export function ConfirmSheet({
  open,
  title,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onCancel}
      onCancel={onCancel}
      className="m-auto w-full max-w-md self-end bg-transparent p-0 backdrop:bg-black/55 sm:self-center"
    >
      <div className="card mx-2 mb-2 space-y-4 rounded-2xl p-5 sm:mx-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        {children && <div className="text-sm">{children}</div>}
        <div className="flex gap-2">
          <button
            type="button"
            className="touch-target flex-1 rounded-xl border border-[var(--sb-border)] px-4 font-medium"
            onClick={onCancel}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`touch-target flex-1 rounded-xl px-4 font-semibold ${
              danger
                ? 'bg-[var(--sb-critical)] text-white'
                : 'bg-primary text-[#06281a]'
            } disabled:opacity-60`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('common.working') : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
