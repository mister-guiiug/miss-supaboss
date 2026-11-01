import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { I18nProvider } from '../../i18n/index.ts';
import { QuotaBar } from './QuotaBar.tsx';

function renderBar(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const initial = getDefaultLocale();
beforeEach(() => {
  localStorage.setItem('supaboss_locale', 'fr');
});
afterEach(() => {
  setDefaultLocale(initial);
  localStorage.removeItem('supaboss_locale');
});

describe('QuotaBar', () => {
  it('affiche « 31 Mo / 5 Go » et le pourcentage', () => {
    renderBar(
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
    renderBar(
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
    expect(
      screen.getByText(/Egress : non disponible via l'API Management/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow'
    );
  });

  it('niveau critique au-delà du seuil', () => {
    renderBar(
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
    renderBar(
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
    localStorage.setItem('supaboss_locale', 'en');
    setDefaultLocale('en-GB');
    renderBar(
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
