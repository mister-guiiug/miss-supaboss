/**
 * Client HTTP résilient pour la Management API :
 * - timeout (AbortController) ;
 * - retry exponentiel + jitter sur erreurs transitoires (GET uniquement) ;
 * - respect de Retry-After sur 429 / 503 ;
 * - budget d'appels par compte et par minute (limite documentée : 60/min) ;
 * - circuit breaker simple par compte (5 échecs consécutifs → ouvert 60 s).
 */

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, url: string) {
    super(`HTTP ${status} sur ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export class BudgetExceededError extends Error {
  constructor(key: string) {
    super(
      `Budget d'appels Management API épuisé pour le compte ${key} — réessayez dans une minute`
    );
    this.name = 'BudgetExceededError';
  }
}

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(
      `Circuit ouvert pour le compte ${key} (échecs répétés) — nouvel essai différé`
    );
    this.name = 'CircuitOpenError';
  }
}

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
}

interface BudgetWindow {
  windowStart: number;
  count: number;
}

export interface ResilientClientOptions {
  budgetPerMin: number;
  timeoutMs?: number;
  maxRetries?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  /** Injectable pour les tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export class ResilientClient {
  private readonly budgets = new Map<string, BudgetWindow>();
  private readonly breakers = new Map<string, BreakerState>();
  private readonly opts: Required<ResilientClientOptions>;

  constructor(options: ResilientClientOptions) {
    this.opts = {
      timeoutMs: 15_000,
      maxRetries: 2,
      breakerThreshold: 5,
      breakerCooldownMs: 60_000,
      fetchImpl: fetch,
      sleep: defaultSleep,
      ...options,
    };
  }

  /** JSON parse + erreurs typées. `retryable` = idempotent (GET). */
  async request<T>(
    key: string,
    url: string,
    init: RequestInit,
    retryable: boolean
  ): Promise<T> {
    this.assertBreakerClosed(key);
    this.consumeBudget(key);

    let lastError: unknown;
    const attempts = retryable ? this.opts.maxRetries + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const backoff = 300 * 2 ** (attempt - 1);
        await this.opts.sleep(backoff + Math.floor(Math.random() * 150));
        this.consumeBudget(key);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        const res = await this.opts.fetchImpl(url, {
          ...init,
          signal: controller.signal,
        });
        if (res.status === 429 || res.status === 503) {
          const retryAfter = Number(res.headers.get('retry-after') ?? '0');
          lastError = new HttpError(res.status, await res.text(), url);
          if (retryable && attempt < attempts - 1) {
            await this.opts.sleep(Math.min(retryAfter, 30) * 1000);
            continue;
          }
          this.recordFailure(key);
          throw lastError;
        }
        if (!res.ok) {
          const err = new HttpError(res.status, await res.text(), url);
          // 4xx ≠ panne : n'ouvre pas le circuit (token invalide, 404…).
          if (res.status >= 500) this.recordFailure(key);
          else this.recordSuccess(key);
          throw err;
        }
        this.recordSuccess(key);
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text.length > 0 ? JSON.parse(text) : undefined) as T;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        // Réseau / timeout : transitoire → retry si permis.
        lastError = error;
        this.recordFailure(key);
        if (!retryable || attempt === attempts - 1) {
          throw error instanceof Error
            ? error
            : new Error('Erreur réseau inconnue');
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Échec réseau');
  }

  private consumeBudget(key: string): void {
    const now = Date.now();
    const win = this.budgets.get(key);
    if (!win || now - win.windowStart >= 60_000) {
      this.budgets.set(key, { windowStart: now, count: 1 });
      return;
    }
    if (win.count >= this.opts.budgetPerMin) {
      throw new BudgetExceededError(key);
    }
    win.count += 1;
  }

  private assertBreakerClosed(key: string): void {
    const b = this.breakers.get(key);
    if (b && b.openUntil > Date.now()) throw new CircuitOpenError(key);
  }

  private recordFailure(key: string): void {
    const b = this.breakers.get(key) ?? {
      consecutiveFailures: 0,
      openUntil: 0,
    };
    b.consecutiveFailures += 1;
    if (b.consecutiveFailures >= this.opts.breakerThreshold) {
      b.openUntil = Date.now() + this.opts.breakerCooldownMs;
      b.consecutiveFailures = 0; // half-open après cooldown
    }
    this.breakers.set(key, b);
  }

  private recordSuccess(key: string): void {
    this.breakers.delete(key);
  }
}
