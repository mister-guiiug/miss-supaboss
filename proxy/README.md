# Proxy CORS — Supabase Management API (Cloudflare Worker)

Relais **minimal et sans état** permettant à la PWA Miss Supaboss (GitHub Pages,
sans backend) d'interroger la Supabase Management API depuis le navigateur.

## Pourquoi

`https://api.supabase.com` n'autorise le CORS navigateur **que depuis
`https://supabase.com`** (vérifié : toute autre origine reçoit
`Access-Control-Allow-Origin: null`). Une PWA local-first ne peut donc pas
appeler la Management API directement. Ce proxy ajoute l'en-tête CORS pour
l'origine de la PWA et transmet l'appel à Supabase.

Le PAT de l'utilisateur transite dans l'en-tête `Authorization` mais n'est **ni
lu ni stocké** par le proxy (relais aveugle). Il reste par ailleurs stocké en
local sur l'appareil de l'utilisateur (localStorage), jamais côté serveur.

## Garde-fous (`handler.ts`)

- **Cible verrouillée** sur `https://api.supabase.com` (aucun autre hôte).
- **Liste blanche** de chemins + méthodes : `GET /v1/organizations`,
  `GET /v1/projects`, `POST /v1/projects/{ref}/pause|restore|database/query/read-only`.
- **CORS restreint** aux origines de `ALLOWED_ORIGINS` (sinon `403`).
- `Authorization` obligatoire (`401` sinon).

Le chemin cible est passé en paramètre `?path=/v1/...` (agnostique au montage).
Le client est `src/api/management/browserClient.ts`.

## Déploiement

```bash
# Depuis ce dossier (proxy/). Wrangler : npm i -g wrangler  (ou npx wrangler …)
wrangler login
# Ajuster ALLOWED_ORIGINS dans wrangler.toml [vars] à TON origine Pages, puis :
wrangler deploy
```

L'URL obtenue ressemble à
`https://supaboss-management-proxy.<ton-sous-domaine>.workers.dev`.

> `ALLOWED_ORIGINS` n'est pas secret → il vit dans `wrangler.toml`. Pour le
> changer sans redéployer le code : `wrangler deploy` après édition, ou définir
> la variable dans le dashboard Cloudflare (Workers → Settings → Variables).

## Câblage côté PWA

Renseigner la variable de build (front) **sur le build Pages** :

```
VITE_SUPABASE_PROXY=https://supaboss-management-proxy.<ton-sous-domaine>.workers.dev
```

En présence de cette variable, le réglage « Mode démo » de la PWA peut être
désactivé pour passer en **mode réel local-first** (saisie d'un PAT → vraies
organisations + statuts de projets). Sans elle, la PWA reste en démo.

## Portabilité

`handleProxy` (dans `handler.ts`) n'utilise que des standards Web. Pour un autre
hôte, il suffit d'une autre entrée :

- **Deno Deploy / Supabase Edge Function** :
  `Deno.serve((req) => handleProxy(req, parseOrigins(Deno.env.get('ALLOWED_ORIGINS'))))`
- **Vercel / Netlify Edge** :
  `export default (req) => handleProxy(req, parseOrigins(process.env.ALLOWED_ORIGINS))`

## Sécurité — note

Le proxy n'impose pas d'authentification propre : quiconque connaît son URL peut
l'utiliser pour appeler la Management API **avec son propre PAT** (pas le tien —
le PAT n'est jamais stocké ici). Le risque se limite à la consommation de
compute du Worker. Restreindre `ALLOWED_ORIGINS` et, au besoin, ajouter une
limite de débit (Cloudflare Rate Limiting).
