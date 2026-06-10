/**
 * Construction de l'app Fastify (testable via fastify.inject, sans listen).
 * Sécurité : logs avec redaction, rate limiting, en-têtes durcis, erreurs
 * normalisées sans fuite d'interne.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { FleetError } from './fleet.ts';
import {
  BudgetExceededError,
  CircuitOpenError,
  HttpError,
} from './supabase/http.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerAccountRoutes } from './routes/accounts.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerSystemRoutes } from './routes/system.ts';
import type { AppContext } from './context.ts';

export interface BuildOptions {
  /** Dossier du build front à servir (production). */
  staticDir?: string;
  logger?: boolean;
}

export async function buildApp(
  ctx: AppContext,
  options: BuildOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: ctx.env.production ? 'info' : 'debug',
            // Jamais de secret dans les logs : cookies, authorization, PAT.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.pat',
                '*.password',
                '*.passphrase',
              ],
              censor: '[masqué]',
            },
          },
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: [],
  });

  // En-têtes de sécurité sur toutes les réponses.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=()'
    );
    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
    }
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.includes('text/html')) {
      reply.header(
        'content-security-policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      );
    }
    if (ctx.env.secureCookies) {
      reply.header(
        'strict-transport-security',
        'max-age=63072000; includeSubDomains'
      );
    }
  });

  // Erreurs normalisées — le détail interne reste dans les logs serveur.
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      const message = error.issues
        .map(i => `${i.path.join('.')} : ${i.message}`)
        .join(' ; ');
      return reply.code(400).send({ error: 'validation', message });
    }
    if (error instanceof FleetError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.assessment ? { assessment: error.assessment } : {}),
      });
    }
    if (error instanceof BudgetExceededError) {
      return reply
        .code(429)
        .send({ error: 'api-budget', message: error.message });
    }
    if (error instanceof CircuitOpenError) {
      return reply
        .code(503)
        .send({ error: 'circuit-open', message: error.message });
    }
    if (error instanceof HttpError) {
      const message =
        error.status === 401
          ? 'PAT refusé par Supabase (révoqué ou expiré ?)'
          : error.status === 403
            ? 'Permissions insuffisantes côté Supabase'
            : `Supabase a répondu HTTP ${error.status}`;
      return reply.code(502).send({ error: 'upstream', message });
    }
    // @fastify/rate-limit pose statusCode 429 sur son erreur.
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (statusCode === 429) {
      return reply
        .code(429)
        .send({ error: 'rate-limited', message: 'Trop de requêtes' });
    }
    req.log.error(error);
    return reply
      .code(500)
      .send({ error: 'internal', message: 'Erreur interne' });
  });

  registerSystemRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerAccountRoutes(app, ctx);
  registerProjectRoutes(app, ctx);

  // Production : sert le build PWA (même origine que l'API → cookies Strict).
  if (options.staticDir && existsSync(options.staticDir)) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
      maxAge: '1h',
      immutable: false,
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'Route inconnue' });
      }
      // SPA (HashRouter) : tout le reste retombe sur index.html.
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler(async (_req, reply) =>
      reply.code(404).send({ error: 'not-found', message: 'Route inconnue' })
    );
  }

  return app;
}
