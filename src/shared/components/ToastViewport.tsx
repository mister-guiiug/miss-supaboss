import { ToastViewport as DwcToastViewport } from '@mister-guiiug/dev-wpa-config/react/toast';
import { useUiStore } from '../../store/useUiStore.ts';

/**
 * La FILE reste dans `useUiStore` (émission possible hors React : stores,
 * services) ; le RENDU vient du socle — c'est le cas prévu par son
 * `ToastViewport` exporté seul : deux régions vivantes montées en permanence
 * (polite/assertive), plus de double annonce, libellés via `LabelsProvider`.
 */
export function ToastViewport() {
  const toasts = useUiStore(s => s.toasts);
  const dismiss = useUiStore(s => s.dismiss);
  return (
    <DwcToastViewport
      toasts={toasts.map(({ id, kind, message }) => ({
        id: String(id),
        tone: kind,
        message,
      }))}
      onDismiss={id => dismiss(Number(id))}
    />
  );
}
