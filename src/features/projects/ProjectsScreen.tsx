import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useFleetStore } from '../../store/useFleetStore.ts';
import { statusGroup, type StatusGroup } from '../../../shared/status.ts';
import type { ProjectDto } from '../../../shared/contracts.ts';
import { ProjectCard } from '../../shared/components/ProjectCard.tsx';
import { ListSkeleton } from '../../shared/components/Skeleton.tsx';
import { EmptyState } from '../../shared/components/EmptyState.tsx';

type Filter = 'all' | StatusGroup | 'favorite';
type Sort = 'name' | 'status' | 'activity';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'active', label: 'Actifs' },
  { id: 'paused', label: 'En pause' },
  { id: 'transition', label: 'En cours' },
  { id: 'error', label: 'Erreurs' },
  { id: 'favorite', label: '★ Favoris' },
];

export function ProjectsScreen() {
  const fleet = useFleetStore(s => s.fleet);
  const loading = useFleetStore(s => s.loading);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('status');

  const groups = useMemo(() => {
    if (!fleet) return [];
    const q = query.trim().toLowerCase();
    const match = (p: ProjectDto): boolean => {
      if (q) {
        const haystack =
          `${p.name} ${p.ref} ${p.organizationName} ${p.meta.tags.join(' ')}`.toLowerCase();
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
    // Regroupement par compte (exigence spec), tri à l'intérieur.
    return fleet.accounts
      .map(af => ({
        account: af.account,
        projects: af.projects.filter(match).sort(compare),
      }))
      .filter(g => g.projects.length > 0 || g.account.enabled);
  }, [fleet, query, filter, sort]);

  if (!fleet && loading) return <ListSkeleton count={4} />;

  const total = groups.reduce((n, g) => n + g.projects.length, 0);

  return (
    <div className="space-y-4">
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
            placeholder="Rechercher nom, ref, tag…"
            aria-label="Rechercher un projet"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--sb-text-soft)]"
          />
        </label>
        <div
          className="flex gap-1.5 overflow-x-auto pb-1"
          role="group"
          aria-label="Filtres"
        >
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                filter === f.id
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-[var(--sb-border)] text-[var(--sb-text-soft)]'
              }`}
            >
              {f.label}
            </button>
          ))}
          <select
            aria-label="Trier"
            value={sort}
            onChange={e => setSort(e.target.value as Sort)}
            className="shrink-0 rounded-full border border-[var(--sb-border)] bg-[var(--sb-surface)] px-3 py-1.5 text-xs font-medium"
          >
            <option value="status">Tri : statut</option>
            <option value="name">Tri : nom</option>
            <option value="activity">Tri : activité</option>
          </select>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState emoji="🔍" title="Aucun projet ne correspond">
          Modifiez la recherche ou les filtres.
        </EmptyState>
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
              {!g.account.enabled && ' (désactivé)'}
            </h2>
            <div className="space-y-2">
              {g.projects.map(p => (
                <ProjectCard
                  key={p.ref}
                  project={p}
                  accountAlias={g.account.alias}
                  accountColor={g.account.color}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
