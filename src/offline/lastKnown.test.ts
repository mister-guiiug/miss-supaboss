import { describe, expect, it } from 'vitest';
import type {
  AccountFleetDto,
  FleetMetricsDto,
  ProjectDto,
} from '../../shared/contracts.ts';
import { mergeSnapshot, type Snapshot } from './lastKnown.ts';

/**
 * L'instantané hors ligne est le DERNIER ÉTAT CONNU. Un compte que la synchro
 * n'a pas pu lire n'a pas d'état nouveau : il garde l'ancien, au lieu de
 * passer à zéro projet par défaut de réponse.
 */
const projet = (accountId: string, ref: string): ProjectDto => ({
  accountId,
  ref,
  name: `Projet ${ref}`,
  region: 'eu-west-3',
  organizationSlug: 'org',
  organizationName: 'Org',
  status: 'ACTIVE_HEALTHY',
  createdAt: '2026-01-01T00:00:00.000Z',
  meta: {
    tags: [],
    favorite: false,
    demoFrequent: false,
    notes: '',
    lastSeenActiveAt: null,
    pausedAt: null,
    restoreDeadline: null,
  },
});

const compte = (
  id: string,
  projects: ProjectDto[],
  extra: Partial<AccountFleetDto> & { enabled?: boolean; lastError?: string }
): AccountFleetDto => ({
  account: {
    id,
    alias: id,
    color: '#3ecf8e',
    enabled: extra.enabled ?? true,
    patHint: 'sbp_…xxxx',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSyncAt: null,
    lastError: extra.lastError ?? null,
    patExpiresAt: null,
  },
  organizations: extra.organizations ?? [{ slug: 'org', name: 'Org' }],
  projects,
  syncedAt:
    extra.syncedAt === undefined ? '2026-11-05T09:00:00.000Z' : extra.syncedAt,
});

const metriques = (accountId: string, ref: string) => ({
  accountId,
  ref,
  metrics: [],
});

const instantane = (
  accounts: AccountFleetDto[],
  metrics: FleetMetricsDto | null = null
): Snapshot => ({
  fleet: { accounts, generatedAt: '2026-11-05T09:00:00.000Z' },
  metrics,
  savedAt: '2026-11-05T09:00:00.000Z',
});

describe('mergeSnapshot', () => {
  const avant = instantane(
    [
      compte('a', [projet('a', 'a1')], {
        syncedAt: '2026-11-04T08:00:00.000Z',
      }),
      compte('b', [projet('b', 'b1'), projet('b', 'b2')], {
        syncedAt: '2026-11-04T08:00:00.000Z',
      }),
    ],
    {
      projects: [metriques('a', 'a1'), metriques('b', 'b1')],
      generatedAt: '2026-11-04T08:00:00.000Z',
    }
  );

  it('sans précédent, rend le nouveau tel quel', () => {
    const apres = instantane([
      compte('a', [], { syncedAt: null, lastError: 'x' }),
    ]);
    expect(mergeSnapshot(null, apres)).toBe(apres);
  });

  it('un compte en échec garde ses projets, organisations et date de synchro', () => {
    const apres = instantane([
      compte('a', [projet('a', 'a1'), projet('a', 'a2')], {}),
      compte('b', [], {
        syncedAt: null,
        organizations: [],
        lastError: 'Proxy Supabase injoignable',
      }),
    ]);
    const fusion = mergeSnapshot(avant, apres);
    const b = fusion.fleet.accounts.find(x => x.account.id === 'b');
    expect(b?.projects.map(p => p.ref)).toEqual(['b1', 'b2']);
    expect(b?.organizations).toEqual([{ slug: 'org', name: 'Org' }]);
    expect(b?.syncedAt).toBe('2026-11-04T08:00:00.000Z');
    // Le compte, lui, est l'actuel : il porte l'erreur qu'on vient de voir.
    expect(b?.account.lastError).toBe('Proxy Supabase injoignable');
    // Le compte lu est le nouveau.
    const a = fusion.fleet.accounts.find(x => x.account.id === 'a');
    expect(a?.projects.map(p => p.ref)).toEqual(['a1', 'a2']);
  });

  it('les métriques du compte en échec sont gardées, les autres sont les nouvelles', () => {
    const apres = instantane(
      [
        compte('a', [projet('a', 'a1')], {}),
        compte('b', [], { syncedAt: null }),
      ],
      {
        projects: [metriques('a', 'a1')],
        generatedAt: '2026-11-05T09:00:00.000Z',
      }
    );
    const fusion = mergeSnapshot(avant, apres);
    expect(
      fusion.metrics?.projects.map(p => `${p.accountId}:${p.ref}`)
    ).toEqual(['a:a1', 'b:b1']);
  });

  it('un compte désactivé ou supprimé ne ressuscite pas', () => {
    const apres = instantane([
      compte('a', [projet('a', 'a1')], {}),
      compte('b', [], { syncedAt: null, enabled: false }),
    ]);
    const fusion = mergeSnapshot(avant, apres);
    expect(
      fusion.fleet.accounts.find(x => x.account.id === 'b')?.projects
    ).toEqual([]);

    const sansB = instantane([compte('a', [projet('a', 'a1')], {})]);
    expect(
      mergeSnapshot(avant, sansB).fleet.accounts.map(x => x.account.id)
    ).toEqual(['a']);
  });
});
