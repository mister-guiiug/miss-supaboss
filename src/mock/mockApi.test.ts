/**
 * Le mock est le moteur de la démo publique : on vérifie qu'il applique
 * les MÊMES garde-fous que le serveur (contrat partagé).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/types.ts';
import { createMockApi } from './mockApi.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('mockApi — garde-fous', () => {
  it('expose 2 comptes et leurs projets', async () => {
    const api = createMockApi();
    const fleet = await api.getFleet(false);
    expect(fleet.accounts).toHaveLength(2);
    const lab = fleet.accounts[0];
    expect(lab?.projects.length).toBeGreaterThan(2);
  });

  it('restore refusé à 2 actifs avec suggestions, accepté avec pauseFirst', async () => {
    const api = createMockApi();
    // acc-lab : crm-poc + rag-ia-demo actifs → limite atteinte.
    await expect(
      api.restoreProject('acc-lab', 'hackathon-2026', {
        pauseFirst: [],
        force: false,
      })
    ).rejects.toMatchObject({
      code: 'limit-reached',
      assessment: { activeCount: 2, limit: 2 },
    });

    const assessment = await api.assessRestore('acc-lab', 'hackathon-2026');
    expect(assessment.allowed).toBe(false);
    // rag-ia-demo est favori + critique-demo → crm-poc suggéré d'abord.
    expect(assessment.suggestions[0]?.ref).toBe('crm-poc');

    await api.restoreProject('acc-lab', 'hackathon-2026', {
      pauseFirst: ['crm-poc'],
      force: false,
    });
    const fleet = await api.getFleet(false);
    const projects = fleet.accounts[0]?.projects ?? [];
    expect(projects.find(p => p.ref === 'crm-poc')?.status).toBe('PAUSING');
    expect(projects.find(p => p.ref === 'hackathon-2026')?.status).toBe(
      'RESTORING'
    );
  });

  it('pause d’un projet en pause → ApiError 409', async () => {
    const api = createMockApi();
    await expect(
      api.pauseProject('acc-lab', 'hackathon-2026')
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('egress reste « unavailable » (aucune valeur inventée)', async () => {
    const api = createMockApi();
    const metrics = await api.getFleetMetrics(false);
    for (const project of metrics.projects) {
      const egress = project.metrics.find(m => m.kind === 'egress');
      expect(egress?.state).toBe('unavailable');
      expect(egress?.value).toBeNull();
    }
  });

  it('méta persistée (localStorage) entre deux instances', async () => {
    const api = createMockApi();
    await api.updateProjectMeta('acc-lab', 'hackathon-2026', {
      favorite: true,
      tags: ['poc', 'demo'],
    });
    const second = createMockApi();
    const project = await second.getProject('acc-lab', 'hackathon-2026', false);
    expect(project.meta.favorite).toBe(true);
    expect(project.meta.tags).toEqual(['poc', 'demo']);
  });
});
