import { Sparkles } from 'lucide-react';
import {
  IS_MOCK,
  REAL_AVAILABLE,
  isDemoSeed,
  switchDemoMode,
} from '../../api/index.ts';
import { useI18n } from '../../i18n/index.ts';

/**
 * Bandeau sticky sous le header : mode démo explicite sur Comptes / Projets
 * (évite d'ajouter un vrai PAT en croyant alimenter la flotte réelle).
 */
export function DemoModeBanner() {
  const { t } = useI18n();
  const demoOn = REAL_AVAILABLE ? IS_MOCK : isDemoSeed();
  if (!demoOn) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm"
    >
      <Sparkles
        size={16}
        aria-hidden="true"
        className="shrink-0 text-primary"
      />
      <p className="min-w-0 flex-1 text-[var(--sb-text)]">
        {REAL_AVAILABLE
          ? t('demoBanner.realAvailable')
          : t('demoBanner.forced')}
      </p>
      {REAL_AVAILABLE && (
        <button
          type="button"
          onClick={() => void switchDemoMode(false)}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-[#06281a]"
        >
          {t('demoBanner.switchReal')}
        </button>
      )}
    </div>
  );
}
