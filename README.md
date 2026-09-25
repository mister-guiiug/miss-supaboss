# Miss Supaboss

PWA mobile-first de **pilotage multi-comptes Supabase Free** : inventaire
consolidé des projets, **pause / restauration à la demande ou planifiée**
(limite de 2 projets actifs par compte gérée par garde-fous), **suivi des
quotas Free Plan** (Egress, Database size, MAU, File storage) avec **alertes
Web Push / webhook**, **double authentification (TOTP)** et **workflow guidé
de préparation de démo**. Pensée pour les POC et démonstrateurs — pas pour des
environnements critiques.

> 🟢 **Démo publique (mode mock, aucun secret)** :
> <https://mister-guiiug.github.io/miss-supaboss/>
> 🔐 **Mode réel** : auto-hébergé via Docker (les PAT ne quittent jamais le
> serveur).

---

## 1. Cadrage fonctionnel

| Besoin                              | Réponse                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plusieurs comptes Supabase gratuits | Comptes ajoutés avec un alias + PAT (chiffré serveur), activables/désactivables, testables, import/export chiffré                                   |
| Voir actifs / en pause              | Vue consolidée multi-comptes, statuts temps réel (15 statuts Management API regroupés en 5 familles UI), recherche / tri / filtres / groupes        |
| Pause / restore à la demande        | Actions confirmées, états transitoires suivis (polling resserré à 5 s), erreurs exploitables, historique d'audit                                    |
| Limite « 2 projets actifs »         | Garde-fou : compteur x/2 par compte, restauration bloquée à la limite (409 + suggestions), proposition automatique des projets à suspendre          |
| Quotas Free Plan                    | Egress · Database size · MAU · File storage en « consommé / quota » (`31 MB / 5 GB`), jauges + seuils configurables (70/85/95 %), synthèse → détail |
| Démos                               | « Préparer la démo » : workflow guidé en 5 étapes, favoris, « démo fréquente », « ce que je peux démarrer maintenant »                              |
| « Pause vendredi soir »             | Plannings par projet (ponctuel ou hebdomadaire, fuseau Europe/Paris par défaut), exécutés par le serveur à travers les MÊMES garde-fous qu'un clic  |
| Être prévenu                        | Alertes au franchissement d'un seuil (une par niveau et par mois) et à J-7 / J-1 de la fin de fenêtre de restauration — Web Push et/ou webhook      |
| Connexion                           | Double authentification TOTP (RFC 6238) optionnelle par utilisateur, codes de secours à usage unique                                                |
| Mobile + offline                    | PWA installable, standalone, dernier état connu consultable hors ligne (IndexedDB), **aucune action destructive hors ligne**                        |

## 2. Architecture

```
┌────────────────────────── navigateur ─────────────────────────────┐
│  PWA React 19 (Vite 8, Tailwind 4, Zustand, zod)                  │
│  · stores : session / flotte / UI    · cache IDB « dernier état » │
│  · API client validé zod  ──── ou ──── API mock (VITE_MOCK=1)     │
└────────────────┬──────────────────────────────────────────────────┘
                 │ HTTPS même origine — cookie httpOnly + en-tête CSRF
┌────────────────▼──────────────────────────────────────────────────┐
│  Serveur Node ≥ 22.18 (Fastify 5, TypeScript natif, zéro build)   │
│  · auth sessions + RBAC (admin / operator / viewer) + TOTP        │
│  · garde-fous partagés (shared/) + audit log                      │
│  · SQLite (node:sqlite, migrations) : users, comptes (PAT         │
│    AES-256-GCM), méta projets, opérations, cache métriques,       │
│    plannings, canaux de notification, secrets TOTP scellés        │
│  · tâche de fond (1 min) : plannings dus + synchro (15 min)       │
│    └ chaque synchro ──► alertes ──► Web Push │ webhook            │
│  · SupabaseProvider ──► ManagementApiProvider │ MockProvider      │
│        └ ResilientClient : timeout, retry+backoff+jitter,         │
│          Retry-After, circuit breaker, budget 50 req/min/compte   │
└───────┬─────────────────────────────────────────┬─────────────────┘
        │ Bearer PAT (jamais côté client)         │ VAPID (ES256) + aes128gcm
https://api.supabase.com (Management API v1)   services push │ URL https
```

- **`shared/`** : domaine pur TypeScript importé par le front ET le serveur
  (statuts, quotas, garde-fous, contrats zod, formatage) — mêmes règles des
  deux côtés, testé unitairement.
- **`server/`** : exécuté **sans transpilation** (type stripping Node) ;
  `erasableSyntaxOnly` garanti par le tsconfig.
- **`src/`** : PWA ; en mode mock, le client API est remplacé par une
  implémentation locale qui réutilise les mêmes garde-fous partagés.

### Endpoints Supabase utilisés (vérifiés dans l'OpenAPI officiel)

| Usage                    | Endpoint                                                  |
| ------------------------ | --------------------------------------------------------- |
| Organisations            | `GET /v1/organizations`                                   |
| Inventaire projets       | `GET /v1/projects` (statuts : 15 valeurs d'enum)          |
| Pause                    | `POST /v1/projects/{ref}/pause`                           |
| Restauration             | `POST /v1/projects/{ref}/restore`                         |
| Métriques DB/Storage/MAU | `POST /v1/projects/{ref}/database/query/read-only` [Beta] |

Métriques par requêtes SQL **read-only** (projet actif uniquement) :
`pg_database_size(current_database())`, `sum(storage.objects.metadata->>'size')`,
`count(auth.users where last_sign_in_at >= début de mois)` (➜ MAU
**estimés**).

## 3. Hypothèses et limites (assumées, jamais inventées)

1. **Egress : non disponible.** Aucun endpoint public documenté n'expose
   l'egress du Free Plan (le dashboard Supabase utilise une API plateforme
   privée). Le champ s'affiche `— / 5 GB · non disponible via API`, derrière
   l'interface `SupabaseProvider` (TODO tracé dans
   `server/src/supabase/management.ts`) pour brancher une source future.
2. **MAU = estimation** (connexions du mois via `auth.users`) — étiquetée
   « estimation » dans l'UI.
3. **Dernière activité / date de pause** : la Management API ne les expose
   pas. Miss Supaboss **observe** les transitions à chaque synchro
   (`lastSeenActiveAt`, `pausedAt`) ; une pause déclenchée par l'app pose une
   date certaine ; un projet découvert déjà en pause affiche « date
   inconnue ».
4. **Fenêtre de restauration = estimation** `pausedAt + 90 j` (politique
   Supabase susceptible d'évoluer, réglable dans Réglages).
5. **Quotas Free** (5 GB / 500 MB / 50k / 1 GB) : constantes produit (juin 2026) ; la synthèse multi-comptes est une somme indicative (les quotas
   réels s'appliquent par organisation).
6. **Rate limit Management API** : budget local de 50 req/min/compte (limite
   documentée : 60), réglable via `SUPABOSS_API_BUDGET_PER_MIN`.
7. Démo GitHub Pages = **mock intégral** (état persisté en localStorage) ;
   l'import de configuration y est volontairement désactivé.
8. **Mode démo à chaud** : sur une instance réelle, Réglages → « Mode démo »
   bascule l'app sur les données fictives (et inversement) sans rebuild —
   badge « démo » dans l'en-tête, snapshot hors-ligne purgé à la bascule.
   Sur le build Pages (`VITE_MOCK=1`) sans proxy, le mock est forcé (pas de
   backend). **Mode réel local-first** : en fournissant un proxy CORS
   (`VITE_SUPABASE_PROXY`, cf. `proxy/` — Cloudflare Worker), la
   PWA Pages interroge directement la Management API avec ton PAT (stocké en
   local) — la démo devient alors désactivable.
9. **Plannings = serveur.** Une tâche du serveur passe chaque minute ; une
   échéance est jouée **au plus une fois** (avancée en base avant d'agir :
   un redémarrage ne la rejoue pas, une exécution coupée est signalée « en
   erreur » dans l'historique). Une échéance manquée de plus d'une heure
   (serveur arrêté) n'est **pas rattrapée** : elle est consignée
   « manquée ». Mêmes garde-fous qu'un clic : une restauration planifiée qui
   ferait un 3ᵉ projet actif est **refusée** — aucun autre projet n'est mis en
   pause à sa place. Heures murales dans un fuseau IANA (Europe/Paris par
   défaut) : une heure qui n'existe pas au changement d'heure est repoussée
   d'autant, une heure ambiguë prend sa première occurrence. La démo garde
   ses plannings en localStorage **sans jamais les exécuter** (l'écran le
   dit) ; le mode local-first n'en a pas (rien ne tourne onglet fermé).
10. **Alertes = estimations, évaluées à chaque synchro.** Seuils de
    l'utilisateur (70/85/95 % par défaut) : une alerte au franchissement **à
    la hausse**, une par niveau et par mois (UTC). Fin de fenêtre : J-7 puis
    J-1 avant `pausedAt + fenêtre` — donc rien pour un projet découvert déjà
    en pause (date inconnue, point 3). Le serveur synchronise la flotte en
    fond toutes les 15 min (`SUPABOSS_SYNC_INTERVAL_MIN`, Management API
    seule) ; il ne **collecte les quotas en fond que sur demande**
    (`SUPABOSS_SYNC_METRICS=1`) : la collecte interroge la base de chaque
    projet actif, et rien ne documente si Supabase la compte comme de
    l'activité (ce qui retarderait sa mise en pause automatique). Sans ce
    réglage, les alertes de quota partent aux collectes déclenchées par
    l'app. Messages rédigés en français par le serveur.
11. **Canaux : Web Push et webhook, pas d'e-mail** (il faudrait un serveur
    SMTP, que l'instance n'a pas). Web Push : clés VAPID engendrées au premier
    démarrage, chiffrées par la clé maître ; changer de clé maître rend le
    push indisponible (les abonnements dépendent de l'ancienne clé publique)
    plutôt que de régénérer en silence. Sur iPhone/iPad, le push n'existe
    qu'**app installée** (iOS ≥ 16.4). Webhook : POST JSON vers une URL
    **https** saisie par l'utilisateur, délai de 8 s, aucune redirection vers
    une autre origine. L'URL est appelée PAR LE SERVEUR, donc **aucune
    destination interne** (garde anti-SSRF, §7) : un ntfy auto-hébergé sur le
    réseau local demande `SUPABOSS_WEBHOOK_ALLOW_PRIVATE=1`, que tout compte
    pourra alors utiliser pour sonder ce réseau. La démo montre les réglages
    et dit que l'envoi demande le serveur.
12. **Double authentification = serveur.** TOTP SHA-1, 6 chiffres, 30 s,
    ±1 pas ; un code déjà accepté est refusé s'il revient. Téléphone ET codes
    de secours perdus : `SUPABOSS_TOTP_RESET=<e-mail>` retire la 2FA de ce
    compte au démarrage (à retirer ensuite). La démo et le mode local-first
    n'ont pas de connexion, donc pas de 2FA.

## 4. Structure des dossiers

```
miss-supaboss/
├── shared/                  # Domaine partagé front ↔ serveur (pur, testé)
│   ├── status.ts            #  statuts Management API + groupes UI
│   ├── quotas.ts            #  quotas Free Plan, MetricValue, seuils
│   ├── guards.ts            #  limite 2 actifs, suggestions, fenêtre 90 j
│   ├── schedule.ts          #  échéances des plannings (fuseaux IANA, pur)
│   ├── contracts.ts         #  contrat d'API (schémas zod, DTO)
│   └── format.ts            #  octets/compteurs/pourcents/dates FR
├── server/
│   ├── tsconfig.json        #  erasableSyntaxOnly (type stripping Node)
│   ├── src/
│   │   ├── index.ts         #  bootstrap (clé maître, admin, listen, tâche)
│   │   ├── boot.ts          #  au démarrage : VAPID, secours TOTP, reprises
│   │   ├── app.ts           #  Fastify : sécurité, erreurs, routes, statique
│   │   ├── context.ts       #  assemblage des services (serveur ET tests)
│   │   ├── env.ts           #  env validé zod
│   │   ├── crypto.ts        #  AES-256-GCM, scrypt, sessions, export
│   │   ├── db.ts            #  SQLite node:sqlite (Store) + migrations
│   │   ├── auth.ts          #  cookie session + RBAC + CSRF + étape TOTP
│   │   ├── totp.ts          #  RFC 6238/4226, base32, codes de secours
│   │   ├── fleet.ts         #  service : synchro, pause/restore, métriques
│   │   ├── schedules.ts     #  plannings : création, exécution au plus 1 fois
│   │   ├── alerts.ts        #  seuils franchis, fin de fenêtre (J-7 / J-1)
│   │   ├── jobs.ts          #  tâche de fond (plannings + synchro)
│   │   ├── notify/          #  webpush.ts (VAPID + aes128gcm), webhook.ts,
│   │   │                    #  service.ts (canaux, remise, statut)
│   │   ├── routes/          #  auth, totp, accounts, projects, schedules,
│   │   │                    #  notifications, system
│   │   └── supabase/        #  provider.ts (interface), management.ts (réel),
│   │                        #  mock.ts, http.ts (résilience)
│   └── test/                #  crypto, store, API (fastify.inject + mock)
├── src/
│   ├── api/                 #  Api (interface) + http.ts (zod) + switch mock
│   ├── mock/                #  mockApi (fixtures, transitions, localStorage)
│   ├── offline/lastKnown.ts #  snapshot IndexedDB (lecture seule hors ligne)
│   ├── store/               #  Zustand : session / flotte / UI (toasts)
│   ├── shared/              #  composants (QuotaBar, StatusBadge, Confirm…)
│   ├── features/            #  dashboard, projects, demo, accounts, quotas,
│   │                        #  history, settings, auth, onboarding, offline
│   └── pwa/UpdatePrompt.tsx
├── public/push-sw.js        #  push + notificationclick (importé par le SW)
├── e2e/critical.spec.ts     #  Playwright (@critical, mode mock)
├── Dockerfile               #  image unique : API + front statique
└── .github/workflows/       #  reusable pwa-ci / pwa-deploy (Pages = mock)
```

## 5. Flux principaux

- **Synchro flotte** : front → `GET /api/fleet` → serveur (cache 15 s) →
  Management API → observations persistées → DTO consolidé → snapshot IDB.
- **Pause** : confirmation UI → `POST …/pause` (operator+, CSRF) → garde
  `isPausable` → Management API → audit `pending → ok|error` → polling 5 s.
- **Restore (démo guidée)** : `GET …/restore-assessment` → si limite : 409 +
  suggestions classées (ni favori, ni démo fréquente, ni `critique-demo`,
  plus ancien d'abord) → l'utilisateur valide les pauses → `POST …/restore
{pauseFirst}` → suivi jusqu'à `ACTIVE_HEALTHY`.
- **Métriques** : `GET /api/fleet/metrics` → SQL read-only sur projets actifs
  (TTL 5 min) → cache SQLite → projets en pause = valeurs `stale` (« dernier
  état connu »), egress = `unavailable`.
- **Hors ligne** : boot sans réseau → session indéterminée → hydratation du
  snapshot IDB → bandeau « hors ligne — état il y a X » → actions désactivées.
- **Connexion avec TOTP** : `POST /api/auth/login` (mot de passe juste) →
  `{ totpRequired: true }` + jeton d'étape en cookie httpOnly (5 min, borné à
  `/api/auth`), **aucune session** → `POST /api/auth/login/totp { code }` ou
  `{ recoveryCode }` → session. Cinq échecs brûlent l'étape.
- **Planning** : `POST …/schedules` (operator+) → `next_run_at` calculé →
  chaque minute, la tâche de fond RÉSERVE l'échéance (avancée en base) puis
  appelle `FleetService.pause|restore` → issue (faite, refusée par un
  garde-fou, erreur, manquée) consignée dans l'historique et sur le planning.
- **Alertes** : toute synchro (écran, action, tâche de fond) → évaluation en
  file → marque anti-spam posée → remise Web Push (chiffrée pour chaque
  navigateur abonné) et webhook → statut `alert.send` dans l'historique ;
  abonnement expiré (404/410) supprimé au passage.

## 6. API du serveur

| Méthode         | Route                                         | Rôle min. | Description                                                                                               |
| --------------- | --------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| POST            | `/api/auth/login` (rate-limit 10/min)         | —         | Session cookie httpOnly, ou `{ totpRequired }` + jeton d'étape                                            |
| POST            | `/api/auth/login/totp` (rate-limit 10/min)    | —         | Code TOTP ou de secours → session (étape en cookie)                                                       |
| POST            | `/api/auth/logout` · GET `/api/auth/me`       | viewer    |                                                                                                           |
| GET             | `/api/auth/totp`                              | viewer    | État 2FA (active, en attente, codes restants)                                                             |
| POST            | `/api/auth/totp/enroll` (rate-limit 10/min)   | viewer    | Secret en attente + URI `otpauth://` (201)                                                                |
| POST            | `/api/auth/totp/activate` (rate-limit 10/min) | viewer    | Premier code → active, rend 10 codes de secours (une fois)                                                |
| POST            | `/api/auth/totp/disable` (rate-limit 10/min)  | viewer    | Mot de passe + code (TOTP ou secours)                                                                     |
| GET/POST/DELETE | `/api/auth/users[/:id]`                       | admin     | RBAC interne                                                                                              |
| GET             | `/api/accounts`                               | viewer    | Comptes (PAT jamais renvoyé, juste un hint)                                                               |
| POST            | `/api/accounts`                               | admin     | Test de connectivité PUIS enregistrement                                                                  |
| PATCH/DELETE    | `/api/accounts/:id`                           | admin     |                                                                                                           |
| POST            | `/api/accounts/:id/test`                      | operator  | Connectivité + compte d'orgs/projets                                                                      |
| POST            | `/api/accounts/export` · `/import`            | admin     | Blob AES-256-GCM dérivé d'une passphrase                                                                  |
| GET             | `/api/fleet[?refresh=1]`                      | viewer    | Inventaire consolidé                                                                                      |
| GET             | `/api/fleet/metrics[?refresh=1]`              | viewer    | Quotas Free Plan                                                                                          |
| GET             | `/api/projects/:acc/:ref[?refresh=1]`         | viewer    | Détail                                                                                                    |
| GET             | `/api/projects/:acc/:ref/restore-assessment`  | viewer    | Garde-fou sans exécution                                                                                  |
| PUT             | `/api/projects/:acc/:ref/meta`                | operator  | Tags, favori, démo fréquente, notes                                                                       |
| POST            | `/api/projects/:acc/:ref/pause` · `/restore`  | operator  | Actions (CSRF requis) — 202 / 409+assessment                                                              |
| GET             | `/api/projects/:acc/:ref/schedules`           | viewer    | Plannings du projet, prochaine exécution                                                                  |
| POST            | `/api/projects/:acc/:ref/schedules`           | operator  | `{ kind: 'once', action, at, timezone? }` ou `{ kind: 'weekly', action, weekday, time, timezone? }` (201) |
| DELETE          | `/api/projects/:acc/:ref/schedules/:id`       | operator  |                                                                                                           |
| GET             | `/api/notifications/settings`                 | viewer    | Canaux : push (clé VAPID publique, appareils), webhook (indice), dernière remise                          |
| PUT             | `/api/notifications/webhook`                  | viewer    | `{ url: 'https://…' \| null }` — scellée, rendue en indice                                                |
| POST/DELETE     | `/api/notifications/push-subscriptions`       | viewer    | `{ subscription }` (transport HTTP du socle)                                                              |
| POST            | `/api/notifications/test` (rate-limit 5/min)  | viewer    | Notification de test sur tous ses canaux → rapport de livraison                                           |
| GET             | `/api/operations?limit&accountId&ref`         | viewer    | Historique / audit                                                                                        |
| GET/PUT         | `/api/me/settings`                            | viewer    | Seuils, polling, fenêtre de restauration                                                                  |
| GET             | `/api/system/health`                          | public    | Sonde (version, mode mock)                                                                                |

Erreurs normalisées `{ error, message, assessment? }` — les 409 de
restauration embarquent l'évaluation complète (suggestions incluses). Toute
mutation exige l'en-tête `X-Supaboss-Csrf`, connexion et déconnexion
comprises (403 `csrf` sinon). Codes propres aux évolutions :
`totp-expired`, `bad-totp`, `bad-password`, `totp-enabled`,
`totp-not-enrolled`, `totp-not-enabled`, `schedule-in-past`,
`too-many-schedules`, `schedule-not-found`, `internal-destination` (webhook
ou abonnement push visant le réseau interne du serveur).

## 7. Sécurité

- **PAT Supabase** : saisis une fois, envoyés au serveur, chiffrés
  **AES-256-GCM** (clé maître env `SUPABOSS_MASTER_KEY` ou fichier
  `data/master.key` généré, mode 600). Jamais renvoyés au client (hint
  `sbp_…a1b2`), jamais loggés (redaction pino), jamais stockés navigateur.
- **Sessions** : token opaque 256 bits, stocké **hashé** (SHA-256), cookie
  `httpOnly` + `SameSite=Strict` (+ `Secure` derrière HTTPS) ; mots de passe
  **scrypt** + comparaison temps constant ; login rate-limité + audité.
- **Double authentification** (optionnelle, par utilisateur) : secret TOTP de
  160 bits **scellé AES-256-GCM** comme les PAT ; activation seulement après
  un premier code valide ; dix codes de secours à usage unique donnés une fois
  et stockés **hachés (scrypt)** ; anti-rejeu par dernier pas accepté
  (atomique) ; jeton d'étape haché, 5 min, 5 essais ; vérifications
  rate-limitées ; désactivation = mot de passe + code.
- **Notifications** : clés VAPID et URL de webhook (souvent porteuse d'un
  secret Slack/Discord) scellées par la clé maître, l'URL n'étant plus
  rendue qu'en indice ; contenu push chiffré de bout en bout (RFC 8291) ;
  webhook https seulement, sans redirection vers une autre origine.
- **Anti-SSRF** : le serveur appelle des URL fournies par les utilisateurs
  (webhook, point de terminaison push). Leur hôte est résolu avant CHAQUE
  saut, redirections comprises, et la requête ne part pas si une seule
  adresse est interne : boucle locale, non spécifiée, privée, CGNAT, lien
  local (dont les métadonnées du cloud en 169.254.169.254), IPv6 unique
  locale, multicast, réservée, ou IPv4 interne portée par une IPv6 (mappée,
  NAT64, 6to4) ; IP littérale comprise, sous toutes ses écritures. Refus dès
  l'enregistrement, puis à chaque envoi. `SUPABOSS_WEBHOOK_ALLOW_PRIVATE=1`
  la lève pour les webhooks seulement. **Limite** : entre notre résolution et
  celle de `fetch`, un DNS hostile à TTL nul peut changer de réponse
  (rebinding) — barrière de principe, pas garantie absolue ; en défense en
  profondeur, un pare-feu de sortie interdisant au conteneur le réseau
  interne.
- **CSRF** : SameSite=Strict **et** en-tête `X-Supaboss-Csrf` exigé sur toute
  mutation, connexion et déconnexion comprises.
- **RBAC** : `viewer` (lecture) ⊂ `operator` (pause/restore, tags) ⊂ `admin`
  (comptes, utilisateurs, export/import). Appliqué serveur, reflété UI.
- **Headers** : CSP stricte (`connect-src 'self'`), nosniff, frame DENY,
  no-referrer, HSTS (si HTTPS), `Cache-Control: no-store` sur `/api`.
- **Audit** : table `operations` — qui, quoi, quand, sur quel projet, avec
  quel résultat (y compris tentatives de connexion échouées, codes TOTP
  refusés, exécutions de planning — acteur `planning:<créateur>` — et statut
  de livraison de chaque alerte).
- **Hors ligne** : seul un snapshot **non sensible** (statuts, quotas) vit en
  IndexedDB ; purgeable depuis Réglages.

## 8. Écrans

1. **Dashboard** — slots actifs x/2 par compte, prêts à démarrer, alertes
   quotas, dernière synchro.
2. **Comptes** — ajout (test avant enregistrement), test, activer/désactiver,
   suppression confirmée.
3. **Projets** — consolidé, recherche, filtres par statut/favoris, tri,
   regroupé par compte.
4. **Détail projet** — statut, dates observées, fenêtre de restauration,
   pause/démo, tags/favori/démo fréquente, **plannings** (liste, prochaine
   exécution, dernière issue, ajout/suppression), jauges quotas.
5. **Préparer la démo** — 5 étapes guidées avec suggestions de pause.
6. **Quotas** — synthèse globale → par compte → par projet, rafraîchissement
   manuel, date de synchro.
7. **Historique** — journal d'audit complet.
8. **Réglages** — thème, seuils, **notifications** (Web Push de l'appareil,
   webhook, test, dernière remise), polling, **double authentification**
   (QR code du socle + clé en clair, codes de secours), export/import
   chiffré, stockage local, à-propos + famille d'apps.
9. **Hors ligne** — dernier état connu ou écran de reconnexion.
10. **Onboarding** — guide du premier compte (+ écran de connexion en mode
    réel, avec la seconde étape TOTP — composant `MfaChallenge` du socle).

## 9. Lancement local

Prérequis : **Node ≥ 22.18** (`node:sqlite` + type stripping), accès GitHub
Packages pour `@mister-guiiug/dev-pwa-config` :

```bash
export NODE_AUTH_TOKEN="$(gh auth token)"   # PAT read:packages
npm install
```

| Mode                                 | Commandes                                                         |
| ------------------------------------ | ----------------------------------------------------------------- |
| **Démo sans backend** (fixtures)     | `npm run dev:mock` → http://localhost:5173                        |
| **Full-stack mock** (serveur simulé) | `SUPABOSS_MOCK=1 npm run dev:server` + `npm run dev` (proxy /api) |
| **Full-stack réel**                  | `cp .env.example .env` puis `npm run dev:server` + `npm run dev`  |
| **Production locale**                | `npm run build && npm start` → http://localhost:8787              |

Au premier démarrage serveur : l'admin (`SUPABOSS_ADMIN_EMAIL`, défaut
`admin@local`) est créé et son mot de passe **affiché une seule fois** en
console (ou fixé par `SUPABOSS_ADMIN_PASSWORD`). Les clés VAPID du Web Push
sont engendrées au même moment, scellées en base : rien à créer à la main.

Variables d'environnement du serveur (toutes dans `.env.example`) :

| Variable                         | Défaut             | Rôle                                                                                                  |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `SUPABOSS_PORT` / `_HOST`        | `8787` / 127.0.0.1 | Écoute                                                                                                |
| `SUPABOSS_DATA_DIR`              | `./data`           | SQLite + clé maître générée                                                                           |
| `SUPABOSS_MASTER_KEY`            | générée            | Clé AES-256-GCM (PAT, secrets TOTP, VAPID, webhooks)                                                  |
| `SUPABOSS_ADMIN_EMAIL`           | `admin@local`      | Admin créé au premier démarrage                                                                       |
| `SUPABOSS_ADMIN_PASSWORD`        | affiché une fois   | Son mot de passe                                                                                      |
| `SUPABOSS_MOCK`                  | —                  | `1` : fournisseur simulé, aucun appel sortant vers Supabase                                           |
| `SUPABOSS_SECURE_COOKIES`        | —                  | `1` derrière HTTPS                                                                                    |
| `SUPABOSS_API_BUDGET_PER_MIN`    | `50`               | Budget Management API par compte                                                                      |
| `SUPABOSS_SYNC_INTERVAL_MIN`     | `15`               | Synchro de fond (statuts) et alertes ; `0` la coupe                                                   |
| `SUPABOSS_SYNC_METRICS`          | —                  | `1` : la synchro de fond collecte aussi les quotas (cf. §3, point 10)                                 |
| `SUPABOSS_VAPID_SUBJECT`         | `mailto:<admin>`   | Contact VAPID transmis aux services push (`mailto:` ou `https:`)                                      |
| `SUPABOSS_TOTP_RESET`            | —                  | E-mail dont la 2FA est retirée au démarrage (secours, puis retirer)                                   |
| `SUPABOSS_WEBHOOK_ALLOW_PRIVATE` | —                  | `1` : webhooks vers le réseau interne permis (ntfy du réseau local) — lève la garde anti-SSRF, cf. §7 |

Qualité :

```bash
npm run test            # Vitest (domaine + serveur + UI) — 388 tests
npm run test:e2e        # Playwright @critical (mode mock, port 5204)
npm run lint && npm run type-check && npm run format:check
```

## 10. Déploiement

- **GitHub Pages (démo mock)** : workflow `deploy.yml` (reusable
  `pwa-deploy.yml@v1`, `VITE_MOCK=1`). Activer Pages :
  `gh api -X POST repos/mister-guiiug/miss-supaboss/pages -f build_type=workflow`.
- **Docker (mode réel, homelab ou cloud)** :

```bash
docker build --build-arg NODE_AUTH_TOKEN=$NODE_AUTH_TOKEN -t miss-supaboss .
docker run -d --name supaboss -p 8787:8787 \
  -v supaboss-data:/data \
  -e SUPABOSS_MASTER_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" \
  -e SUPABOSS_ADMIN_PASSWORD='un-mot-de-passe-solide' \
  -e SUPABOSS_SECURE_COOKIES=1 \
  miss-supaboss
```

Placez un reverse proxy TLS devant (Caddy/Traefik/nginx) —
`SUPABOSS_SECURE_COOKIES=1` exige HTTPS, et le Web Push aussi (un navigateur
ne s'abonne qu'en HTTPS, sauf `localhost`). Le serveur doit pouvoir joindre
les services push (FCM, Mozilla, Apple, WNS) et les URL de webhook en HTTPS
sortant.

## 11. Tests livrés

- `shared/*` — statuts, niveaux de quota, agrégats, garde-fou 2-actifs,
  suggestions de pause, fenêtre 90 j, formatage (`31 MB / 5 GB`, `50k`).
- `server/test/crypto` — AES-GCM round-trip/altération, scrypt, sessions,
  export par passphrase.
- `server/test/db` — observations actif↔pause (aucune date inventée), audit,
  cache métriques.
- `server/test/api` — intégration HTTP complète : login/RBAC/CSRF, création
  de compte (PAT testé, jamais renvoyé), **restore bloqué à 2 actifs avec
  suggestions puis accepté via `pauseFirst`**, métriques (egress
  `unavailable`), export→import, réglages.
- `server/test/totp*` — vecteurs RFC 4226 / 6238 / 4648 ; par
  `fastify.inject` : enrôlement, connexion en deux temps (aucune session sur
  mot de passe seul), **rejeu refusé**, codes de secours à usage unique,
  étape expirée / brûlée, limitation de débit, désactivation, secours au
  démarrage.
- `server/test/schedules` — routes (RBAC, validation, fuseaux), exécution par
  les garde-fous (**restauration planifiée refusée à 2 actifs**), passes
  concurrentes (réservation conditionnelle), échéance manquée, redémarrage
  pendant une exécution, migration v1 → v2, tâche de fond.
- `server/test/webpush` — **vecteur de l'annexe A de la RFC 8291 à l'octet
  près**, déchiffrement par un « navigateur » de test indépendant, JWT VAPID
  vérifié avec la clé publique.
- `server/test/notifications` · `alerts` — canaux, test, 404/410, panne d'un
  canal, redirections du webhook ; franchissements à la hausse une fois par
  niveau et par mois, J-7 / J-1, de bout en bout par les routes de synchro.
- `server/test/ssrf` — chaque plage interne en IP littérale (y compris
  écritures décimale, hexadécimale, octale et IPv4 mappée), nom qui résout
  vers le privé (DNS simulé), rebinding entre deux sauts, refus à
  l'enregistrement (webhook et push), levée par
  `SUPABOSS_WEBHOOK_ALLOW_PRIVATE` (webhook seulement).
- `server/test/csrf` — l'en-tête exigé sur connexion, déconnexion,
  utilisateurs et réglages.
- `src/**` — QuotaBar (mesuré/indisponible/critique/estimation), StatusBadge,
  mockApi (mêmes garde-fous que le serveur, persistance locale, plannings et
  notifications de la démo), connexion TOTP, Réglages (2FA avec le vrai
  module `qr`, push avec le vrai client du socle), plannings de l'écran projet.
- `e2e/critical.spec.ts` — dashboard, workflow démo, filtres, quotas.

## 12. Évolutions envisagées

- Notifications par e-mail (demande un serveur SMTP) ; alertes de quota en
  fond sans collecte SQL, le jour où Supabase dira si elle compte comme de
  l'activité.
- Egress réel le jour où un endpoint public existe (l'interface
  `SupabaseProvider` est prête) ; lecture de
  `GET /v1/projects/{ref}/restore` (versions de restauration) pour fiabiliser
  la fenêtre — et donc les alertes J-7 / J-1.
- Keep-alive anti-pause opt-in par projet (le reusable
  `pwa-supabase-keepalive.yml` de dev-pwa-config existe déjà).
- Métriques historisées + sparklines, branchement du health par service
  (`GET /v1/projects/{ref}/health`).

---

Licence MIT — famille [`miss-*` / `mister-*`](https://github.com/mister-guiiug).
☕ [Soutenir](https://buymeacoffee.com/mister.guiiug).
