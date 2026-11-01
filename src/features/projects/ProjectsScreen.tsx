import { useEffect, useMemo, useState } from 'react';
import { Search, SearchX } from 'lucide-react';
import { useFleetStore } from '../../store/useFleetStore.ts';
import {
  countsTowardActiveLimit,
  isPausable,
  isRestorable,
  statusGroup,
} from '../../../shared/status.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  activeProjects,
} from '../../../shared/guards.ts';
import type { ProjectDto } from '../../../shared/contracts.ts';
import { ProjectCard } from '../../shared/components/ProjectCard.tsx';
import { DemoModeBanner } from '../../shared/components/DemoModeBanner.tsx';
import { EmptyState } from '@mister-guiiug/dev-pwa-config/react/empty-state';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { useI18n } from '../../i18n/index.ts';
import { toast } from '../../store/useUiStore.ts';
import { ApiError } from '../../api/index.ts';
import { ConfirmDialog } from '@mister-guiiug/dev-pwa-config/react/confirm-dialog';
import { useActionGuard } from '../../shared/hooks/useActionGuard.ts';

type Segment = 'active' | 'paused';
type Sort = 'name' | 'activity';

const FILTERS_KEY = 'miss-supaboss-projects-filters-v1';

function loadFilters(): {
  segment: Segment;
  sort: Sort;
  favorites: boolean;
  accountId: string;
} {
  const fallback = {
    segment: 'active' as const,
    sort: 'activity' as const,
    favorites: false,
    accountId: '',
  };
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      segment?: Segment;
      sort?: string;
      favorites?: boolean;
      accountId?: string;
      filter?: string;
    };
    const segment: Segment =
      parsed.segment === 'paused' || parsed.filter === 'paused'
        ? 'paused'
        : 'active';
    return {
      segment,
      sort: parsed.sort === 'name' ? 'name' : 'activity',
      favorites: Boolean(parsed.favorites) || parsed.filter === 'favorite',
      accountId: parsed.accountId ?? '',
    };
  } catch {
    return fallback;
  }
}

export function ProjectsScreen() {
  const { t } = useI18n();
  const fleet = useFleetStore(s => s.fleet);
  const loading = useFleetStore(s => s.loading);
  const pause = useFleetStore(s => s.pause);
  const restore = useFleetStore(s => s.restore);
  const [query, setQuery] = useState('');
  const initial = useMemo(() => loadFilters(), []);
  const [segment, setSegment] = useState<Segment>(initial.segment);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [favorites, setFavorites] = useState(initial.favorites);
  const [accountId, setAccountId] = useState(initial.accountId);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseTarget, setPauseTarget] = useState<{
    accountId: string;
    ref: string;
    name: string;
    alias: string;
    active: number;
  } | null>(null);
  const actionGuard = useActionGuard({
    online: true,
    operate: true,
    writable: true,
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(
        FILTERS_KEY,
        JSON.stringify({ segment, sort, favorites, accountId })
      );
    } catch {
      /* sessionStorage indisponible */
    }
  }, [segment, sort, favorites, accountId]);

  const accountChoices = useMemo(
    () =>
      (fleet?.accounts ?? []).filter(
        af => af.projects.length > 0 || af.account.enabled
      ),
    [fleet]
  );
  const severalAccounts = accountChoices.length > 1;
  const currentAccountId = severalAccounts
    ? accountChoices.some(af => af.account.id === accountId)
      ? accountId
      : (accountChoices[0]?.account.id ?? '')
    : (accountChoices[0]?.account.id ?? '');

  const groups = useMemo(() => {
    if (!fleet) return [];
    const q = query.trim().toLowerCase();
    const source = severalAccounts
      ? fleet.accounts.filter(af => af.account.id === currentAccountId)
      : fleet.accounts;
    const projects = source
      .flatMap(af => af.projects)
      .filter(p => {
        if (q) {
          const haystack =
            `${p.name} ${p.ref} ${p.organizationName} ${p.organizationSlug} ${p.meta.tags.join(' ')}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        if (favorites && !(p.meta.favorite || p.meta.demoFrequent)) {
          return false;
        }
        const paused = statusGroup(p.status) === 'paused';
        return segment === 'paused' ? paused : !paused;
      })
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'fr');
        const stamp = (p: ProjectDto) =>
          segment === 'paused'
            ? (p.meta.pausedAt ?? p.meta.lastSeenActiveAt ?? '')
            : (p.meta.lastSeenActiveAt ?? '');
        return stamp(b).localeCompare(stamp(a));
      });
    const byOrg = new Map<
      string,
      { slug: string; name: string; projects: ProjectDto[] }
    >();
    for (const p of projects) {
      const key = p.organizationSlug || '_';
      const bucket = byOrg.get(key) ?? {
        slug: p.organizationSlug,
        name: p.organizationName || p.organizationSlug,
        projects: [],
      };
      bucket.projects.push(p);
      byOrg.set(key, bucket);
    }
    return [...byOrg.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'fr')
    );
  }, [
    fleet,
    query,
    segment,
    sort,
    favorites,
    severalAccounts,
    currentAccountId,
  ]);

  const keyOf = (p: ProjectDto) => `${p.accountId}:${p.ref}`;

  const toggleSelect = (p: ProjectDto) => {
    const k = keyOf(p);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectedProjects = useMemo(() => {
    if (!fleet) return [];
    const out: ProjectDto[] = [];
    for (const af of fleet.accounts) {
      for (const p of af.projects) {
        if (selected.has(keyOf(p))) out.push(p);
      }
    }
    return out;
  }, [fleet, selected]);

  const runBulkPause = async (): Promise<void> => {
    const targets = selectedProjects.filter(p =>
      countsTowardActiveLimit(p.status)
    );
    if (targets.length === 0) {
      toast.error(t('projects.bulkNoPause'));
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const p of targets) {
      try {
        await pause(p.accountId, p.ref);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    setSelectMode(false);
    toast.success(t('projects.bulkPauseDone', { ok, fail }));
  };

  const runBulkRestore = async (): Promise<void> => {
    const targets = selectedProjects.filter(p => isRestorable(p.status));
    if (targets.length === 0) {
      toast.error(t('projects.bulkNoRestore'));
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const p of targets) {
      const siblings =
        fleet?.accounts.find(a => a.account.id === p.accountId)?.projects ?? [];
      const actives = activeProjects(siblings);
      if (actives.length >= ACTIVE_PROJECT_LIMIT) {
        fail += 1;
        continue;
      }
      try {
        await restore(p.accountId, p.ref);
        ok += 1;
      } catch (e) {
        fail += 1;
        if (e instanceof ApiError && e.status === 409) {
          toast.error(e.message);
        }
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    setSelectMode(false);
    toast.success(t('projects.bulkRestoreDone', { ok, fail }));
  };

  const doPause = async (): Promise<void> => {
    if (!pauseTarget) return;
    setPauseBusy(true);
    try {
      await pause(pauseTarget.accountId, pauseTarget.ref);
      setPauseTarget(null);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t('projectDetail.pauseFail')
      );
    } finally {
      setPauseBusy(false);
    }
  };

  if (!fleet && loading) return <ListSkeleton count={4} />;

  const total = groups.reduce((n, g) => n + g.projects.length, 0);
  const showOrgTitles = groups.length > 1;
  const displayAdjusted = sort !== 'activity' || favorites || selectMode;

  return (
    <div className="space-y-4">
      <DemoModeBanner />

      <div className="space-y-2">
        <label className="card flex items-center gap-2 px-3 py-2.5">
          <Search
            size={18}
            aria-hidden="true"
            className="text-[var(--sb-text-soft)]"
          />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('projects.searchPlaceholder')}
            aria-label={t('projects.searchAria')}
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--sb-text-soft)]"
          />
        </label>
        <div className="flex items-center gap-2">
          <div
            className="flex flex-1 rounded-xl bg-[var(--sb-surface-2)] p-0.5"
            role="group"
            aria-label={t('projects.filtersAria')}
          >
            {(['active', 'paused'] as const).map(id => (
              <button
                key={id}
                type="button"
                aria-pressed={segment === id}
                onClick={() => setSegment(id)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  segment === id
                    ? 'bg-primary/15 text-primary'
                    : 'text-[var(--sb-text-soft)]'
                }`}
              >
                {t(`projects.filter.${id}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-expanded={displayOpen}
            aria-pressed={displayOpen || displayAdjusted}
            onClick={() => setDisplayOpen(open => !open)}
            className={`shrink-0 px-1 text-xs font-semibold ${
              displayOpen || displayAdjusted
                ? 'text-primary'
                : 'text-[var(--sb-text-soft)]'
            }`}
          >
            {t('projects.displayMenu')}
          </button>
        </div>
        {displayOpen && (
          <div
            className="card px-2 py-1"
            role="group"
            aria-label={t('projects.sortAria')}
          >
            <button
              type="button"
              aria-pressed={sort === 'activity'}
              onClick={() => setSort('activity')}
              className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-sm ${
                sort === 'activity'
                  ? 'font-semibold text-primary'
                  : 'text-[var(--sb-text-soft)]'
              }`}
            >
              {t('projects.sortRecent')}
            </button>
            <button
              type="button"
              aria-pressed={sort === 'name'}
              onClick={() => setSort('name')}
              className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-sm ${
                sort === 'name'
                  ? 'font-semibold text-primary'
                  : 'text-[var(--sb-text-soft)]'
              }`}
            >
              {t('projects.sortByName')}
            </button>
            <button
              type="button"
              aria-pressed={favorites}
              onClick={() => setFavorites(value => !value)}
              className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-sm ${
                favorites
                  ? 'font-semibold text-primary'
                  : 'text-[var(--sb-text-soft)]'
              }`}
            >
              {t('projects.filter.favorite')}
            </button>
            <button
              type="button"
              aria-pressed={selectMode}
              onClick={() => {
                setSelectMode(mode => !mode);
                setSelected(new Set());
              }}
              className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-sm ${
                selectMode
                  ? 'font-semibold text-primary'
                  : 'text-[var(--sb-text-soft)]'
              }`}
            >
              {t('projects.bulkToggle')}
            </button>
          </div>
        )}
      </div>

      {severalAccounts && (
        <div
          className="flex gap-1.5 overflow-x-auto"
          role="group"
          aria-label={t('projects.accountsAria')}
        >
          {accountChoices.map(af => (
            <button
              key={af.account.id}
              type="button"
              aria-pressed={af.account.id === currentAccountId}
              onClick={() => setAccountId(af.account.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                af.account.id === currentAccountId
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
              }`}
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: af.account.color }}
              />
              {af.account.alias}
              {!af.account.enabled && t('projects.disabledSuffix')}
            </button>
          ))}
        </div>
      )}

      {selectMode && selected.size > 0 && (
        <div className="card flex flex-wrap gap-2 p-3">
          <span className="w-full text-xs text-[var(--sb-text-soft)]">
            {t('projects.bulkSelected', { count: selected.size })}
          </span>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void runBulkPause()}
            className="touch-target rounded-xl border border-[var(--sb-border)] px-3 text-sm font-medium disabled:opacity-50"
          >
            {t('projects.bulkPause')}
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void runBulkRestore()}
            className="touch-target rounded-xl border border-primary px-3 text-sm font-medium text-primary disabled:opacity-50"
          >
            {t('projects.bulkRestore')}
          </button>
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          icon={<SearchX size={40} strokeWidth={1.5} />}
          title={t('projects.emptyTitle')}
          description={t('projects.emptyBody')}
        />
      ) : (
        <div className="space-y-4">
          {groups.map(org => (
            <div key={org.slug || org.name}>
              {showOrgTitles && (
                <h2 className="mb-1.5 px-1 text-xs font-medium text-[var(--sb-text-soft)]">
                  {org.name}
                  {org.slug ? (
                    <span className="ml-1.5 font-mono opacity-70">
                      {org.slug}
                    </span>
                  ) : null}
                </h2>
              )}
              <div className="space-y-2">
                {org.projects.map(p => {
                  const account = fleet?.accounts.find(
                    a => a.account.id === p.accountId
                  );
                  return (
                    <ProjectCard
                      key={`${p.accountId}:${p.ref}`}
                      project={p}
                      selectMode={selectMode}
                      selected={selected.has(keyOf(p))}
                      onToggleSelect={() => toggleSelect(p)}
                      pauseDisabled={!actionGuard.allowed || pauseBusy}
                      onPause={
                        isPausable(p.status)
                          ? () => {
                              setPauseTarget({
                                accountId: p.accountId,
                                ref: p.ref,
                                name: p.name,
                                alias: account?.account.alias ?? '',
                                active: activeProjects(account?.projects ?? [])
                                  .length,
                              });
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={pauseTarget !== null}
        title={t('projectDetail.pauseTitle', {
          name: pauseTarget?.name ?? '',
        })}
        confirmLabel={t('projectDetail.pause')}
        loading={pauseBusy}
        onCancel={() => setPauseTarget(null)}
        onConfirm={() => void doPause()}
      >
        <p>
          {t('projectDetail.pauseBody', {
            alias: pauseTarget?.alias ?? '',
            active: pauseTarget?.active ?? 0,
            limit: ACTIVE_PROJECT_LIMIT,
          })}
        </p>
      </ConfirmDialog>
    </div>
  );
}
