import { useEffect, useMemo, useState } from 'react';
import { Search, SearchX, Star } from 'lucide-react';
import { useFleetStore } from '../../store/useFleetStore.ts';
import {
  countsTowardActiveLimit,
  isPausable,
  isRestorable,
  statusGroup,
  type StatusGroup,
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

type Filter = 'all' | StatusGroup | 'favorite';
type Sort = 'name' | 'status' | 'activity';

const FILTERS_KEY = 'miss-supaboss-projects-filters-v1';

const PRIMARY_FILTERS = ['all', 'active', 'paused'] as const;
const MORE_FILTERS = ['transition', 'error', 'favorite'] as const;

function loadFilters(): {
  filter: Filter;
  sort: Sort;
  orgFilter: string;
} {
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return { filter: 'all', sort: 'status', orgFilter: 'all' };
    const parsed = JSON.parse(raw) as {
      filter?: Filter;
      sort?: Sort;
      orgFilter?: string;
    };
    return {
      filter: parsed.filter ?? 'all',
      sort: parsed.sort ?? 'status',
      orgFilter: parsed.orgFilter ?? 'all',
    };
  } catch {
    return { filter: 'all', sort: 'status', orgFilter: 'all' };
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
  const [filter, setFilter] = useState<Filter>(initial.filter);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [orgFilter, setOrgFilter] = useState<string>(initial.orgFilter);
  const [moreOpen, setMoreOpen] = useState(
    () =>
      initial.filter === 'transition' ||
      initial.filter === 'error' ||
      initial.filter === 'favorite' ||
      initial.orgFilter !== 'all'
  );
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
        JSON.stringify({ filter, sort, orgFilter })
      );
    } catch {
      /* sessionStorage indisponible */
    }
  }, [filter, sort, orgFilter]);

  const orgOptions = useMemo(() => {
    if (!fleet) return [];
    const seen = new Map<string, string>();
    for (const af of fleet.accounts) {
      for (const o of af.organizations) {
        if (!seen.has(o.slug)) seen.set(o.slug, o.name);
      }
      for (const p of af.projects) {
        if (!seen.has(p.organizationSlug)) {
          seen.set(p.organizationSlug, p.organizationName);
        }
      }
    }
    return [...seen.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [fleet]);

  /** Synthèse Free : actifs / limite par org (tous comptes confondus). */
  const orgQuotas = useMemo(() => {
    if (!fleet) return [];
    const map = new Map<
      string,
      { slug: string; name: string; active: number; total: number }
    >();
    for (const af of fleet.accounts) {
      for (const p of af.projects) {
        const key = p.organizationSlug || '_';
        const cur = map.get(key) ?? {
          slug: p.organizationSlug,
          name: p.organizationName || p.organizationSlug || '—',
          active: 0,
          total: 0,
        };
        cur.total += 1;
        if (countsTowardActiveLimit(p.status)) cur.active += 1;
        map.set(key, cur);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [fleet]);

  const tallies = useMemo(() => {
    const counts = {
      all: 0,
      active: 0,
      paused: 0,
      transition: 0,
      error: 0,
      favorite: 0,
    };
    if (!fleet) return counts;
    const q = query.trim().toLowerCase();
    for (const af of fleet.accounts) {
      for (const p of af.projects) {
        if (orgFilter !== 'all' && p.organizationSlug !== orgFilter) continue;
        if (q) {
          const haystack =
            `${p.name} ${p.ref} ${p.organizationName} ${p.organizationSlug} ${p.meta.tags.join(' ')}`.toLowerCase();
          if (!haystack.includes(q)) continue;
        }
        counts.all += 1;
        const group = statusGroup(p.status);
        if (
          group === 'active' ||
          group === 'paused' ||
          group === 'transition' ||
          group === 'error'
        ) {
          counts[group] += 1;
        }
        if (p.meta.favorite || p.meta.demoFrequent) counts.favorite += 1;
      }
    }
    return counts;
  }, [fleet, query, orgFilter]);

  const groups = useMemo(() => {
    if (!fleet) return [];
    const q = query.trim().toLowerCase();
    const match = (p: ProjectDto): boolean => {
      if (orgFilter !== 'all' && p.organizationSlug !== orgFilter) return false;
      if (q) {
        const haystack =
          `${p.name} ${p.ref} ${p.organizationName} ${p.organizationSlug} ${p.meta.tags.join(' ')}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filter === 'all') return true;
      if (filter === 'favorite') return p.meta.favorite || p.meta.demoFrequent;
      return statusGroup(p.status) === filter;
    };
    const order: Record<StatusGroup, number> = {
      transition: 0,
      error: 1,
      active: 2,
      paused: 3,
      unknown: 4,
    };
    const compare = (a: ProjectDto, b: ProjectDto): number => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'fr');
      if (sort === 'activity') {
        return (b.meta.lastSeenActiveAt ?? '').localeCompare(
          a.meta.lastSeenActiveAt ?? ''
        );
      }
      return (
        order[statusGroup(a.status)] - order[statusGroup(b.status)] ||
        a.name.localeCompare(b.name, 'fr')
      );
    };
    return fleet.accounts
      .map(af => {
        const projects = af.projects.filter(match).sort(compare);
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
        return {
          account: af.account,
          orgs: [...byOrg.values()].sort((a, b) =>
            a.name.localeCompare(b.name, 'fr')
          ),
          projectCount: projects.length,
        };
      })
      .filter(g => g.projectCount > 0 || g.account.enabled);
  }, [fleet, query, filter, sort, orgFilter]);

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

  const total = groups.reduce((n, g) => n + g.projectCount, 0);

  return (
    <div className="space-y-4">
      <DemoModeBanner />

      {orgQuotas
        .filter(o => o.active >= ACTIVE_PROJECT_LIMIT)
        .map(o => (
          <div
            key={o.slug || o.name}
            className="rounded-xl border border-[var(--sb-border)] bg-[var(--sb-surface)] px-3 py-2.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                {t('projects.slotFullTitle')}
              </p>
              <p className="text-sm text-[var(--sb-text-soft)]">
                {t('projects.slotFullCount', {
                  active: o.active,
                  limit: ACTIVE_PROJECT_LIMIT,
                })}
              </p>
            </div>
            <p className="mt-1 text-xs text-[var(--sb-text-soft)]">
              {t('projects.slotFullBody', { name: o.name })}
            </p>
            <button
              type="button"
              onClick={() => {
                setFilter('active');
                if (o.slug) setOrgFilter(o.slug);
                setMoreOpen(true);
              }}
              className="mt-1 text-xs font-semibold text-primary"
            >
              {t('projects.slotFullSee')}
            </button>
          </div>
        ))}

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
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t('projects.filtersAria')}
        >
          {PRIMARY_FILTERS.map(id => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium ${
                filter === id
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
              }`}
            >
              {t(`projects.filter.${id}`)} {tallies[id]}
            </button>
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-pressed={
              filter === 'transition' ||
              filter === 'error' ||
              filter === 'favorite' ||
              orgFilter !== 'all'
            }
            onClick={() => setMoreOpen(open => !open)}
            className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium ${
              filter === 'transition' ||
              filter === 'error' ||
              filter === 'favorite' ||
              orgFilter !== 'all'
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
            }`}
          >
            {t('projects.moreFilters')}
          </button>
        </div>
        {moreOpen && (
          <div className="flex flex-wrap gap-1.5">
            {MORE_FILTERS.map(id => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  filter === id
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
                }`}
              >
                {id === 'favorite' && <Star size={13} aria-hidden="true" />}
                {t(`projects.filter.${id}`)} {tallies[id]}
              </button>
            ))}
            {orgOptions.length > 0 && (
              <select
                aria-label={t('projects.orgFilterAria')}
                value={orgFilter}
                onChange={e => setOrgFilter(e.target.value)}
                className="rounded-full border border-[var(--sb-border)] bg-[var(--sb-surface)] px-3 py-1.5 text-xs font-medium"
              >
                <option value="all">{t('projects.orgFilterAll')}</option>
                {orgOptions.map(o => (
                  <option key={o.slug} value={o.slug}>
                    {o.name} ({o.slug})
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label={t('projects.sortAria')}
              value={sort}
              onChange={e => setSort(e.target.value as Sort)}
              className="rounded-full border border-[var(--sb-border)] bg-[var(--sb-surface)] px-3 py-1.5 text-xs font-medium"
            >
              <option value="status">{t('projects.sort.status')}</option>
              <option value="name">{t('projects.sort.name')}</option>
              <option value="activity">{t('projects.sort.activity')}</option>
            </select>
            <button
              type="button"
              aria-pressed={selectMode}
              onClick={() => {
                setSelectMode(m => !m);
                setSelected(new Set());
              }}
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium ${
                selectMode
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
              }`}
            >
              {t('projects.bulkToggle')}
            </button>
          </div>
        )}
      </div>

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
        groups.map(g => (
          <section key={g.account.id} aria-label={g.account.alias}>
            <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-[var(--sb-text-soft)]">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ background: g.account.color }}
              />
              {g.account.alias}
              {!g.account.enabled && t('projects.disabledSuffix')}
            </h2>
            <div className="space-y-4">
              {g.orgs.map(org => (
                <div key={org.slug || org.name}>
                  <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--sb-text-soft)]">
                    {org.name}
                    {org.slug ? (
                      <span className="ml-1.5 font-mono opacity-70">
                        {org.slug}
                      </span>
                    ) : null}
                  </h3>
                  <div className="space-y-2">
                    {org.projects.map(p => (
                      <ProjectCard
                        key={p.ref}
                        project={p}
                        accountAlias={g.account.alias}
                        accountColor={g.account.color}
                        selectMode={selectMode}
                        selected={selected.has(keyOf(p))}
                        onToggleSelect={() => toggleSelect(p)}
                        compact
                        pauseDisabled={!actionGuard.allowed || pauseBusy}
                        onPause={
                          isPausable(p.status)
                            ? () => {
                                const siblings =
                                  fleet?.accounts.find(
                                    a => a.account.id === g.account.id
                                  )?.projects ?? [];
                                setPauseTarget({
                                  accountId: p.accountId,
                                  ref: p.ref,
                                  name: p.name,
                                  alias: g.account.alias,
                                  active: activeProjects(siblings).length,
                                });
                              }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
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
