/**
 * Indice affichable d'une URL de webhook : l'origine et les quatre derniers
 * caractères. L'URL d'un webhook Slack ou Discord EST le secret — la rendre
 * en entier au navigateur reviendrait à la publier. Partagé : le serveur le
 * calcule à l'enregistrement, la démo aussi.
 */
export function webhookHint(url: string): string {
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname}${parsed.search}`;
    return rest.length > 4
      ? `${parsed.origin}/…${rest.slice(-4)}`
      : `${parsed.origin}${rest}`;
  } catch {
    return '…';
  }
}
