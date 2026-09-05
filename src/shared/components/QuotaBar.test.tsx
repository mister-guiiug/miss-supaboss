import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getDefaultLocale,
  setDefaultLocale,
} from '@mister-guiiug/dev-pwa-config/format';
import {
  DEFAULT_THRESHOLDS,
  FREE_PLAN_QUOTAS,
  GB,
  MB,
} from '../../../shared/quotas.ts';
import { QuotaBar } from './QuotaBar.tsx';

// Les unités attendues sont désormais celles de la LANGUE (« Mo » en français,
// « MB » en anglais) : la copie locale rendait « MB » partout, avec une virgule
// décimale française — donc « 1,5 kB » au milieu d'une interface anglaise.
const initial = getDefaultLocale();
afterEach(() => setDefaultLocale(initial));

describe('QuotaBar', () => {
  it('affiche « 31 Mo / 5 Go » et le pourcentage', () => {
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
    expect(screen.getByText(/^31\s?Mo \/ 5\s?Go$/)).toBeInTheDocument();
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
    expect(screen.getByText(/^— \/ 5\s?Go$/)).toBeInTheDocument();
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
    expect(screen.getByText(/^2 \/ 50\s?k$/)).toBeInTheDocument();
    expect(screen.getByText('estimation')).toBeInTheDocument();
  });

  it('en anglais, la jauge affiche « 31 MB / 5 GB »', () => {
    setDefaultLocale('en-GB');
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
    expect(screen.getByText(/^31\s?MB \/ 5\s?GB$/)).toBeInTheDocument();
  });
});
