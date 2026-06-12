# Proxy CORS — Supabase Management API

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

## Garde-fous

- **Cible verrouillée** sur `https://api.supabase.com` (aucun autre hôte).
- **Liste blanche** de chemins + méthodes (`index.ts` → `ALLOWED`) :
  `GET /v1/organizations`, `GET /v1/projects`,
  `POST /v1/projects/{ref}/pause|restore|database/query/read-only`.
- **CORS restreint** aux origines de `ALLOWED_ORIGINS` (sinon `403`).
- `Authorization` obligatoire (`401` sinon).

Le chemin cible est passé en paramètre de requête `?path=/v1/...` (agnostique au
point de montage). Le client est `src/api/management/browserClient.ts`.

## Déploiement (Supabase Edge Function)

```bash
# Depuis la racine du dépôt, projet Supabase lié (supabase link) :
supabase functions deploy supabase-management --no-verify-jwt
supabase secrets set ALLOWED_ORIGINS="https://<user>.github.io,http://localhost:5204"
```

`--no-verify-jwt` : la fonction n'utilise pas l'auth Supabase (l'autorisation,
c'est le PAT relayé). L'URL obtenue ressemble à
`https://<ref>.functions.supabase.co/supabase-management`.

## Câblage côté PWA

Renseigner la variable de build (front) **sur le build Pages uniquement** :

```
VITE_SUPABASE_PROXY=https://<ref>.functions.supabase.co/supabase-management
```

En présence de cette variable, le réglage « Mode démo » de la PWA peut être
désactivé pour passer en **mode réel local-first** (saisie d'un PAT → vraies
organisations + statuts de projets). Sans elle, la PWA reste en démo.

## Variante Cloudflare Worker

`handleProxy` n'utilise que des standards Web. Pour un Worker :

```ts
import { handleProxy, parseOrigins } from './index.ts';
export default {
  fetch: (req: Request, env: { ALLOWED_ORIGINS?: string }) =>
    handleProxy(req, parseOrigins(env.ALLOWED_ORIGINS)),
};
```

## Sécurité — note

Le proxy n'impose pas d'authentification propre : quiconque connaît son URL peut
l'utiliser pour appeler la Management API **avec son propre PAT** (pas le tien —
le PAT n'est jamais stocké ici). Le risque se limite donc à la consommation de
compute de la fonction. Restreindre `ALLOWED_ORIGINS` à tes origines et, au
besoin, ajouter une limite de débit côté plateforme.
