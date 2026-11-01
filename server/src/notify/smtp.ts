/**
 * Envoi SMTP minimal (AUTH LOGIN, STARTTLS ou TLS implicite).
 * Activé quand `SUPABOSS_SMTP_URL` est posé
 * (`smtp://user:pass@host:587` ou `smtps://…:465`).
 *
 * Pas de nodemailer : une dépendance de plus pour un canal optionnel.
 */
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface SmtpSendResult {
  ok: boolean;
  error?: string;
}

function parseSmtpUrl(raw: string): {
  secure: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
} {
  const u = new URL(raw);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') {
    throw new Error('SUPABOSS_SMTP_URL : schéma smtp:// ou smtps:// attendu');
  }
  const secure = u.protocol === 'smtps:';
  return {
    secure,
    host: u.hostname,
    port: u.port ? Number(u.port) : secure ? 465 : 587,
    user: decodeURIComponent(u.username),
    pass: decodeURIComponent(u.password),
  };
}

async function readLine(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (buf: Buffer) => {
      cleanup();
      resolve(buf.toString('utf8'));
    };
    const onErr = (e: Error) => {
      cleanup();
      reject(e);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onErr);
    };
    socket.on('data', onData);
    socket.on('error', onErr);
  });
}

async function expectCode(socket: Socket, code: number): Promise<string> {
  const raw = await readLine(socket);
  const line = raw.split(/\r?\n/).find(l => /^\d{3}/.test(l)) ?? raw;
  if (!line.startsWith(String(code))) {
    throw new Error(`SMTP attendu ${code}, reçu : ${line.trim()}`);
  }
  return line;
}

async function write(socket: Socket, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(line + '\r\n', err => (err ? reject(err) : resolve()));
  });
}

/**
 * Envoie un message texte. `smtpUrl` au format
 * `smtp://user:pass@host:587` (STARTTLS) ou `smtps://…:465`.
 */
export async function sendSmtp(
  smtpUrl: string,
  message: SmtpMessage
): Promise<SmtpSendResult> {
  let cfg;
  try {
    cfg = parseSmtpUrl(smtpUrl);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'URL SMTP invalide',
    };
  }
  if (!cfg.user || !cfg.pass) {
    return { ok: false, error: 'SMTP : utilisateur/mot de passe manquants' };
  }

  let socket: Socket | null = null;
  try {
    socket = cfg.secure
      ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : netConnect({ host: cfg.host, port: cfg.port });

    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', () => resolve());
      socket!.once('secureConnect', () => resolve());
      socket!.once('error', reject);
    });

    await expectCode(socket, 220);
    await write(socket, `EHLO miss-supaboss`);
    await readLine(socket); // multi-ligne EHLO — on consomme un bloc

    if (!cfg.secure) {
      await write(socket, 'STARTTLS');
      await expectCode(socket, 220);
      socket = tlsConnect({
        socket,
        host: cfg.host,
        servername: cfg.host,
      });
      await new Promise<void>((resolve, reject) => {
        socket!.once('secureConnect', () => resolve());
        socket!.once('error', reject);
      });
      await write(socket, `EHLO miss-supaboss`);
      await readLine(socket);
    }

    await write(socket, 'AUTH LOGIN');
    await expectCode(socket, 334);
    await write(socket, Buffer.from(cfg.user).toString('base64'));
    await expectCode(socket, 334);
    await write(socket, Buffer.from(cfg.pass).toString('base64'));
    await expectCode(socket, 235);

    await write(socket, `MAIL FROM:<${message.from}>`);
    await expectCode(socket, 250);
    await write(socket, `RCPT TO:<${message.to}>`);
    await expectCode(socket, 250);
    await write(socket, 'DATA');
    await expectCode(socket, 354);

    const headers = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text.replace(/\r?\n\./g, '\r\n..'),
      '.',
    ].join('\r\n');
    await write(socket, headers);
    await expectCode(socket, 250);
    await write(socket, 'QUIT');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'envoi SMTP impossible',
    };
  } finally {
    try {
      socket?.destroy();
    } catch {
      /* ignore */
    }
  }
}

export { parseSmtpUrl };
