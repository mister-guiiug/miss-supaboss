import { useState } from 'react';
import { RefreshCw, WifiOff, X } from 'lucide-react';
import { formatRelative } from '../../../shared/format.ts';
import { FORCED_MOCK, IS_MOCK, switchDemoMode } from '../../api/index.ts';
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
      {IS_MOCK &&
        (FORCED_MOCK ? (
          // Build Pages : mock forcé, pas de sortie possible (pas de backend).
          <span
            className="rounded-full bg-primary/15 px-2 py-1 text-xs font-semibold text-primary"
            title="Données simulées — aucun appel à Supabase"
          >
            démo
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmExitDemo(true)}
            aria-label="Désactiver le mode démo"
            title="Désactiver le mode démo"
            className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1.5 text-xs font-semibold text-primary"
          >
            démo
            <X size={12} aria-hidden="true" />
          </button>
        ))}
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

      {IS_MOCK && !FORCED_MOCK && (
        <ConfirmSheet
          open={confirmExitDemo}
          title="Quitter le mode démo ?"
          confirmLabel="Désactiver la démo"
          onCancel={() => setConfirmExitDemo(false)}
          onConfirm={() => void switchDemoMode(false)}
        >
          <p>
            Retour aux données réelles — l'application se recharge. Les fixtures
            de démo restent en place pour la prochaine fois.
          </p>
        </ConfirmSheet>
      )}
    </header>
  );
}
