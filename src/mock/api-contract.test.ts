import { beforeEach, describe, expect, it } from 'vitest';
import { createMockApi } from '../mock/mockApi.ts';
import {
  apiContractTests,
  scheduleContractTests,
  type ApiContractOptions,
} from '../../shared/test/apiContract.ts';

beforeEach(() => {
  localStorage.clear();
});

const demo: ApiContractOptions = {
  name: 'mock (navigateur)',
  createApi: () => createMockApi(),
  ctx: {
    accountId: 'acc-lab',
    pauseFirstRef: 'crm-poc',
    restoreTargetRef: 'hackathon-2026',
    nonPausableRef: 'hackathon-2026',
    activeMetricsRef: 'crm-poc',
  },
};

apiContractTests(demo);
scheduleContractTests(demo);

describe('mockApi — contrat complémentaire', () => {
  it('createAccount ajoute un compte avec projets', async () => {
    localStorage.clear();
    const api = createMockApi();
    const acc = await api.createAccount({
      alias: 'nouveau',
      color: '#3ecf8e',
      pat: 'sbp_DEMOFAKEtoken',
    });
    const fleet = await api.getFleet(true);
    const added = fleet.accounts.find(a => a.account.id === acc.id);
    expect(added?.projects.length).toBeGreaterThan(0);
  });
});

describe('mockApi — ce que la démo promet et ce qu’elle ne fait pas', () => {
  it('connexion implicite, sans seconde étape', async () => {
    const api = createMockApi();
    expect(await api.login('x', 'y')).toMatchObject({
      user: { role: 'admin' },
    });
    await expect(
      api.loginSecondFactor({ code: '123456' })
    ).rejects.toMatchObject({ status: 501 });
    // Pas de connexion à protéger : pas de contrôleur 2FA.
    expect(api.totp).toBeUndefined();
  });

  it('les plannings sont gardés sur l’appareil, jamais exécutés', async () => {
    const api = createMockApi();
    expect(api.schedules?.runsInBackground).toBe(false);
    const created = await api.schedules?.create('acc-lab', 'crm-poc', {
      kind: 'weekly',
      action: 'pause',
      weekday: 5,
      time: '19:00',
    });
    // Rechargement de la page : le planning est toujours là.
    const reloaded = createMockApi();
    const listed = await reloaded.schedules?.list('acc-lab', 'crm-poc');
    expect(listed?.map(s => s.id)).toEqual([created?.id]);
    expect(
      (await reloaded.listOperations(5)).find(
        o => o.action === 'schedule.create'
      )?.detail
    ).toMatch(/jamais exécuté/);

    // Supprimer le compte emporte ses plannings.
    await reloaded.deleteAccount('acc-lab');
    const afterDelete = createMockApi();
    await expect(
      afterDelete.schedules?.list('acc-lab', 'crm-poc')
    ).resolves.toEqual([]);
  });

  it('notifications : réglages visibles, aucun envoi', async () => {
    const api = createMockApi();
    const notifications = api.notifications;
    expect(notifications?.canSend).toBe(false);
    expect(notifications?.pushSubscriptionsUrl).toBeNull();
    const initial = await notifications?.settings();
    expect(initial).toEqual({
      push: { available: false, publicKey: null, subscriptions: 0 },
      webhook: { configured: false, hint: null },
      lastDelivery: null,
    });

    const saved = await notifications?.setWebhook(
      'https://hooks.example.test/services/secret-abcd'
    );
    expect(saved?.webhook).toEqual({
      configured: true,
      hint: 'https://hooks.example.test/…abcd',
    });
    // L'URL elle-même n'est gardée nulle part : rien ne part d'une démo.
    expect(JSON.stringify(localStorage)).not.toContain('secret-abcd');

    await expect(
      notifications?.setWebhook('http://hooks.example.test/x')
    ).rejects.toMatchObject({ status: 400 });
    await expect(notifications?.sendTest()).rejects.toMatchObject({
      status: 501,
    });
    expect((await notifications?.setWebhook(null))?.webhook.configured).toBe(
      false
    );
  });

  it('une démo enregistrée avant les plannings se recharge sans erreur', async () => {
    const api = createMockApi();
    // Une mutation, pour qu'un état complet soit écrit.
    await api.updateProjectMeta('acc-lab', 'crm-poc', { favorite: true });
    const saved = JSON.parse(
      localStorage.getItem('miss-supaboss-mock-v1') ?? '{}'
    ) as Record<string, unknown>;
    delete saved.schedules;
    delete saved.webhookHint;
    localStorage.setItem('miss-supaboss-mock-v1', JSON.stringify(saved));
    expect(saved).toHaveProperty('accounts');
    const old = createMockApi();
    await expect(old.schedules?.list('acc-lab', 'crm-poc')).resolves.toEqual(
      []
    );
    expect(
      (await old.getProject('acc-lab', 'crm-poc', false)).meta.favorite
    ).toBe(true);
    await expect(old.notifications?.settings()).resolves.toMatchObject({
      webhook: { configured: false },
    });
  });
});
