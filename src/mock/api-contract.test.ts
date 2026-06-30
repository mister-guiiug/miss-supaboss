import { beforeEach, describe, expect, it } from 'vitest';
import { createMockApi } from '../mock/mockApi.ts';
import { apiContractTests } from '../../shared/test/apiContract.ts';

beforeEach(() => {
  localStorage.clear();
});

apiContractTests({
  name: 'mock (navigateur)',
  createApi: () => createMockApi(),
  ctx: {
    accountId: 'acc-lab',
    pauseFirstRef: 'crm-poc',
    restoreTargetRef: 'hackathon-2026',
    nonPausableRef: 'hackathon-2026',
    activeMetricsRef: 'crm-poc',
  },
});

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
