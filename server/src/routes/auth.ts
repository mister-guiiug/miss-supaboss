import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  loginBodySchema,
  userCreateBodySchema,
  type UserDto,
} from '../../../shared/contracts.ts';
import {
  hashPassword,
  hashToken,
  newSessionToken,
  verifyPassword,
} from '../crypto.ts';
import {
  SESSION_COOKIE,
  TOTP_CHALLENGE_COOKIE,
  TOTP_CHALLENGE_TTL_SECONDS,
  challengeCookieOptions,
  requireCsrfHeader,
  requireRole,
  startSession,
} from '../auth.ts';
import type { AppContext } from '../context.ts';

export function toUserDto(u: {
  id: string;
  email: string;
  role: UserDto['role'];
}): UserDto {
  return { id: u.id, email: u.email, role: u.role };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  ctx: AppContext
): void {
  app.post(
    '/api/auth/login',
    {
      // L'en-tête anti-CSRF aussi sur la connexion : un formulaire d'un autre
      // site ne peut pas le poser, donc ne peut pas connecter la victime à un
      // compte choisi par l'attaquant (login CSRF).
      preHandler: requireCsrfHeader,
      config: {
        // Anti force brute : 10 tentatives / minute / IP.
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const body = loginBodySchema.parse(req.body);
      const user = ctx.store.findUserByEmail(body.email);
      if (!user || !verifyPassword(body.password, user.passwordHash)) {
        ctx.store.recordOperation({
          userEmail: body.email,
          action: 'login',
          status: 'error',
          detail: 'Identifiants invalides',
        });
        return reply.code(401).send({
          error: 'bad-credentials',
          message: 'Identifiants invalides',
        });
      }
      // Double authentification active : le mot de passe ne suffit pas. Pas
      // de session — une ÉTAPE, que seul un code valide échange contre elle
      // (`POST /api/auth/login/totp`).
      if (ctx.store.getTotp(user.id)?.enabled) {
        const challenge = newSessionToken();
        ctx.store.createLoginChallenge(
          hashToken(challenge),
          user.id,
          TOTP_CHALLENGE_TTL_SECONDS
        );
        ctx.store.purgeExpiredChallenges();
        return reply
          .setCookie(
            TOTP_CHALLENGE_COOKIE,
            challenge,
            challengeCookieOptions(ctx)
          )
          .send({ totpRequired: true });
      }
      ctx.store.recordOperation({
        userEmail: user.email,
        action: 'login',
        status: 'ok',
      });
      return startSession(ctx, reply, user).send({ user: toUserDto(user) });
    }
  );

  app.post(
    '/api/auth/logout',
    { preHandler: [requireRole(ctx, 'viewer'), requireCsrfHeader] },
    async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) ctx.store.deleteSession(hashToken(token));
      return reply
        .clearCookie(SESSION_COOKIE, { path: '/' })
        .send({ ok: true });
    }
  );

  app.get(
    '/api/auth/me',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => ({ user: toUserDto(req.user as NonNullable<typeof req.user>) })
  );

  /* ── Gestion des utilisateurs internes (RBAC simple) ─────────────────── */

  app.get(
    '/api/auth/users',
    { preHandler: requireRole(ctx, 'admin') },
    async () => ({ users: ctx.store.listUsers().map(toUserDto) })
  );

  app.post(
    '/api/auth/users',
    { preHandler: [requireRole(ctx, 'admin'), requireCsrfHeader] },
    async (req, reply) => {
      const body = userCreateBodySchema.parse(req.body);
      if (ctx.store.findUserByEmail(body.email)) {
        return reply
          .code(409)
          .send({ error: 'exists', message: 'Cet e-mail existe déjà' });
      }
      const user = ctx.store.createUser(
        body.email,
        hashPassword(body.password),
        body.role
      );
      return reply.code(201).send({ user: toUserDto(user) });
    }
  );

  app.delete(
    '/api/auth/users/:id',
    { preHandler: [requireRole(ctx, 'admin'), requireCsrfHeader] },
    async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const me = req.user as NonNullable<typeof req.user>;
      if (id === me.id) {
        return reply.code(409).send({
          error: 'self-delete',
          message: 'Impossible de supprimer son propre compte',
        });
      }
      const admins = ctx.store.listUsers().filter(u => u.role === 'admin');
      if (admins.length === 1 && admins[0]?.id === id) {
        return reply.code(409).send({
          error: 'last-admin',
          message: 'Impossible de supprimer le dernier admin',
        });
      }
      if (!ctx.store.deleteUser(id)) {
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'Utilisateur introuvable' });
      }
      return { ok: true };
    }
  );
}
