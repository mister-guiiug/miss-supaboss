import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, PauseCircle, PlayCircle, Trash2 } from 'lucide-react';
import type {
  ScheduleCreateBody,
  ScheduleDto,
} from '../../../shared/contracts.ts';
import { DEFAULT_SCHEDULE_TIMEZONE } from '../../../shared/schedule.ts';
import { formatDateTime, formatRelative } from '../../../shared/format.ts';
import { api, ApiError } from '../../api/index.ts';
import { useI18n } from '../../i18n/index.ts';
import { useActionGuard } from '../../shared/hooks/useActionGuard.ts';
import { getQueryClient } from '../../shared/queries/client.ts';
import { queryKeys } from '../../shared/queries/keys.ts';
import { useSessionStore } from '../../store/useSessionStore.ts';
import { toast } from '../../store/useUiStore.ts';

const INPUT =
  'mt-1 min-h-11 w-full rounded-xl border border-[var(--dwc-border-strong)] bg-transparent px-3 py-2.5 text-sm';

/** Choix « segmenté » : un vrai bouton radio, étiqueté, de 44 px. */
const CHOICE =
  'touch-target flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--dwc-border-strong)] px-3 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary/15';

/** 1er janvier 2024 = lundi : `Date.UTC(2024, 0, n)` tombe le n-ième jour ISO. */
function weekdayName(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(2024, 0, weekday));
}

/** Heure MURALE `YYYY-MM-DDTHH:mm`, affichée telle quelle (pas de conversion). */
function wallDateTime(at: string, locale: string): string {
  const [date = '', time = ''] = at.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0));
}

/** Demain 19:00, heure locale du navigateur, au format du champ. */
function tomorrowEvening(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:00`;
}

/** Fuseaux proposés : ceux du moteur, plus le défaut et celui du navigateur. */
function timeZones(): string[] {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const all =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
  return [...new Set([DEFAULT_SCHEDULE_TIMEZONE, own, 'UTC', ...all])].sort();
}

/**
 * Plannings d'un projet : la liste avec la prochaine exécution, l'ajout et
 * la suppression. Écrire est réservé à qui peut déjà mettre en pause.
 */
export function SchedulesSection({
  accountId,
  projectRef,
}: {
  accountId: string;
  projectRef: string;
}) {
  const { t, locale } = useI18n();
  const controller = api.schedules;
  const user = useSessionStore(s => s.user);
  const guard = useActionGuard({ online: true, operate: true, writable: true });
  const query = useQuery({
    queryKey: queryKeys.schedules(accountId, projectRef),
    queryFn: () => {
      if (!controller) throw new Error('schedules: indisponible');
      return controller.list(accountId, projectRef);
    },
    enabled: controller !== undefined,
  });

  const [action, setAction] = useState<'pause' | 'restore'>('pause');
  const [kind, setKind] = useState<'once' | 'weekly'>('weekly');
  const [at, setAt] = useState(tomorrowEvening);
  const [weekday, setWeekday] = useState(5);
  const [time, setTime] = useState('19:00');
  const [timezone, setTimezone] = useState(DEFAULT_SCHEDULE_TIMEZONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(), []);

  if (!controller) {
    return (
      <section className="card space-y-2 p-4" aria-label={t('schedules.aria')}>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
          <CalendarClock size={15} aria-hidden="true" />{' '}
          {t('schedules.heading')}
        </h2>
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('schedules.serverOnly')}
        </p>
      </section>
    );
  }

  const refresh = (): void => {
    const client = getQueryClient();
    void client.invalidateQueries({
      queryKey: queryKeys.schedules(accountId, projectRef),
    });
    void client.invalidateQueries({ queryKey: ['operations'] });
  };

  const describe = (s: ScheduleDto): string => {
    if (s.kind === 'weekly') {
      const params = {
        day: weekdayName(s.weekday ?? 1, locale),
        time: s.time ?? '',
      };
      return s.action === 'pause'
        ? t('schedules.pauseWeekly', params)
        : t('schedules.restoreWeekly', params);
    }
    const params = { date: wallDateTime(s.at ?? '', locale) };
    return s.action === 'pause'
      ? t('schedules.pauseOnce', params)
      : t('schedules.restoreOnce', params);
  };

  const nextLine = (s: ScheduleDto): string => {
    if (!s.nextRunAt) return t('schedules.done');
    // « Passée » à l'instant de la lecture — une horloge lue au rendu
    // rendrait l'affichage instable.
    if (
      !controller.runsInBackground &&
      Date.parse(s.nextRunAt) < query.dataUpdatedAt
    ) {
      return t('schedules.pastDemo');
    }
    return t('schedules.next', {
      date: formatDateTime(s.nextRunAt),
      rel: formatRelative(s.nextRunAt, { never: t('common.never') }),
    });
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const body: ScheduleCreateBody =
      kind === 'once'
        ? { kind, action, at, timezone }
        : { kind, action, weekday, time, timezone };
    setBusy(true);
    setError(null);
    try {
      await controller.create(accountId, projectRef, body);
      toast.success(t('schedules.added'));
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('schedules.addFail'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: ScheduleDto): Promise<void> => {
    try {
      await controller.remove(accountId, projectRef, s.id);
      toast.success(t('schedules.deleted'));
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t('schedules.deleteFail')
      );
    }
  };

  const schedules = query.data ?? [];

  return (
    <section className="card space-y-3 p-4" aria-label={t('schedules.aria')}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
        <CalendarClock size={15} aria-hidden="true" /> {t('schedules.heading')}
      </h2>
      {!controller.runsInBackground && (
        <p className="rounded-xl border border-[var(--sb-warn)] px-3 py-2 text-xs text-[var(--sb-warn)]">
          {t('schedules.demoNotice')}
        </p>
      )}

      {query.isError ? (
        <p className="text-sm text-[var(--sb-warn)]">
          {t('schedules.loadFail')}
        </p>
      ) : query.isLoading ? (
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('common.loading')}
        </p>
      ) : schedules.length === 0 ? (
        <p className="text-sm text-[var(--sb-text-soft)]">
          {t('schedules.empty')}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={t('schedules.listAria')}>
          {schedules.map(s => {
            const label = describe(s);
            return (
              <li
                key={s.id}
                className="flex items-start gap-2 rounded-xl bg-[var(--sb-surface-2)] p-3"
              >
                {s.action === 'pause' ? (
                  <PauseCircle
                    size={18}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                  />
                ) : (
                  <PlayCircle
                    size={18}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-primary"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {label}{' '}
                    <span className="text-xs text-[var(--sb-text-soft)]">
                      ({s.timezone})
                    </span>
                  </p>
                  <p className="text-xs text-[var(--sb-text-soft)]">
                    {nextLine(s)}
                  </p>
                  {s.lastStatus && s.lastRunAt && (
                    <p
                      className={`text-xs ${
                        s.lastStatus === 'ok'
                          ? 'text-[var(--sb-ok)]'
                          : 'text-[var(--sb-warn)]'
                      }`}
                    >
                      {t('schedules.last', {
                        rel: formatRelative(s.lastRunAt, {
                          never: t('common.never'),
                        }),
                        status: t(`schedules.status.${s.lastStatus}`),
                      })}
                      {s.lastDetail ? ` — ${s.lastDetail}` : ''}
                    </p>
                  )}
                </div>
                {guard.allowed && (
                  <button
                    type="button"
                    onClick={() => void remove(s)}
                    aria-label={t('schedules.deleteAria', { label })}
                    className="touch-target flex shrink-0 items-center justify-center rounded-xl text-[var(--sb-critical)]"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {guard.allowed ? (
        <form className="space-y-3" onSubmit={e => void submit(e)}>
          <h3 className="text-sm font-semibold">{t('schedules.addTitle')}</h3>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-[var(--sb-text-soft)]">
              {t('schedules.action')}
            </legend>
            <div className="flex gap-2">
              <label className={CHOICE}>
                <input
                  type="radio"
                  name="schedule-action"
                  checked={action === 'pause'}
                  onChange={() => setAction('pause')}
                />
                {t('schedules.actionPause')}
              </label>
              <label className={CHOICE}>
                <input
                  type="radio"
                  name="schedule-action"
                  checked={action === 'restore'}
                  onChange={() => setAction('restore')}
                />
                {t('schedules.actionRestore')}
              </label>
            </div>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-[var(--sb-text-soft)]">
              {t('schedules.kind')}
            </legend>
            <div className="flex gap-2">
              <label className={CHOICE}>
                <input
                  type="radio"
                  name="schedule-kind"
                  checked={kind === 'weekly'}
                  onChange={() => setKind('weekly')}
                />
                {t('schedules.kindWeekly')}
              </label>
              <label className={CHOICE}>
                <input
                  type="radio"
                  name="schedule-kind"
                  checked={kind === 'once'}
                  onChange={() => setKind('once')}
                />
                {t('schedules.kindOnce')}
              </label>
            </div>
          </fieldset>
          {kind === 'once' ? (
            <label className="block">
              <span className="text-xs font-medium text-[var(--sb-text-soft)]">
                {t('schedules.at')}
              </span>
              <input
                type="datetime-local"
                required
                value={at}
                onChange={e => setAt(e.target.value)}
                className={INPUT}
              />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-medium text-[var(--sb-text-soft)]">
                  {t('schedules.weekday')}
                </span>
                <select
                  value={weekday}
                  onChange={e => setWeekday(Number(e.target.value))}
                  className={INPUT}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map(d => (
                    <option key={d} value={d}>
                      {weekdayName(d, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--sb-text-soft)]">
                  {t('schedules.time')}
                </span>
                <input
                  type="time"
                  required
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  className={INPUT}
                />
              </label>
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium text-[var(--sb-text-soft)]">
              {t('schedules.timezone')}
            </span>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className={INPUT}
            >
              {zones.map(z => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-sm text-[var(--sb-critical)]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="touch-target w-full rounded-xl bg-primary px-4 font-semibold text-[#06281a] disabled:opacity-50"
          >
            {t('schedules.add')}
          </button>
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t('schedules.guardNote')}
          </p>
        </form>
      ) : guard.reasonCode === 'operate' ? (
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('schedules.readOnly', { role: user?.role ?? '' })}
        </p>
      ) : (
        guard.reason && (
          <p className="text-xs text-[var(--sb-warn)]">{guard.reason}</p>
        )
      )}
    </section>
  );
}
