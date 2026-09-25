/*
 * Gestionnaires Web Push, importés par le service worker que Workbox
 * engendre (vite.config.ts → workbox.importScripts), comme dans mister-doc.
 * Inertes tant qu'aucun push n'arrive : la mise en cache et la mise à jour
 * de l'app n'en dépendent pas.
 *
 * Contenu attendu (JSON, chiffré de bout en bout par le serveur) :
 * { title, body, url, tag }. `url` est relative au scope du worker
 * (`./#/projects/…`) : le même message sert le build Pages et le serveur.
 */
/* global self */

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'Miss Supaboss' };
  }
  const title = data.title || 'Miss Supaboss';
  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    // Même étiquette : la notification précédente est REMPLACÉE (une jauge
    // qui passe de 85 à 95 % n'empile pas deux alertes).
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || './' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    (async () => {
      const url = new URL(target, self.registration.scope).href;
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) {
            try {
              await client.navigate(url);
            } catch {
              /* même document : le focus suffit */
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })()
  );
});
