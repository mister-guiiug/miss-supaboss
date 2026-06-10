/**
 * Provider mock (SUPABOSS_MOCK=1) : flotte simulée en mémoire, transitions
 * temporisées réalistes (PAUSING → INACTIVE, RESTORING → ACTIVE_HEALTHY).
 * Aucun appel réseau — développement et démonstration sans PAT.
 */
import { MB } from '../../../shared/quotas.ts';
import type { SupabaseProjectStatus } from '../../../shared/status.ts';
import type {
  ProviderMetrics,
  RawOrganization,
  RawProject,
  SupabaseProvider,
} from './provider.ts';

interface MockProject extends RawProject {
  /** Valeurs de base pour des métriques stables mais distinctes. */
  seed: number;
}

const ORG: RawOrganization = { slug: 'poc-lab', name: 'POC Lab' };

function project(
  ref: string,
  name: string,
  status: SupabaseProjectStatus,
  seed: number
): MockProject {
  return {
    ref,
    name,
    region: 'eu-west-3',
    organizationSlug: ORG.slug,
    status,
    createdAt: '2026-01-15T09:00:00.000Z',
    seed,
  };
}

export class MockProvider implements SupabaseProvider {
  private readonly projects: MockProject[] = [
    project('demo-crm-poc', 'CRM POC', 'ACTIVE_HEALTHY', 1),
    project('ia-rag-demo', 'RAG Démo IA', 'ACTIVE_HEALTHY', 2),
    project('hackathon-2026', 'Hackathon 2026', 'INACTIVE', 3),
    project('client-pitch', 'Pitch client X', 'INACTIVE', 4),
    project('archive-survey', 'Sondage (archive)', 'INACTIVE', 5),
  ];

  private readonly timers = new Set<NodeJS.Timeout>();

  /** Transition différée — annulable à l'arrêt du serveur (tests). */
  private schedule(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    if (typeof t.unref === 'function') t.unref();
    this.timers.add(t);
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private find(ref: string): MockProject {
    const p = this.projects.find(x => x.ref === ref);
    if (!p) throw new Error(`Projet mock introuvable : ${ref}`);
    return p;
  }

  async listOrganizations(): Promise<RawOrganization[]> {
    return [ORG];
  }

  async listProjects(): Promise<RawProject[]> {
    return this.projects.map(({ seed: _seed, ...p }) => ({ ...p }));
  }

  async pauseProject(_key: string, _pat: string, ref: string): Promise<void> {
    const p = this.find(ref);
    p.status = 'PAUSING';
    this.schedule(4000, () => {
      p.status = 'INACTIVE';
    });
  }

  async restoreProject(_key: string, _pat: string, ref: string): Promise<void> {
    const p = this.find(ref);
    p.status = 'RESTORING';
    this.schedule(8000, () => {
      p.status = 'ACTIVE_HEALTHY';
    });
  }

  async collectMetrics(
    _key: string,
    _pat: string,
    ref: string
  ): Promise<ProviderMetrics> {
    const p = this.find(ref);
    // Valeurs stables par projet + légère dérive horaire (démo vivante).
    const drift = (Date.now() / 3_600_000) % 24;
    return {
      dbSizeBytes: Math.round((20 + p.seed * 9 + drift) * MB),
      storageBytes: Math.round((2 + p.seed * 1.5) * MB),
      mau: p.seed * 2,
      egressBytes: null, // fidèle au réel : pas de source documentée
      measuredAt: new Date().toISOString(),
    };
  }
}
