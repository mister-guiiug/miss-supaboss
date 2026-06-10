/** Sessions par cookie httpOnly + RBAC. Les tokens sont stockés hashés. */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { hashToken } from './crypto.ts';
import { hasRole, type AppContext, type MinRole } from './context.ts';

export const SESSION_COOKIE = 'supaboss_session';
export const SESSION_TTL_HOURS = 7 * 24;

export function cookieOptions(ctx: AppContext) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: ctx.env.secureCookies,
    maxAge: SESSION_TTL_HOURS * 3600,
  } as const;
}

/** preHandler : authentifie via cookie et exige un rôle minimal. */
export function requireRole(ctx: AppContext, min: MinRole) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? ctx.store.findSessionUser(hashToken(token)) : null;
    if (!user) {
      await reply
        .code(401)
        .send({ error: 'unauthorized', message: 'Session requise' });
      return;
    }
    if (!hasRole(user, min)) {
      await reply.code(403).send({
        error: 'forbidden',
        message: `Rôle ${min} requis (vous : ${user.role})`,
      });
      return;
    }
    req.user = user;
  };
}

/**
 * Anti-CSRF pour les mutations : cookie SameSite=Strict + en-tête custom
 * obligatoire (les formulaires cross-site ne peuvent pas poser d'en-tête).
 */
export async function requireCsrfHeader(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (req.headers['x-supaboss-csrf'] !== '1') {
    await reply.code(403).send({
      error: 'csrf',
      message: 'En-tête X-Supaboss-Csrf manquant',
    });
  }
}
