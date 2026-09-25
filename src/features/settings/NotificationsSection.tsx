import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Bell, BellOff, Link2, Send, Trash2 } from 'lucide-react';
import {
  createPushClient,
  permissionState,
  pushSupport,
} from '@mister-guiiug/dev-pwa-config/push';
import { httpPushTransport } from '@mister-guiiug/dev-pwa-config/push/webpush';
import {
  httpsUrlSchema,
  type NotificationSettingsDto,
} from '../../../shared/contracts.ts';
import { formatRelative } from '../../../shared/format.ts';
import { api, ApiError } from '../../api/index.ts';
import { useI18n } from '../../i18n/index.ts';

const INPUT =
  'mt-1 min-h-11 w-full rounded-xl border border-[var(--dwc-border-strong)] bg-transparent px-3 py-2.5 text-sm';

/**
 * Le client push du socle, sur le transport HTTP : deux appels à NOTRE
 * serveur, avec l'en-tête anti-CSRF qu'exige toute mutation. Reconstruit à
 * chaque usage — un client gardé figerait l'état du navigateur au chargement.
 */
function pushClient(subscribeUrl: string, vapidKey: string) {
  return createPushClient({
    transport: httpPushTransport({
      subscribeUrl,
      headers: { 'x-supaboss-csrf': '1' },
    }),
    vapidKey,
  });
}

/**
 * Canaux d'alerte de l'utilisateur : Web Push (cet appareil) et webhook, et
 * le bouton de test. Dans la démo, les réglages se montrent mais rien ne
 * part — c'est écrit, pas seulement grisé.
 */
export function NotificationsSection() {
  const { t } = useI18n();
  const controller = api.notifications;
  const [settings, setSettings] = useState<NotificationSettingsDto | null>(
    null
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  const support = pushSupport();
  const permission = permissionState();

  const refreshHere = useCallback(
    async (s: NotificationSettingsDto) => {
      if (!controller?.pushSubscriptionsUrl || !s.push.publicKey) return;
      const current = await pushClient(
        controller.pushSubscriptionsUrl,
        s.push.publicKey
      ).current();
      setSubscribedHere(current !== null);
    },
    [controller]
  );

  useEffect(() => {
    if (!controller) return;
    let alive = true;
    controller
      .settings()
      .then(async s => {
        if (!alive) return;
        setSettings(s);
        await refreshHere(s);
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [controller, refreshHere]);

  if (!controller) {
    return (
      <section className="card space-y-2 p-4" aria-label={t('notify.aria')}>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
          <Bell size={15} aria-hidden="true" /> {t('notify.heading')}
        </h2>
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('notify.serverOnly')}
        </p>
      </section>
    );
  }

  const fail = (e: unknown, fallback: string): void =>
    setError(e instanceof ApiError ? e.message : fallback);

  const togglePush = async (enable: boolean): Promise<void> => {
    if (!settings?.push.publicKey || !controller.pushSubscriptionsUrl) return;
    setBusy(true);
    setError(null);
    const client = pushClient(
      controller.pushSubscriptionsUrl,
      settings.push.publicKey
    );
    try {
      if (enable) {
        const result = await client.subscribe();
        if (!result.ok) {
          setError(
            result.reason?.startsWith('permission-')
              ? t('notify.pushDenied')
              : result.reason === 'requires-installed-app'
                ? t('notify.pushInstall')
                : t('notify.pushFail')
          );
          return;
        }
        setNotice(t('notify.pushEnabled'));
      } else {
        const result = await client.unsubscribe();
        if (!result.ok) {
          setError(t('notify.failed'));
          return;
        }
        setNotice(t('notify.pushDisabled'));
      }
      const next = await controller.settings();
      setSettings(next);
      await refreshHere(next);
    } catch (e) {
      fail(e, t('notify.failed'));
    } finally {
      setBusy(false);
    }
  };

  const saveWebhook = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!httpsUrlSchema.safeParse(webhookUrl).success) {
      setError(t('notify.webhookInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSettings(await controller.setWebhook(webhookUrl.trim()));
      setWebhookUrl('');
      setNotice(t('notify.webhookSaved'));
    } catch (err) {
      fail(err, t('notify.failed'));
    } finally {
      setBusy(false);
    }
  };

  const removeWebhook = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await controller.setWebhook(null));
      setNotice(t('notify.webhookRemoved'));
    } catch (err) {
      fail(err, t('notify.failed'));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const report = await controller.sendTest();
      const delivered =
        (report.push.sent > 0 || report.webhook === 'sent') &&
        report.push.failed === 0 &&
        report.webhook !== 'failed';
      setTestResult(
        delivered
          ? t('notify.testSent', { detail: report.detail })
          : t('notify.testFailed', { detail: report.detail })
      );
      setSettings(await controller.settings());
    } catch (err) {
      fail(err, t('notify.failed'));
    } finally {
      setBusy(false);
    }
  };

  /** Pourquoi le push n'est pas proposable ici, ou null s'il l'est. */
  const pushBlocker = !controller.canSend
    ? t('notify.pushDemo')
    : settings && !settings.push.available
      ? t('notify.pushNoKeys')
      : !support.supported
        ? support.reason === 'requires-installed-app'
          ? t('notify.pushInstall')
          : t('notify.pushUnsupported')
        : permission === 'denied' && !subscribedHere
          ? t('notify.pushDenied')
          : null;

  return (
    <section className="card space-y-3 p-4" aria-label={t('notify.aria')}>
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sb-text-soft)]">
        <Bell size={15} aria-hidden="true" /> {t('notify.heading')}
      </h2>
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>
      {!controller.canSend && (
        <p className="rounded-xl border border-[var(--sb-warn)] px-3 py-2 text-xs text-[var(--sb-warn)]">
          {t('notify.demoNotice')}
        </p>
      )}
      <p className="text-xs text-[var(--sb-text-soft)]">{t('notify.what')}</p>

      {loadFailed ? (
        <p className="text-sm text-[var(--sb-warn)]">{t('notify.loadFail')}</p>
      ) : settings === null ? (
        <p className="text-xs text-[var(--sb-text-soft)]">
          {t('common.loading')}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t('notify.pushTitle')}</h3>
            {pushBlocker ? (
              <p className="text-xs text-[var(--sb-text-soft)]">
                {pushBlocker}
              </p>
            ) : (
              <>
                <p className="text-sm">
                  {subscribedHere ? t('notify.pushOn') : t('notify.pushOff')}{' '}
                  <span className="text-xs text-[var(--sb-text-soft)]">
                    {t('notify.pushDevices', {
                      count: settings.push.subscriptions,
                    })}
                  </span>
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void togglePush(!subscribedHere)}
                  className="touch-target flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--dwc-border-strong)] px-3 text-sm font-medium disabled:opacity-50"
                >
                  {subscribedHere ? (
                    <BellOff size={16} aria-hidden="true" />
                  ) : (
                    <Bell size={16} aria-hidden="true" />
                  )}{' '}
                  {subscribedHere
                    ? t('notify.pushDisable')
                    : t('notify.pushEnable')}
                </button>
              </>
            )}
          </div>

          <form className="space-y-2" onSubmit={e => void saveWebhook(e)}>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Link2 size={15} aria-hidden="true" /> {t('notify.webhookTitle')}
            </h3>
            <p className="text-sm">
              {settings.webhook.configured
                ? t('notify.webhookCurrent', {
                    hint: settings.webhook.hint ?? '…',
                  })
                : t('notify.webhookNone')}
            </p>
            <label className="block">
              <span className="text-xs font-medium text-[var(--sb-text-soft)]">
                {t('notify.webhookLabel')}
              </span>
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://"
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                aria-describedby="webhook-help"
                className={`${INPUT} font-mono`}
              />
            </label>
            <p id="webhook-help" className="text-xs text-[var(--sb-text-soft)]">
              {t('notify.webhookHelp')}
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || webhookUrl.trim() === ''}
                className="touch-target flex-1 rounded-xl bg-primary px-3 text-sm font-semibold text-[#06281a] disabled:opacity-50"
              >
                {t('notify.webhookSave')}
              </button>
              {settings.webhook.configured && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeWebhook()}
                  className="touch-target flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--dwc-border-strong)] px-3 text-sm font-medium disabled:opacity-50"
                >
                  <Trash2 size={16} aria-hidden="true" />{' '}
                  {t('notify.webhookRemove')}
                </button>
              )}
            </div>
          </form>

          {error && (
            <p role="alert" className="text-sm text-[var(--sb-critical)]">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <button
              type="button"
              disabled={busy || !controller.canSend}
              aria-describedby={
                controller.canSend ? undefined : 'notify-test-demo'
              }
              onClick={() => void sendTest()}
              className="touch-target flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--dwc-border-strong)] px-3 text-sm font-medium disabled:opacity-50"
            >
              <Send size={16} aria-hidden="true" /> {t('notify.test')}
            </button>
            {!controller.canSend && (
              <p
                id="notify-test-demo"
                className="text-xs text-[var(--sb-text-soft)]"
              >
                {t('notify.testDemo')}
              </p>
            )}
            <p aria-live="polite" className="text-xs">
              {testResult}
            </p>
            {settings.lastDelivery && (
              <p className="text-xs text-[var(--sb-text-soft)]">
                {t('notify.lastDelivery', {
                  rel: formatRelative(settings.lastDelivery.at, {
                    never: t('common.never'),
                  }),
                  status:
                    settings.lastDelivery.status === 'ok'
                      ? t('notify.statusOk')
                      : t('notify.statusError'),
                  detail: settings.lastDelivery.detail ?? '—',
                })}
              </p>
            )}
          </div>
          <p className="text-xs text-[var(--sb-text-soft)]">
            {t('notify.noEmail')}
          </p>
        </>
      )}
    </section>
  );
}
