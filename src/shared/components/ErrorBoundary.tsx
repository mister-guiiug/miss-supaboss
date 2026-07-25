import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { recordError } from '@mister-guiiug/dev-wpa-config/react/observability';
import { useI18n } from '../../i18n/index.ts';

interface Props {
  children: ReactNode;
  level: 'app' | 'route';
}

interface State {
  error: Error | null;
}

/**
 * UI de repli en composant fonctionnel : une classe ne peut pas appeler de hook,
 * donc le rendu localisé (via `useI18n`) est délégué ici. Rendu SOUS le
 * `I18nProvider` (monté à la racine), le contexte i18n est disponible.
 */
function ErrorFallback({
  level,
  message,
  onReset,
}: {
  level: 'app' | 'route';
  message: string;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div role="alert" className="mx-auto max-w-md p-6 text-center">
      <TriangleAlert
        size={40}
        aria-hidden="true"
        className="mx-auto text-[var(--sb-critical)]"
      />
      <h1 className="mt-2 text-lg font-semibold">{t('error.title')}</h1>
      <p className="mt-1 text-sm text-[var(--sb-text-soft)]">{message}</p>
      <button
        type="button"
        className="touch-target mt-4 rounded-xl bg-primary px-4 font-semibold text-[#06281a]"
        onClick={onReset}
      >
        {level === 'app' ? t('error.reload') : t('common.retry')}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    recordError(error, {
      source: 'error-boundary',
      level: this.props.level,
      react: info.componentStack,
    });
    console.error(
      'ErrorBoundary',
      this.props.level,
      error,
      info.componentStack
    );
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorFallback
        level={this.props.level}
        message={this.state.error.message}
        onReset={() =>
          this.props.level === 'app'
            ? window.location.reload()
            : this.setState({ error: null })
        }
      />
    );
  }
}
