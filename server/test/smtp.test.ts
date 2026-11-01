import { describe, expect, it } from 'vitest';
import { parseSmtpUrl } from '../src/notify/smtp.ts';

describe('parseSmtpUrl', () => {
  it('smtp:// → STARTTLS port 587', () => {
    expect(parseSmtpUrl('smtp://u%40x:p%40ss@mail.example:587')).toEqual({
      secure: false,
      host: 'mail.example',
      port: 587,
      user: 'u@x',
      pass: 'p@ss',
    });
  });

  it('smtps:// → TLS implicite 465', () => {
    expect(parseSmtpUrl('smtps://user:secret@smtp.example')).toMatchObject({
      secure: true,
      host: 'smtp.example',
      port: 465,
      user: 'user',
      pass: 'secret',
    });
  });

  it('refuse un autre schéma', () => {
    expect(() => parseSmtpUrl('https://x')).toThrow(/smtp/);
  });
});
