import {
  STATUS_LABELS,
  statusGroup,
  type SupabaseProjectStatus,
} from '../../../shared/status.ts';

const GROUP_STYLES: Record<ReturnType<typeof statusGroup>, string> = {
  active: 'bg-[var(--sb-ok)]/15 text-[var(--sb-ok)]',
  paused: 'bg-[var(--sb-paused)]/15 text-[var(--sb-paused)]',
  transition: 'bg-[var(--sb-warn)]/15 text-[var(--sb-warn)] sb-pulse',
  error: 'bg-[var(--sb-critical)]/15 text-[var(--sb-critical)]',
  unknown: 'bg-[var(--sb-paused)]/15 text-[var(--sb-text-soft)]',
};

export function StatusBadge({ status }: { status: SupabaseProjectStatus }) {
  const group = statusGroup(status);
  return (
    <span
      data-testid="status-badge"
      data-group={group}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${GROUP_STYLES[group]}`}
    >
      <span aria-hidden="true" className="text-[0.6rem] leading-none">
        ●
      </span>
      {STATUS_LABELS[status]}
    </span>
  );
}
