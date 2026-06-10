import { WifiOff } from 'lucide-react';

/** Hors ligne SANS dernier état connu : écran d'attente propre. */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <WifiOff
        size={48}
        aria-hidden="true"
        className="text-[var(--sb-paused)]"
      />
      <h1 className="text-xl font-bold">Connexion perdue</h1>
      <p className="text-sm text-[var(--sb-text-soft)]">
        Impossible de joindre le serveur Miss Supaboss et aucun état précédent
        n'est en cache sur cet appareil. Les actions pause / restauration ne
        sont jamais exécutées hors ligne.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a]"
      >
        Réessayer
      </button>
    </main>
  );
}
