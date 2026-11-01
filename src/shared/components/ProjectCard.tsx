import { Link } from 'react-router-dom';
import { Star, Zap } from 'lucide-react';
import type { ProjectDto } from '../../../shared/contracts.ts';
import { formatRelative } from '../../../shared/format.ts';
import { isPausable } from '../../../shared/status.ts';
import { useI18n } from '../../i18n/index.ts';
import { StatusBadge } from './StatusBadge.tsx';

function AccountChip({ alias, color }: { alias: string; color: string }) {
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
  selectMode = false,
  selected = false,
  onToggleSelect,
  compact = false,
  onPause,
  pauseDisabled = false,
}: {
  project: ProjectDto;
  accountAlias: string;
  accountColor: string;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** La section liste déjà le compte et l'organisation. */
  compact?: boolean;
  onPause?: () => void;
  pauseDisabled?: boolean;
}) {
  const { t } = useI18n();
  const { meta } = project;
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

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            {selectMode && (
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                onClick={e => e.stopPropagation()}
                aria-label={t('projects.selectAria', { name: project.name })}
                className="size-4 shrink-0 accent-[var(--sb-primary,#3ecf8e)]"
              />
            )}
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
            {compact
              ? activity
              : `${project.ref} · ${project.organizationSlug} · ${activity}`}
          </p>
        </div>
        <StatusBadge status={project.status} />
      </div>
      {(!compact || meta.tags.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!compact && (
            <AccountChip alias={accountAlias} color={accountColor} />
          )}
          {meta.tags.map(tag => {
            const isDemoTag =
              tag.startsWith('démo:') || tag.startsWith('demo:');
            return (
              <span
                key={tag}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  isDemoTag
                    ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                    : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
                }`}
              >
                {tag}
              </span>
            );
          })}
        </div>
      )}
    </>
  );

  const showPause =
    Boolean(onPause) && isPausable(project.status) && !selectMode;

  if (selectMode) {
    return (
      <div
        className={`card p-4 ${selected ? 'border-primary/60' : ''}`}
        onClick={onToggleSelect}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleSelect?.();
          }
        }}
        role="button"
        tabIndex={0}
      >
        {body}
      </div>
    );
  }

  if (!showPause) {
    return (
      <Link
        to={`/projects/${project.accountId}/${project.ref}`}
        className="card block p-4 transition-colors hover:border-primary/60"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="card p-4">
      <Link
        to={`/projects/${project.accountId}/${project.ref}`}
        className="block"
      >
        {body}
      </Link>
      <button
        type="button"
        disabled={pauseDisabled}
        onClick={onPause}
        aria-label={t('projectCard.pauseAria', { name: project.name })}
        className="touch-target mt-3 inline-flex items-center rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium disabled:opacity-50"
      >
        {t('projectDetail.pause')}
      </button>
    </div>
  );
}
