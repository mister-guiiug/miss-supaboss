import { useUpdatePrompt } from '@mister-guiiug/dev-wpa-config/react/use-update-prompt';
import { useI18n } from '../i18n/index.ts';

export function UpdatePrompt() {
  const { t } = useI18n();
  const { visible, update, snooze } = useUpdatePrompt({ snoozeHours: 24 });
  if (!visible) return null;
  // Le bandeau flotte AU-DESSUS de la BottomNav (≈ 3,7rem de haut) + la zone
  // sûre iOS — sinon il recouvre les onglets et masque « Recharger / Plus tard ».
  return (
    <div
      role="status"
      style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 4.5rem)' }}
      className="card fixed inset-x-4 z-40 mx-auto flex max-w-sm items-center gap-2 p-3 text-sm shadow-lg"
    >
      <span className="flex-1">{t('update.available')}</span>
      <button
        type="button"
        onClick={() => void update()}
        className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-[#06281a]"
      >
        {t('update.reload')}
      </button>
      <button
        type="button"
        onClick={snooze}
        className="rounded-lg border border-[var(--sb-border)] px-3 py-1.5 font-medium"
      >
        {t('update.later')}
      </button>
    </div>
  );
}
