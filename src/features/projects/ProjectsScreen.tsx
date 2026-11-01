import { useMemo, useState } from 'react';
import { Search, SearchX, Star, type LucideIcon } from 'lucide-react';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { statusGroup, type StatusGroup } from '../../../shared/status.ts';
import type { ProjectDto } from '../../../shared/contracts.ts';
import { ProjectCard } from '../../shared/components/ProjectCard.tsx';
import { DemoModeBanner } from '../../shared/components/DemoModeBanner.tsx';
import { EmptyState } from '@mister-guiiug/dev-pwa-config/react/empty-state';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { useI18n } from '../../i18n/index.ts';
import type { Messages } from '../../i18n/messages.ts';

type Filter = 'all' | StatusGroup | 'favorite';
type Sort = 'name' | 'status' | 'activity';

const FILTERS: {
  id: Filter;
  labelKey: keyof Messages['projects']['filter'];
  icon?: LucideIcon;
}[] = [
  { id: 'all', labelKey: 'all' },
  { id: 'active', labelKey: 'active' },
  { id: 'paused', labelKey: 'paused' },
  { id: 'transition', labelKey: 'transition' },
  { id: 'error', labelKey: 'error' },
  { id: 'favorite', labelKey: 'favorite', icon: Star },
];

export function ProjectsScreen() {
  const { t } = useI18n();
  const fleet = useFleetStore(s => s.fleet);
  const loading = useFleetStore(s => s.loading);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('status');
  const [orgFilter, setOrgFilter] = useState<string>('all');

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
    // Compte → organisations → projets (quotas Free = par org).
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

  if (!fleet && loading) return <ListSkeleton count={4} />;

  const total = groups.reduce((n, g) => n + g.projectCount, 0);

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
        <div
          className="flex gap-1.5 overflow-x-auto pb-1"
          role="group"
          aria-label={t('projects.filtersAria')}
        >
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium ${
                filter === f.id
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
              }`}
            >
              {f.icon && <f.icon size={13} aria-hidden="true" />}
              {t(`projects.filter.${f.labelKey}`)}
            </button>
          ))}
          {orgOptions.length > 0 && (
            <select
              aria-label={t('projects.orgFilterAria')}
              value={orgFilter}
              onChange={e => setOrgFilter(e.target.value)}
              className="shrink-0 rounded-full border border-[var(--sb-border)] bg-[var(--sb-surface)] px-3 py-1.5 text-xs font-medium"
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
            className="shrink-0 rounded-full border border-[var(--sb-border)] bg-[var(--sb-surface)] px-3 py-1.5 text-xs font-medium"
          >
            <option value="status">{t('projects.sort.status')}</option>
            <option value="name">{t('projects.sort.name')}</option>
            <option value="activity">{t('projects.sort.activity')}</option>
          </select>
        </div>
      </div>

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
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
