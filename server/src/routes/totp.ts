/**
 * Double authentification (TOTP) : seconde étape du login, enrôlement,
 * activation, désactivation.
 *
 * Toutes les vérifications de code sont LIMITÉES EN DÉBIT (par adresse, en
 * plus des cinq essais par étape de connexion) : un million de codes à six
 * chiffres, trois valides à un instant donné, ne se devinent pas à ce rythme.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  loginTotpBodySchema,
  totpActivateBodySchema,
  totpDisableBodySchema,
  type TotpStatusDto,
} from '../../../shared/contracts.ts';
import {
  TOTP_CHALLENGE_COOKIE,
  TOTP_CHALLENGE_MAX_ATTEMPTS,
  requireCsrfHeader,
  requireRole,
  startSession,
} from '../auth.ts';
import {
  hashSecretAsync,
  hashToken,
  openSecret,
  sealSecret,
  verifyPassword,
  verifySecretAsync,
} from '../crypto.ts';
import type { AppContext } from '../context.ts';
import type { TotpRow, UserRow } from '../db.ts';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  matchTotp,
  normalizeRecoveryCode,
  otpauthUri,
} from '../totp.ts';
import { toUserDto } from './auth.ts';

/** Débit des vérifications de code, par adresse. */
const CODE_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

type SecondFactor = { code: string } | { recoveryCode: string };

/**
 * Consomme un second facteur. Un code TOTP n'est accepté qu'une fois (pas
 * mémorisé) ; un code de secours est brûlé. Rend la voie empruntée, ou null.
 */
async function consumeSecondFactor(
  ctx: AppContext,
  user: UserRow,
  totp: TotpRow,
  factor: SecondFactor
): Promise<'totp' | 'recovery' | null> {
  if ('code' in factor) {
    const secret = openSecret(totp.secretCipher, ctx.masterKey);
    const step = matchTotp(secret, factor.code, {
      nowMs: Date.now(),
      lastStep: totp.lastStep,
    });
    return step !== null && ctx.store.claimTotpStep(user.id, step)
      ? 'totp'
      : null;
  }
  const candidate = normalizeRecoveryCode(factor.recoveryCode);
  for (const stored of ctx.store.listUnusedRecoveryCodes(user.id)) {
    if (await verifySecretAsync(candidate, stored.hash)) {
      return ctx.store.useRecoveryCode(stored.id) ? 'recovery' : null;
    }
  }
  return null;
}

/** Six chiffres : l'application ; autre chose : un code de secours. */
function factorOf(code: string): SecondFactor {
  return /^\d{6}$/.test(code) ? { code } : { recoveryCode: code };
}

function statusOf(ctx: AppContext, userId: string): TotpStatusDto {
  const totp = ctx.store.getTotp(userId);
  return {
    enabled: totp?.enabled ?? false,
    pending: totp !== null && !totp.enabled,
    recoveryCodesLeft: totp?.enabled
      ? ctx.store.countUnusedRecoveryCodes(userId)
      : 0,
  };
}

export function registerTotpRoutes(
  app: FastifyInstance,
  ctx: AppContext
): void {
  const expired = (reply: FastifyReply) =>
    reply
      .clearCookie(TOTP_CHALLENGE_COOKIE, { path: '/api/auth' })
      .code(401)
      .send({
        error: 'totp-expired',
        message: 'Étape expirée : saisissez à nouveau votre mot de passe',
      });

  /* ── Seconde étape du login ─────────────────────────────────────────── */

  app.post(
    '/api/auth/login/totp',
    {
      preHandler: requireCsrfHeader,
      config: { rateLimit: CODE_RATE_LIMIT },
    },
    async (req, reply) => {
      const token = req.cookies[TOTP_CHALLENGE_COOKIE];
      const tokenHash = token ? hashToken(token) : null;
      const challenge = tokenHash
        ? ctx.store.findLoginChallenge(tokenHash)
        : null;
      if (!tokenHash || !challenge) return expired(reply);
      const user = ctx.store.getUser(challenge.userId);
      const totp = user ? ctx.store.getTotp(user.id) : null;
      if (!user || !totp?.enabled) {
        ctx.store.deleteLoginChallenge(tokenHash);
        return expired(reply);
      }

      const factor = loginTotpBodySchema.parse(req.body);
      const via = await consumeSecondFactor(ctx, user, totp, factor);
      if (!via) {
        ctx.store.recordChallengeFailure(
          tokenHash,
          TOTP_CHALLENGE_MAX_ATTEMPTS
        );
        ctx.store.recordOperation({
          userEmail: user.email,
          action: 'login',
          status: 'error',
          detail: 'Code de double authentification refusé',
        });
        return reply.code(401).send({
          error: 'bad-totp',
          message: 'Code invalide ou déjà utilisé',
        });
      }

      ctx.store.deleteLoginChallenge(tokenHash);
      ctx.store.recordOperation({
        userEmail: user.email,
        action: 'login',
        status: 'ok',
        detail:
          via === 'totp'
            ? 'Double authentification'
            : `Code de secours (${ctx.store.countUnusedRecoveryCodes(user.id)} restant(s))`,
      });
      return startSession(ctx, reply, user)
        .clearCookie(TOTP_CHALLENGE_COOKIE, { path: '/api/auth' })
        .send({ user: toUserDto(user) });
    }
  );

  /* ── Réglages : état, enrôlement, activation, désactivation ─────────── */

  app.get(
    '/api/auth/totp',
    { preHandler: requireRole(ctx, 'viewer') },
    async req => {
      const user = req.user as UserRow;
      return { totp: statusOf(ctx, user.id) };
    }
  );

  app.post(
    '/api/auth/totp/enroll',
    {
      preHandler: [requireRole(ctx, 'viewer'), requireCsrfHeader],
      config: { rateLimit: CODE_RATE_LIMIT },
    },
    async (req, reply) => {
      const user = req.user as UserRow;
      const secret = generateTotpSecret();
      // Refusé si la 2FA est déjà active : on ne remplace pas un secret qui
      // protège le compte sans passer par la désactivation (mot de passe +
      // code).
      if (
        !ctx.store.savePendingTotp(user.id, sealSecret(secret, ctx.masterKey))
      ) {
        return reply.code(409).send({
          error: 'totp-enabled',
          message: 'La double authentification est déjà active',
        });
      }
      return reply
        .code(201)
        .send({ secret, otpauthUri: otpauthUri(secret, user.email) });
    }
  );

  app.post(
    '/api/auth/totp/activate',
    {
      preHandler: [requireRole(ctx, 'viewer'), requireCsrfHeader],
      config: { rateLimit: CODE_RATE_LIMIT },
    },
    async (req, reply) => {
      const user = req.user as UserRow;
      const { code } = totpActivateBodySchema.parse(req.body);
      const totp = ctx.store.getTotp(user.id);
      if (!totp || totp.enabled) {
        return reply.code(409).send({
          error: totp ? 'totp-enabled' : 'totp-not-enrolled',
          message: totp
            ? 'La double authentification est déjà active'
            : 'Aucun enrôlement en cours',
        });
      }
      // L'activation n'a lieu que sur preuve que l'application a bien
      // enregistré le secret : un premier code valide.
      const step = matchTotp(
        openSecret(totp.secretCipher, ctx.masterKey),
        code,
        { nowMs: Date.now(), lastStep: null }
      );
      if (step === null) {
        return reply.code(400).send({
          error: 'bad-totp',
          message: 'Code invalide : vérifiez l’heure du téléphone',
        });
      }
      const recoveryCodes = generateRecoveryCodes();
      const hashes = await Promise.all(
        recoveryCodes.map(c => hashSecretAsync(normalizeRecoveryCode(c)))
      );
      if (!ctx.store.enableTotp(user.id, step)) {
        return reply.code(409).send({
          error: 'totp-enabled',
          message: 'La double authentification est déjà active',
        });
      }
      ctx.store.replaceRecoveryCodes(user.id, hashes);
      ctx.store.recordOperation({
        userEmail: user.email,
        action: 'auth.totp',
        status: 'ok',
        detail: `Double authentification activée (${recoveryCodes.length} codes de secours)`,
      });
      // Les codes en clair ne sont rendus qu'ICI, une fois : la base n'en
      // garde que le hachage.
      return { recoveryCodes };
    }
  );

  app.post(
    '/api/auth/totp/disable',
    {
      preHandler: [requireRole(ctx, 'viewer'), requireCsrfHeader],
      config: { rateLimit: CODE_RATE_LIMIT },
    },
    async (req, reply) => {
      const user = req.user as UserRow;
      const body = totpDisableBodySchema.parse(req.body);
      const totp = ctx.store.getTotp(user.id);
      if (!totp?.enabled) {
        return reply.code(409).send({
          error: 'totp-not-enabled',
          message: 'La double authentification n’est pas active',
        });
      }
      const refuse = (detail: string, error: string, message: string) => {
        ctx.store.recordOperation({
          userEmail: user.email,
          action: 'auth.totp',
          status: 'error',
          detail,
        });
        return reply.code(400).send({ error, message });
      };
      if (!verifyPassword(body.password, user.passwordHash)) {
        return refuse(
          'Désactivation refusée : mot de passe incorrect',
          'bad-password',
          'Mot de passe incorrect'
        );
      }
      const via = await consumeSecondFactor(
        ctx,
        user,
        totp,
        factorOf(body.code)
      );
      if (!via) {
        return refuse(
          'Désactivation refusée : code invalide',
          'bad-totp',
          'Code invalide ou déjà utilisé'
        );
      }
      ctx.store.deleteTotp(user.id);
      ctx.store.recordOperation({
        userEmail: user.email,
        action: 'auth.totp',
        status: 'ok',
        detail: 'Double authentification désactivée',
      });
      return { ok: true };
    }
  );
}
