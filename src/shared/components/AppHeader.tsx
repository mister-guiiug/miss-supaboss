import { useState } from 'react';
import { RefreshCw, WifiOff, X } from 'lucide-react';
import { formatRelative } from '../../../shared/format.ts';
import {
  IS_MOCK,
  REAL_AVAILABLE,
  isDemoSeed,
  setDemoSeed,
  switchDemoMode,
} from '../../api/index.ts';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { useOnline } from '../hooks/useOnline.ts';
import { ConfirmSheet } from './ConfirmSheet.tsx';

export function AppHeader({ title }: { title: string }) {
  const loading = useFleetStore(s => s.loading);
  const fleet = useFleetStore(s => s.fleet);
  const fromCache = useFleetStore(s => s.fromCache);
  const cacheSavedAt = useFleetStore(s => s.cacheSavedAt);
  const loadFleet = useFleetStore(s => s.loadFleet);
  const loadMetrics = useFleetStore(s => s.loadMetrics);
  const online = useOnline();
  const [confirmExitDemo, setConfirmExitDemo] = useState(false);
  // Réel atteignable (backend, ou PWA + proxy) : badge présent en mode démo
  // (mock). PWA sans proxy : présent tant que les données d'exemple sont là.
  const demoOn = REAL_AVAILABLE ? IS_MOCK : isDemoSeed();

  const syncLabel = fromCache
    ? `hors ligne — état ${formatRelative(cacheSavedAt)}`
    : fleet
      ? `synchro ${formatRelative(fleet.generatedAt)}`
      : '';

  return (
    <header className="card sticky top-0 z-30 flex items-center gap-3 rounded-none border-x-0 border-t-0 px-4 pt-safe pb-2">
      <div className="min-w-0 flex-1 pt-2">
        <h1 className="truncate text-lg font-bold">{title}</h1>
        {syncLabel && (
          <p className="truncate text-xs text-[var(--sb-text-soft)]">
            {syncLabel}
          </p>
        )}
      </div>
      {demoOn && (
        <button
          type="button"
          onClick={
            REAL_AVAILABLE
              ? () => setConfirmExitDemo(true)
              : () => void setDemoSeed(false)
          }
          aria-label="Désactiver les données de démo"
          title="Désactiver les données de démo"
          className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1.5 text-xs font-semibold text-primary"
        >
          démo
          <X size={12} aria-hidden="true" />
        </button>
      )}
      {!online && (
        <span
          className="flex items-center gap-1 rounded-full bg-[var(--sb-warn)]/15 px-2 py-1 text-xs font-medium text-[var(--sb-warn)]"
          role="status"
        >
          <WifiOff size={13} aria-hidden="true" /> hors ligne
        </span>
      )}
      <button
        type="button"
        aria-label="Rafraîchir les données"
        className="touch-target mt-1 flex items-center justify-center rounded-xl border border-[var(--sb-border)] disabled:opacity-50"
        disabled={loading || !online}
        onClick={() => {
          void loadFleet(true);
          void loadMetrics(true);
        }}
      >
        <RefreshCw
          size={18}
          aria-hidden="true"
          className={loading ? 'animate-spin' : ''}
        />
      </button>

      {IS_MOCK && REAL_AVAILABLE && (
        <ConfirmSheet
          open={confirmExitDemo}
          title="Quitter le mode démo ?"
          confirmLabel="Désactiver la démo"
          onCancel={() => setConfirmExitDemo(false)}
          onConfirm={() => void switchDemoMode(false)}
        >
          <p>
            Retour aux données réelles — l'application se recharge. Les données
            de démo sont remises à zéro : la prochaine démo repartira propre.
          </p>
        </ConfirmSheet>
      )}
    </header>
  );
}
