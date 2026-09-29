## Pour qui

Les développeurs et les petites équipes qui jonglent avec plusieurs comptes Supabase gratuits, pour des prototypes ou des démonstrations, pas pour des projets critiques.

## Comment ça marche

Vous ajoutez chaque compte avec un nom et un jeton d'accès personnel Supabase. L'application liste alors tous les projets et leur statut, compte les projets actifs de chaque compte (deux au plus sur l'offre gratuite), met un projet en pause ou le restaure après confirmation, et suit les quotas projet par projet. La version publiée s'ouvre sur des données d'exemple.

## Vos données

Sur la version publiée, aucun compte n'est à créer : le jeton reste dans ce navigateur, en clair sauf si vous le chiffrez par une phrase secrète. Chaque appel passe par le relais de l'application, qui le transmet à l'API de Supabase sans le lire ni le garder. En version auto-hébergée, un serveur Node que vous lancez vous-même garde les jetons chiffrés, derrière une connexion. Sentry (région européenne) signale les erreurs dès l'ouverture, sans demande de consentement ; PostHog (nuage européen) ne mesure l'audience qu'après votre accord.

## Prix

Gratuit et open source, sous licence MIT. Les limites de l'offre gratuite de Supabase restent celles de Supabase.
