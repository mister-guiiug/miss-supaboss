import { afterEach, beforeEach, vi } from 'vitest';
import { createLocalRealApi } from './localRealApi.ts';
import { patVault } from './crypto/patVault.ts';
import { apiContractTests } from '../../shared/test/apiContract.ts';

const PROXY = 'https://proxy.test/supabase-management';

const ACTIVE_A = 'aaaaaaaaaaaaaaaaaaaa';
const ACTIVE_B = 'bbbbbbbbbbbbbbbbbbbb';
const INACTIVE = 'cccccccccccccccccccc';

const ORGS = [{ id: 'o1', slug: 'poc-lab', name: 'POC Lab' }];
const PROJECTS_BASE = [
  {
    id: 'p1',
    ref: ACTIVE_A,
    organization_id: 'o1',
    organization_slug: 'poc-lab',
    name: 'CRM POC',
    region: 'eu-west-3',
    created_at: '2026-01-01T00:00:00Z',
    status: 'ACTIVE_HEALTHY',
    database: {},
  },
  {
    id: 'p2',
    ref: ACTIVE_B,
    organization_id: 'o1',
    organization_slug: 'poc-lab',
    name: 'RAG Démo',
    region: 'eu-west-3',
    created_at: '2026-01-01T00:00:00Z',
    status: 'ACTIVE_HEALTHY',
    database: {},
  },
  {
    id: 'p3',
    ref: INACTIVE,
    organization_id: 'o1',
    organization_slug: 'poc-lab',
    name: 'Hackathon',
    region: 'eu-west-3',
    created_at: '2026-01-01T00:00:00Z',
    status: 'INACTIVE',
    database: {},
  },
];

function stubManagementApi(): void {
  const pausing = new Set<string>();
  const restoring = new Set<string>();

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input.toString();
      const path = new URL(raw).searchParams.get('path');
      const body = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'content-type': 'application/json' },
        });

      if (path === '/v1/organizations') return Promise.resolve(body(ORGS));

      if (path === '/v1/projects') {
        const projects = PROJECTS_BASE.map(p => {
          if (restoring.has(p.ref)) {
            return { ...p, status: 'RESTORING' };
          }
          if (pausing.has(p.ref)) {
            return { ...p, status: 'PAUSING' };
          }
          return p;
        });
        return Promise.resolve(body(projects));
      }

      if (path?.endsWith('/pause')) {
        const ref = path.split('/')[3];
        if (ref) pausing.add(ref);
        return Promise.resolve(body({}));
      }
      if (path?.endsWith('/restore')) {
        const ref = path.split('/')[3];
        if (ref) restoring.add(ref);
        return Promise.resolve(body({}));
      }
      if (path?.endsWith('/database/query/read-only')) {
        const q = JSON.parse(String(init?.body ?? '{}')) as { query: string };
        if (q.query.includes('pg_database_size')) {
          return Promise.resolve(body([{ v: 200 * 1024 * 1024 }]));
        }
        if (q.query.includes('storage.objects')) {
          return Promise.resolve(body([{ v: 30 * 1024 * 1024 }]));
        }
        if (q.query.includes('auth.users')) {
          return Promise.resolve(body([{ v: 1200 }]));
        }
      }
      return Promise.resolve(body(null, 404));
    })
  );
}

beforeEach(() => {
  patVault.disable();
  localStorage.clear();
  stubManagementApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

apiContractTests({
  name: 'local-first (proxy mocké)',
  createApi: () => createLocalRealApi(PROXY),
  prepare: async api => {
    const acc = await api.createAccount({
      alias: 'Lab',
      color: '#3ecf8e',
      pat: 'sbp_DEMOFAKEtoken0123456789',
    });
    return {
      accountId: acc.id,
      pauseFirstRef: ACTIVE_A,
      restoreTargetRef: INACTIVE,
      nonPausableRef: INACTIVE,
      activeMetricsRef: ACTIVE_A,
    };
  },
});
