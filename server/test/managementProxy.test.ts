/**
 * Proxy CORS Supabase (supabase/functions/supabase-management) : on vérifie le
 * garde-fou CORS, la liste blanche de chemins et le relais vers api.supabase.com.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  handleProxy,
  parseOrigins,
} from '../../supabase/functions/supabase-management/index.ts';

const ORIGIN = 'https://mister-guiiug.github.io';

function makeReq(
  method: string,
  opts: { path?: string; origin?: string; auth?: string; body?: string } = {}
): Request {
  const url = `https://proxy.test/${
    opts.path !== undefined ? `?path=${encodeURIComponent(opts.path)}` : ''
  }`;
  const headers = new Headers();
  if (opts.origin) headers.set('origin', opts.origin);
  if (opts.auth) headers.set('authorization', opts.auth);
  return new Request(url, { method, headers, body: opts.body });
}

describe('proxy management — CORS + liste blanche', () => {
  it('préflight OPTIONS depuis une origine autorisée → 204 + ACAO', async () => {
    const res = await handleProxy(makeReq('OPTIONS', { origin: ORIGIN }), [
      ORIGIN,
    ]);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-headers')).toContain(
      'authorization'
    );
  });

  it('origine non autorisée → pas d’ACAO et 403 sur GET', async () => {
    const fetchImpl = vi.fn();
    const res = await handleProxy(
      makeReq('GET', {
        path: '/v1/projects',
        origin: 'https://evil.test',
        auth: 'Bearer sbp_x',
      }),
      [ORIGIN],
      fetchImpl as unknown as typeof fetch
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('chemin hors liste blanche → 404 (aucun relais arbitraire)', async () => {
    const fetchImpl = vi.fn();
    const res = await handleProxy(
      makeReq('GET', {
        path: '/v1/secrets',
        origin: ORIGIN,
        auth: 'Bearer sbp_x',
      }),
      [ORIGIN],
      fetchImpl as unknown as typeof fetch
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('GET /v1/projects autorisé → relaie vers api.supabase.com avec le PAT', async () => {
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.supabase.com/v1/projects');
        const headers = init?.headers as Record<string, string>;
        expect(headers.authorization).toBe('Bearer sbp_DEMO');
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    );
    const res = await handleProxy(
      makeReq('GET', {
        path: '/v1/projects',
        origin: ORIGIN,
        auth: 'Bearer sbp_DEMO',
      }),
      [ORIGIN],
      fetchImpl as unknown as typeof fetch
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('pause d’un projet (POST) autorisée → relaie + corps transmis', async () => {
    const ref = 'abcdefghijklmnopqrst';
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        `https://api.supabase.com/v1/projects/${ref}/pause`
      );
      return new Response('{}', { status: 200 });
    });
    const res = await handleProxy(
      makeReq('POST', {
        path: `/v1/projects/${ref}/pause`,
        origin: ORIGIN,
        auth: 'Bearer sbp_DEMO',
        body: '{}',
      }),
      [ORIGIN],
      fetchImpl as unknown as typeof fetch
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('PAT manquant → 401', async () => {
    const res = await handleProxy(
      makeReq('GET', { path: '/v1/projects', origin: ORIGIN }),
      [ORIGIN]
    );
    expect(res.status).toBe(401);
  });

  it('parseOrigins : liste vide → ["*"], sinon découpe/trim', () => {
    expect(parseOrigins('')).toEqual(['*']);
    expect(parseOrigins(undefined)).toEqual(['*']);
    expect(parseOrigins('a, b ,c')).toEqual(['a', 'b', 'c']);
  });
});
