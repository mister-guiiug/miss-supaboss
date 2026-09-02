import {
  Skeleton,
  SkeletonGroup,
} from '@mister-guiiug/dev-wpa-config/react/skeleton';
import { useI18n } from '../../i18n/index.ts';

/**
 * Compositions maison des squelettes du socle : la barre (`Skeleton`) et le
 * conteneur annoncé (`SkeletonGroup`, `role="status"` + libellé lu) viennent
 * du paquet ; la FORME de carte est propre à l'app.
 */
function CardSkeleton() {
  return (
    <div className="card space-y-3 p-4">
      <Skeleton width="66%" height="1.25rem" />
      <Skeleton width="50%" />
      <Skeleton />
    </div>
  );
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  const { t } = useI18n();
  return (
    <SkeletonGroup label={t('common.loading')} className="gap-3">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </SkeletonGroup>
  );
}
