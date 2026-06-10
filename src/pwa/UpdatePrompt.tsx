import { useUpdatePrompt } from '@mister-guiiug/dev-wpa-config/react/use-update-prompt';

export function UpdatePrompt() {
  const { visible, update, snooze } = useUpdatePrompt({ snoozeHours: 24 });
  if (!visible) return null;
  return (
    <div
      role="status"
      className="card fixed inset-x-4 bottom-safe-3 z-40 mx-auto flex max-w-sm items-center gap-2 p-3 text-sm shadow-lg"
    >
      <span className="flex-1">Mise à jour disponible.</span>
      <button
        type="button"
        onClick={() => void update()}
        className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-[#06281a]"
      >
        Recharger
      </button>
      <button
        type="button"
        onClick={snooze}
        className="rounded-lg border border-[var(--sb-border)] px-3 py-1.5 font-medium"
      >
        Plus tard
      </button>
    </div>
  );
}
