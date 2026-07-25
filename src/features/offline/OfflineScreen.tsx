import { WifiOff } from 'lucide-react';
import { useI18n } from '../../i18n/index.ts';

/** Hors ligne SANS dernier état connu : écran d'attente propre. */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff
        size={48}
        aria-hidden="true"
        className="text-[var(--sb-paused)]"
      />
      <h1 className="text-xl font-bold">{t('offline.title')}</h1>
      <p className="text-sm text-[var(--sb-text-soft)]">{t('offline.body')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a]"
      >
        {t('common.retry')}
      </button>
    </main>
  );
}
