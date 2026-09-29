---
title: Limites du plan gratuit Supabase : quotas, pause et dépassement
description: Plan gratuit Supabase : 500 Mo de base par projet, 1 Go de fichiers, 5 Go de sortie, 50 000 utilisateurs, deux projets actifs. Et ce qui se passe au-delà.
date: 2026-09-29
answer: Le plan gratuit de Supabase inclut 500 Mo de base de données par projet et, pour l'organisation, 1 Go de fichiers, 5 Go de sortie réseau et 50 000 utilisateurs actifs par mois. Un compte n'a droit qu'à deux projets gratuits actifs, mis en pause après une semaine d'inactivité, sans sauvegarde automatique.
---

# Limites du plan gratuit Supabase : ce que couvre l'offre Free

L'offre gratuite de Supabase suffit pour un prototype, une démonstration ou un petit projet personnel. Ses limites sont pourtant nettes, et certaines se découvrent au mauvais moment : une base qui passe en lecture seule, un projet en pause la veille d'une démo. Voici les chiffres, relevés le 29 septembre 2026 sur les pages officielles de Supabase, et ce qui se passe au-delà.

## Les quotas de l'offre gratuite

- **Base de données** : 500 Mo par projet, sur un processeur partagé avec 500 Mo de mémoire vive.
- **Stockage de fichiers** : 1 Go, avec 50 Mo au plus par fichier envoyé.
- **Sortie réseau (egress)** : 5 Go, plus 5 Go de sortie servie depuis le cache du CDN, comptés à part.
- **Utilisateurs actifs** : 50 000 par mois.
- **Fonctions Edge** : 500 000 appels.
- **Temps réel** : 200 connexions simultanées au pic, et 2 millions de messages par mois.
- **Journaux** : un jour de conservation pour ceux de l'API et de la base.
- **Requêtes d'API** : illimitées.

Sauf la taille de la base, fixée par projet, les quotas d'usage (sortie, fichiers, utilisateurs, fonctions, temps réel) s'appliquent à l'organisation entière. Deux projets d'une même organisation se partagent donc les 5 Go de sortie.

Un utilisateur actif compte une seule fois par cycle de facturation, quel que soit le nombre de ses connexions. La sortie réseau cumule tout ce qui part vers les clients : base, authentification, stockage, fonctions et temps réel.

## Deux projets actifs, et la pause au bout d'une semaine

Un compte a droit à deux projets gratuits, pour l'ensemble des organisations dont il est propriétaire ou administrateur. Un projet en pause ne compte pas.

Un projet gratuit qui reçoit trop peu de requêtes sur sa base pendant une semaine est mis en pause. Supabase prévient le propriétaire par e-mail environ une semaine avant. Selon sa documentation, quelques requêtes par jour suffisent en général à l'éviter. Un projet en pause se restaure depuis le tableau de bord pendant un an : la marche à suivre est détaillée dans [Projet Supabase en pause : comprendre, restaurer, s'organiser](projet-supabase-en-pause.html).

## Ce que l'offre gratuite n'inclut pas

- les sauvegardes automatiques, et la restauration à un instant précis (PITR) ;
- les branches de développement (Branching) ;
- les transformations d'images du stockage ;
- les domaines personnalisés ;
- le support par e-mail : seul le support de la communauté est inclus.

L'absence de sauvegarde est la limite qui coûte le plus cher le jour d'un incident. La documentation de Supabase recommande aux projets gratuits d'exporter régulièrement leurs données avec la commande `db dump` de sa CLI, et d'en garder une copie ailleurs.

## Ce qui se passe quand on dépasse

**La base au-delà de 500 Mo.** Le projet passe en lecture seule : plus d'insertion ni de suppression. C'est la taille des données Postgres qui compte, pas celle du disque : un projet gratuit dispose de 1 Go de disque, mais la lecture seule se déclenche à 500 Mo de données. Pour en sortir, il faut passer à l'offre Pro, ou lever la lecture seule le temps de réduire la base.

**Les autres quotas.** Supabase vous prévient quand l'organisation dépasse un quota. Si le dépassement dure, sa politique d'usage raisonnable (Fair Use) s'applique après une période de grâce. Elle peut mettre des projets en pause, passer des bases en lecture seule, bloquer la création de projets, ou répondre par une erreur 402 à toutes les requêtes d'API.

**Une subtilité sur la taille des bases.** À l'échelle de l'organisation, cette restriction se calcule sur la moyenne quotidienne de la taille des bases pendant la période de facturation. Réduire la base ne la lève donc pas tout de suite : il faut attendre que la moyenne baisse, ou le cycle suivant.

## Suivre sa consommation

La page d'usage de l'organisation, dans le tableau de bord, montre la consommation de tous les projets, ou d'un seul. Surveillez surtout la taille de la base, qui bloque les écritures, et la sortie réseau, qui grimpe vite avec des fichiers souvent téléchargés.

## Comment Miss Supaboss vous aide

[Miss Supaboss](https://mister-guiiug.github.io/miss-supaboss/) rassemble vos comptes Supabase gratuits sur un seul écran, avec un jeton d'accès personnel par compte.

- **Le compteur de projets actifs** de chaque compte (par exemple 2/2) : une restauration qui ferait un troisième projet actif est bloquée, et l'application propose les projets à mettre en pause d'abord.
- **Les quotas projet par projet** : taille de la base, stockage, utilisateurs actifs du mois (une estimation, tirée des connexions du mois). La sortie réseau n'est pas exposée par l'API publique : l'application l'affiche comme indisponible.
- **Des jauges avec des seuils réglables**, à 70, 85 et 95 % par défaut. En version auto-hébergée, un seuil franchi déclenche une alerte par Web Push ou par webhook.

La version publiée s'ouvre sur des données d'exemple : vous pouvez tout essayer sans rien connecter. Miss Supaboss est une application indépendante, ni affiliée à Supabase ni approuvée par Supabase.

## Questions fréquentes

### Combien de projets gratuits peut-on avoir sur Supabase ?

Deux projets actifs, pour l'ensemble des organisations dont vous êtes propriétaire ou administrateur. Les projets en pause ne comptent pas : on peut en garder davantage, à condition de n'en laisser que deux actifs.

### Que se passe-t-il si la base dépasse 500 Mo ?

Le projet passe en lecture seule. Il faut alors réduire la base, après avoir levé la lecture seule, ou passer à l'offre Pro, qui inclut 8 Go de disque par projet.

### Le plan gratuit de Supabase fait-il des sauvegardes ?

Non. Les sauvegardes quotidiennes commencent avec l'offre Pro, qui garde les sept derniers jours. Sur l'offre gratuite, Supabase recommande d'exporter régulièrement la base avec sa CLI.

### Les quotas sont-ils comptés par projet ou par organisation ?

Par organisation, sauf la taille de la base, limitée à 500 Mo par projet. Deux projets d'une même organisation partagent les mêmes 5 Go de sortie et les mêmes 50 000 utilisateurs actifs.

### Combien coûte l'offre au-dessus ?

L'offre Pro démarre à 25 dollars par mois, avec 8 Go de disque par projet, 250 Go de sortie, 100 Go de fichiers, 100 000 utilisateurs actifs et sept jours de sauvegardes. Ses projets ne sont jamais mis en pause.

## Sources

- [Tarifs de Supabase](https://supabase.com/pricing) : quotas des offres gratuite et Pro.
- [Facturation sur Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase) : quotas par organisation, deux projets gratuits.
- [Taille de la base](https://supabase.com/docs/guides/platform/database-size) : lecture seule à 500 Mo, restriction calculée sur la moyenne.
- [FAQ de facturation](https://supabase.com/docs/guides/platform/billing-faq) : dépassement, période de grâce, usage raisonnable.
- [Mise en pause des projets gratuits](https://supabase.com/docs/guides/platform/free-project-pausing) : inactivité, e-mail d'avertissement, restauration.
