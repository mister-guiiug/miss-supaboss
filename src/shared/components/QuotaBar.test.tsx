import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  FREE_PLAN_QUOTAS,
  GB,
  MB,
} from '../../../shared/quotas.ts';
import { QuotaBar } from './QuotaBar.tsx';

describe('QuotaBar', () => {
  it('affiche « 31 MB / 5 GB » et le pourcentage', () => {
    render(
      <QuotaBar
        metric={{
          kind: 'egress',
          state: 'measured',
          value: 31 * MB,
          quota: 5 * GB,
          measuredAt: '2026-06-10T08:00:00Z',
        }}
        thresholds={DEFAULT_THRESHOLDS}
      />
    );
    expect(screen.getByText('Egress')).toBeInTheDocument();
    expect(screen.getByText(/31 MB \/ 5 GB/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '1'
    );
  });

  it('métrique indisponible : « — / quota », pas de valeur inventée', () => {
    render(
      <QuotaBar
        metric={{
          kind: 'egress',
          state: 'unavailable',
          value: null,
          quota: FREE_PLAN_QUOTAS.egress,
          measuredAt: null,
        }}
        thresholds={DEFAULT_THRESHOLDS}
      />
    );
    expect(screen.getByText(/— \/ 5 GB/)).toBeInTheDocument();
    expect(screen.getByText('non disponible via API')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow'
    );
  });

  it('niveau critique au-delà du seuil', () => {
    render(
      <QuotaBar
        metric={{
          kind: 'dbSize',
          state: 'measured',
          value: 490 * MB,
          quota: FREE_PLAN_QUOTAS.dbSize,
          measuredAt: '2026-06-10T08:00:00Z',
        }}
        thresholds={DEFAULT_THRESHOLDS}
      />
    );
    expect(screen.getByTestId('quota-dbSize')).toHaveAttribute(
      'data-level',
      'critical'
    );
  });

  it('mention « estimation » pour les MAU', () => {
    render(
      <QuotaBar
        metric={{
          kind: 'mau',
          state: 'estimated',
          value: 2,
          quota: FREE_PLAN_QUOTAS.mau,
          measuredAt: '2026-06-10T08:00:00Z',
        }}
        thresholds={DEFAULT_THRESHOLDS}
      />
    );
    expect(screen.getByText(/2 \/ 50k/)).toBeInTheDocument();
    expect(screen.getByText('estimation')).toBeInTheDocument();
  });
});
