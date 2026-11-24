import { Link } from 'react-router-dom';
import type { ProjectDto } from '../../../shared/contracts.ts';
import {
  formatDay,
  formatPercent,
  formatRelative,
} from '../../../shared/format.ts';
import {
  mainMetric,
  restoreCountdown,
  type RestoreUrgency,
} from '../../../shared/overview.ts';
import {
  DEFAULT_THRESHOLDS,
  quotaLevel,
  usageRatio,
  type AlertThresholds,
  type MetricValue,
  type QuotaLevel,
} from '../../../shared/quotas.ts';
import { isPausable, statusGroup } from '../../../shared/status.ts';
import { useI18n } from '../../i18n/index.ts';
import { StatusBadge } from './StatusBadge.tsx';

/**
 * L'échéance de restauration, colorée selon ce qu'il reste. « Plus tard » reste
 * discret : la ligne informe, elle n'alarme pas.
 */
const URGENCY_TEXT: Record<RestoreUrgency, string> = {
  expired: 'font-medium text-[var(--sb-critical)]',
  urgent: 'font-medium text-[var(--sb-critical)]',
  soon: 'text-[var(--sb-warn)]',
  later: 'text-[var(--sb-text-soft)]',
};

const LEVEL_TEXT: Record<QuotaLevel, string> = {
  ok: 'text-[var(--sb-text-soft)]',
  warn: 'text-[var(--sb-warn)]',
  high: 'text-[var(--sb-high)]',
  critical: 'text-[var(--sb-critical)]',
};

const LEVEL_FILL: Record<QuotaLevel, string> = {
  ok: 'var(--sb-ok)',
  warn: 'var(--sb-warn)',
  high: 'var(--sb-high)',
  critical: 'var(--sb-critical)',
};

export function ProjectCard({
  project,
  metrics = [],
  thresholds = DEFAULT_THRESHOLDS,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onPause,
  pauseDisabled = false,
}: {
  project: ProjectDto;
  /**
   * Les mesures du projet : la carte n'en montre que la plus remplie, et
   * seulement quand le projet tourne. Celles d'un projet en pause sont un
   * dernier état connu, pas une consommation.
   */
  metrics?: readonly MetricValue[];
  thresholds?: AlertThresholds;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onPause?: () => void;
  pauseDisabled?: boolean;
}) {
  const { t } = useI18n();
  const { meta } = project;
  const never = t('common.never');
  const group = statusGroup(project.status);
  const when =
    project.status === 'INACTIVE'
      ? meta.pausedAt
        ? t('projectCard.pausedSince', {
            rel: formatRelative(meta.pausedAt, { never }),
          })
        : t('projectCard.pausedUnknown')
      : formatRelative(meta.lastSeenActiveAt, { never });

  const countdown = restoreCountdown(project);
  const metric = group === 'active' ? mainMetric(metrics) : null;
  const ratio = metric ? usageRatio(metric) : null;
  const level = metric ? quotaLevel(metric, thresholds) : null;

  const title = (
    <div className="min-w-0 flex-1">
      <p className="truncate font-semibold">{project.name}</p>
      <p className="flex items-center gap-2 text-xs">
        <span className="truncate text-[var(--sb-text-soft)]">{when}</span>
        {metric && level && ratio !== null && (
          <span
            className={`ml-auto inline-flex shrink-0 items-center gap-1.5 ${LEVEL_TEXT[level]}`}
            data-testid="card-metric"
            data-level={level}
          >
            {/* Les deux textes sont des éléments flex : sans ce séparateur,
                le nom accessible du lien les colle (« 1 minuteBase 72 % »). */}
            <span className="sr-only"> · </span>
            <span
              aria-hidden="true"
              className="h-1.5 w-10 overflow-hidden rounded-full bg-[var(--sb-surface-2)]"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.min(ratio * 100, 100)}%`,
                  background: LEVEL_FILL[level],
                }}
              />
            </span>
            {t(`projectCard.metricShort.${metric.kind}`)} {formatPercent(ratio)}
          </span>
        )}
      </p>
      {countdown && (
        <p
          className={`truncate text-xs ${URGENCY_TEXT[countdown.urgency]}`}
          data-testid="card-restore"
          data-urgency={countdown.urgency}
        >
          {countdown.urgency === 'expired'
            ? t('projectCard.restoreExpired')
            : t('projectCard.restoreUntil', {
                date: formatDay(countdown.deadline),
                days: Math.max(countdown.days, 0),
              })}
        </p>
      )}
    </div>
  );

  // Actif et en pause se lisent déjà sur la ligne du dessous ; une transition
  // ou une erreur, non — et la liste « Actifs » les mêle aux projets qui
  // tournent.
  const badge =
    group === 'transition' || group === 'error' || group === 'unknown' ? (
      <StatusBadge status={project.status} />
    ) : null;

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
        {badge}
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
      {badge}
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
