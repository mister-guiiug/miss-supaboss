import { Link } from 'react-router-dom';
import { Star, Zap } from 'lucide-react';
import type { ProjectDto } from '../../../shared/contracts.ts';
import { formatRelative } from '../../../shared/format.ts';
import { useI18n } from '../../i18n/index.ts';
import { StatusBadge } from './StatusBadge.tsx';

export function AccountChip({
  alias,
  color,
}: {
  alias: string;
  color: string;
}) {
  return (
    <span className="inline-flex max-w-40 items-center gap-1.5 rounded-full bg-[var(--sb-surface-2)] px-2 py-0.5 text-xs font-medium">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="truncate">{alias}</span>
    </span>
  );
}

export function ProjectCard({
  project,
  accountAlias,
  accountColor,
}: {
  project: ProjectDto;
  accountAlias: string;
  accountColor: string;
}) {
  const { t } = useI18n();
  const { meta } = project;
  // Le libellé porte le « depuis » : découper « il y a » dans la chaîne rendue
  // ne marchait qu'en français, et même là plus du tout — `Intl` dit « hier »
  // ou « avant-hier », sans préfixe à retirer.
  const never = t('common.never');
  const activity =
    project.status === 'INACTIVE'
      ? meta.pausedAt
        ? t('projectCard.pausedSince', {
            rel: formatRelative(meta.pausedAt, { never }),
          })
        : t('projectCard.pausedUnknown')
      : t('projectCard.activity', {
          rel: formatRelative(meta.lastSeenActiveAt, { never }),
        });

  return (
    <Link
      to={`/projects/${project.accountId}/${project.ref}`}
      className="card block p-4 transition-colors hover:border-primary/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            <span className="truncate">{project.name}</span>
            {meta.favorite && (
              <Star
                size={14}
                aria-label={t('common.favorite')}
                className="shrink-0 fill-[var(--sb-warn)] text-[var(--sb-warn)]"
              />
            )}
            {meta.demoFrequent && (
              <Zap
                size={14}
                aria-label={t('common.demoFrequent')}
                className="shrink-0 text-primary"
              />
            )}
          </p>
          <p className="truncate text-xs text-[var(--sb-text-soft)]">
            {project.ref} · {activity}
          </p>
        </div>
        <StatusBadge status={project.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <AccountChip alias={accountAlias} color={accountColor} />
        {meta.tags.map(tag => (
          <span
            key={tag}
            className="rounded-full border border-[var(--sb-border)] px-2 py-0.5 text-xs text-[var(--sb-text-soft)]"
          >
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}
