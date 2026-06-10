import { useEffect, useRef } from 'react';

/**
 * Rafraîchissement périodique « intelligent » : suspendu quand l'onglet est
 * masqué ou hors ligne, relancé immédiatement au retour de visibilité.
 */
export function usePolling(
  callback: () => void,
  intervalMs: number,
  enabled: boolean
): void {
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  });

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (navigator.onLine) cbRef.current();
      }, intervalMs);
    };
    const stop = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        cbRef.current();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
