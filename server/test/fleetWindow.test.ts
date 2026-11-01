import { describe, expect, it } from 'vitest';
import { estimateRestoreDeadline } from '../../shared/guards.ts';
import type { FleetDto, ProjectDto } from '../../shared/contracts.ts';
import {
  fleetWithRestoreWindow,
  projectWithRestoreWindow,
} from '../src/fleet.ts';

const paused = '2026-01-01T00:00:00.000Z';

function project(): ProjectDto {
  return {
    accountId: 'a',
    ref: 'abcdefghijklmnopqrst',
    name: 'Demo',
    region: 'eu',
    organizationSlug: 'org',
    organizationName: 'Org',
    status: 'INACTIVE',
    createdAt: paused,
    meta: {
      tags: [],
      favorite: false,
      demoFrequent: false,
      notes: '',
      lastSeenActiveAt: null,
      pausedAt: paused,
      restoreDeadline: estimateRestoreDeadline(paused, 365),
    },
  };
}

describe('fenêtre de restauration affichée', () => {
  it('aligne la date sur le réglage, sans muter le projet mis en cache', () => {
    const original = project();
    const shown = projectWithRestoreWindow(original, 30);
    expect(shown.meta.restoreDeadline).toBe(
      estimateRestoreDeadline(paused, 30)
    );
    expect(original.meta.restoreDeadline).toBe(
      estimateRestoreDeadline(paused, 365)
    );
  });

  it('applique le réglage à toute la flotte', () => {
    const fleet: FleetDto = {
      generatedAt: paused,
      accounts: [
        {
          account: {
            id: 'a',
            alias: 'Lab',
            color: '#000',
            enabled: true,
            patHint: 'sbp_…abcd',
            createdAt: paused,
            lastSyncAt: null,
            lastError: null,
          },
          organizations: [],
          projects: [project()],
          syncedAt: paused,
        },
      ],
    };
    const shown = fleetWithRestoreWindow(fleet, 10);
    expect(shown.accounts[0]?.projects[0]?.meta.restoreDeadline).toBe(
      estimateRestoreDeadline(paused, 10)
    );
  });
});
