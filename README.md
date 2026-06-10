# Miss Supaboss

PWA mobile-first de **pilotage multi-comptes Supabase Free** : inventaire
consolidé des projets, **pause / restauration à la demande** (limite de 2
projets actifs par compte gérée par garde-fous), **suivi des quotas Free
Plan** (Egress, Database size, MAU, File storage) et **workflow guidé de
préparation de démo**. Pensée pour les POC et démonstrateurs — pas pour des
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
│  · auth sessions + RBAC (admin / operator / viewer)               │
│  · garde-fous partagés (shared/) + audit log                      │
│  · SQLite (node:sqlite) : users, comptes (PAT AES-256-GCM),       │
│    méta projets, opérations, cache métriques                      │
│  · SupabaseProvider ──► ManagementApiProvider │ MockProvider      │
│        └ ResilientClient : timeout, retry+backoff+jitter,         │
│          Retry-After, circuit breaker, budget 50 req/min/compte   │
└────────────────┬──────────────────────────────────────────────────┘
                 │ Bearer PAT (jamais côté client)
        https://api.supabase.com  (Management API v1, endpoints documentés)
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
   Sur le build Pages (`VITE_MOCK=1`), le mock est forcé (pas de backend).

## 4. Structure des dossiers

```
miss-supaboss/
├── shared/                  # Domaine partagé front ↔ serveur (pur, testé)
│   ├── status.ts            #  statuts Management API + groupes UI
│   ├── quotas.ts            #  quotas Free Plan, MetricValue, seuils
│   ├── guards.ts            #  limite 2 actifs, suggestions, fenêtre 90 j
│   ├── contracts.ts         #  contrat d'API (schémas zod, DTO)
│   └── format.ts            #  octets/compteurs/pourcents/dates FR
├── server/
│   ├── tsconfig.json        #  erasableSyntaxOnly (type stripping Node)
│   ├── src/
│   │   ├── index.ts         #  bootstrap (clé maître, admin, listen)
│   │   ├── app.ts           #  Fastify : sécurité, erreurs, routes, statique
│   │   ├── env.ts           #  env validé zod
│   │   ├── crypto.ts        #  AES-256-GCM, scrypt, sessions, export
│   │   ├── db.ts            #  SQLite node:sqlite (Store) + observations
│   │   ├── auth.ts          #  cookie session + RBAC + CSRF
│   │   ├── fleet.ts         #  service : synchro, pause/restore, métriques
│   │   ├── routes/          #  auth, accounts, projects, system
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

## 6. API du serveur

| Méthode         | Route                                        | Rôle min. | Description                                  |
| --------------- | -------------------------------------------- | --------- | -------------------------------------------- |
| POST            | `/api/auth/login` (rate-limit 10/min)        | —         | Session cookie httpOnly                      |
| POST            | `/api/auth/logout` · GET `/api/auth/me`      | viewer    |                                              |
| GET/POST/DELETE | `/api/auth/users[/:id]`                      | admin     | RBAC interne                                 |
| GET             | `/api/accounts`                              | viewer    | Comptes (PAT jamais renvoyé, juste un hint)  |
| POST            | `/api/accounts`                              | admin     | Test de connectivité PUIS enregistrement     |
| PATCH/DELETE    | `/api/accounts/:id`                          | admin     |                                              |
| POST            | `/api/accounts/:id/test`                     | operator  | Connectivité + compte d'orgs/projets         |
| POST            | `/api/accounts/export` · `/import`           | admin     | Blob AES-256-GCM dérivé d'une passphrase     |
| GET             | `/api/fleet[?refresh=1]`                     | viewer    | Inventaire consolidé                         |
| GET             | `/api/fleet/metrics[?refresh=1]`             | viewer    | Quotas Free Plan                             |
| GET             | `/api/projects/:acc/:ref[?refresh=1]`        | viewer    | Détail                                       |
| GET             | `/api/projects/:acc/:ref/restore-assessment` | viewer    | Garde-fou sans exécution                     |
| PUT             | `/api/projects/:acc/:ref/meta`               | operator  | Tags, favori, démo fréquente, notes          |
| POST            | `/api/projects/:acc/:ref/pause` · `/restore` | operator  | Actions (CSRF requis) — 202 / 409+assessment |
| GET             | `/api/operations?limit&accountId&ref`        | viewer    | Historique / audit                           |
| GET/PUT         | `/api/me/settings`                           | viewer    | Seuils, polling, fenêtre de restauration     |
| GET             | `/api/system/health`                         | public    | Sonde (version, mode mock)                   |

Erreurs normalisées `{ error, message, assessment? }` — les 409 de
restauration embarquent l'évaluation complète (suggestions incluses).

## 7. Sécurité

- **PAT Supabase** : saisis une fois, envoyés au serveur, chiffrés
  **AES-256-GCM** (clé maître env `SUPABOSS_MASTER_KEY` ou fichier
  `data/master.key` généré, mode 600). Jamais renvoyés au client (hint
  `sbp_…a1b2`), jamais loggés (redaction pino), jamais stockés navigateur.
- **Sessions** : token opaque 256 bits, stocké **hashé** (SHA-256), cookie
  `httpOnly` + `SameSite=Strict` (+ `Secure` derrière HTTPS) ; mots de passe
  **scrypt** + comparaison temps constant ; login rate-limité + audité.
- **CSRF** : SameSite=Strict **et** en-tête `X-Supaboss-Csrf` exigé sur toute
  mutation.
- **RBAC** : `viewer` (lecture) ⊂ `operator` (pause/restore, tags) ⊂ `admin`
  (comptes, utilisateurs, export/import). Appliqué serveur, reflété UI.
- **Headers** : CSP stricte (`connect-src 'self'`), nosniff, frame DENY,
  no-referrer, HSTS (si HTTPS), `Cache-Control: no-store` sur `/api`.
- **Audit** : table `operations` — qui, quoi, quand, sur quel projet, avec
  quel résultat (y compris tentatives de connexion échouées).
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
   pause/démo, tags/favori/démo fréquente, jauges quotas.
5. **Préparer la démo** — 5 étapes guidées avec suggestions de pause.
6. **Quotas** — synthèse globale → par compte → par projet, rafraîchissement
   manuel, date de synchro.
7. **Historique** — journal d'audit complet.
8. **Réglages** — thème, seuils, polling, export/import chiffré, stockage
   local, à-propos + famille d'apps.
9. **Hors ligne** — dernier état connu ou écran de reconnexion.
10. **Onboarding** — guide du premier compte (+ écran de connexion en mode
    réel).

## 9. Lancement local

Prérequis : **Node ≥ 22.18** (`node:sqlite` + type stripping), accès GitHub
Packages pour `@mister-guiiug/dev-wpa-config` :

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
console (ou fixé par `SUPABOSS_ADMIN_PASSWORD`).

Qualité :

```bash
npm run test            # Vitest (domaine + serveur + UI) — 65 tests
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
`SUPABOSS_SECURE_COOKIES=1` exige HTTPS.

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
- `src/**` — QuotaBar (mesuré/indisponible/critique/estimation), StatusBadge,
  mockApi (mêmes garde-fous que le serveur, persistance locale).
- `e2e/critical.spec.ts` — dashboard, workflow démo, filtres, quotas.

## 12. Évolutions envisagées

- Notifications (Web Push / e-mail) sur franchissement de seuil ou fin de
  restauration ; évaluation de seuils côté serveur (cron).
- Egress réel le jour où un endpoint public existe (l'interface
  `SupabaseProvider` est prête) ; lecture de
  `GET /v1/projects/{ref}/restore` (versions de restauration) pour fiabiliser
  la fenêtre.
- Keep-alive anti-pause opt-in par projet (le reusable
  `pwa-supabase-keepalive.yml` de dev-wpa-config existe déjà).
- Planification (« mettre en pause vendredi soir »), TOTP sur le login,
  métriques historisées + sparklines, branchement du health par service
  (`GET /v1/projects/{ref}/health`).

---

Licence MIT — famille [`miss-*` / `mister-*`](https://github.com/mister-guiiug).
☕ [Soutenir](https://buymeacoffee.com/mister.guiiug).
