import {
  Badge,
  type BadgeTone,
} from '@mister-guiiug/dev-wpa-config/react/badge';
import {
  STATUS_LABELS,
  statusGroup,
  type SupabaseProjectStatus,
} from '../../../shared/status.ts';

/**
 * Pastille d'état d'un projet Supabase. Le SAVOIR MÉTIER (statut brut → groupe
 * → libellé) reste ici ; le RENDU vient du `Badge` du socle (tons sémantiques,
 * contraste dérivé du thème via `components.css`).
 */
const GROUP_TONE: Record<ReturnType<typeof statusGroup>, BadgeTone> = {
  active: 'success',
  paused: 'muted',
  transition: 'warning',
  error: 'danger',
  unknown: 'muted',
};

export function StatusBadge({ status }: { status: SupabaseProjectStatus }) {
  const group = statusGroup(status);
  // `Badge` relaie les attributs inconnus sur le <span> : les crochets de test
  // (`data-testid`, `data-group`) passent par un spread, faute d'index
  // signature `data-*` dans ses props.
  const hooks = { 'data-testid': 'status-badge', 'data-group': group };
  return (
    <Badge
      {...hooks}
      tone={GROUP_TONE[group]}
      className={group === 'transition' ? 'sb-pulse' : undefined}
      icon={
        <span className="text-[0.6rem] leading-none" aria-hidden="true">
          ●
        </span>
      }
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}
