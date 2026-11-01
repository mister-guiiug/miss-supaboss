import { Link } from 'react-router-dom';
import type { ProjectDto } from '../../../shared/contracts.ts';
import { formatRelative } from '../../../shared/format.ts';
import { isPausable } from '../../../shared/status.ts';
import { useI18n } from '../../i18n/index.ts';

export function ProjectCard({
  project,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onPause,
  pauseDisabled = false,
}: {
  project: ProjectDto;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onPause?: () => void;
  pauseDisabled?: boolean;
}) {
  const { t } = useI18n();
  const { meta } = project;
  const never = t('common.never');
  const when =
    project.status === 'INACTIVE'
      ? meta.pausedAt
        ? t('projectCard.pausedSince', {
            rel: formatRelative(meta.pausedAt, { never }),
          })
        : t('projectCard.pausedUnknown')
      : formatRelative(meta.lastSeenActiveAt, { never });

  const title = (
    <div className="min-w-0 flex-1">
      <p className="truncate font-semibold">{project.name}</p>
      <p className="truncate text-xs text-[var(--sb-text-soft)]">{when}</p>
    </div>
  );

  const showPause =
    Boolean(onPause) && isPausable(project.status) && !selectMode;

  if (selectMode) {
    return (
      <div
        className={`card flex items-center gap-3 px-3 py-2.5 ${selected ? 'border-primary/60' : ''}`}
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
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={e => e.stopPropagation()}
          aria-label={t('projects.selectAria', { name: project.name })}
          className="size-4 shrink-0 accent-[var(--sb-primary,#3ecf8e)]"
        />
        {title}
      </div>
    );
  }

  return (
    <div className="card flex items-center gap-2 px-3 py-2.5">
      <Link
        to={`/projects/${project.accountId}/${project.ref}`}
        className="min-w-0 flex-1"
      >
        {title}
      </Link>
      {showPause && (
        <button
          type="button"
          disabled={pauseDisabled}
          onClick={onPause}
          aria-label={t('projectCard.pauseAria', { name: project.name })}
          className="touch-target shrink-0 px-2 text-sm font-semibold text-primary disabled:opacity-50"
        >
          {t('projectCard.pause')}
        </button>
      )}
    </div>
  );
}
