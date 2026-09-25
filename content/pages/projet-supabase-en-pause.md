---
title: Projet Supabase en pause : le restaurer et gérer l'offre gratuite
description: Projet Supabase gratuit mis en pause ? Pourquoi cela arrive, comment le restaurer, la limite de deux projets actifs, et une app pour suivre plusieurs comptes.
---

# Projet Supabase en pause : comprendre, restaurer, s'organiser

Votre application ne répond plus, et le tableau de bord de Supabase affiche le projet « en pause » ? Sur l'offre gratuite, c'est un fonctionnement prévu. Voici pourquoi, comment remettre le projet en route, et comment garder la main sur plusieurs comptes.

## Pourquoi un projet gratuit se met en pause

Deux règles de l'offre gratuite (Free) expliquent presque tout :

- **L'inactivité.** La [page de tarifs de Supabase](https://supabase.com/pricing) indique qu'un projet gratuit est mis en pause après une semaine d'inactivité.
- **La limite de projets.** La [documentation de facturation](https://supabase.com/docs/guides/platform/billing-on-supabase) accorde deux projets gratuits. Cette limite vaut pour toutes les organisations dont vous êtes propriétaire ou administrateur. Un projet en pause ne compte pas dans cette limite.

Ces règles ont été relevées en septembre 2026. Elles peuvent changer : vérifiez-les sur le site de Supabase avant de prendre une décision importante.

## Ce que la pause change, et ce qu'elle ne change pas

Un projet en pause ne répond plus : l'application qui s'appuie dessus tombe. Vos données, elles, ne disparaissent pas tout de suite.

Selon la documentation de Supabase, un projet en pause se restaure d'un clic depuis le tableau de bord pendant une fenêtre de restauration, d'un an à la date de rédaction. Passé ce délai, il reste possible de télécharger la sauvegarde de la base et les fichiers de stockage, puis de les restaurer dans un nouveau projet. La même documentation précise qu'un projet gratuit restauré passe à la dernière version mineure disponible.

## Restaurer un projet en pause, étape par étape

1. Ouvrez le tableau de bord de Supabase et sélectionnez le projet en pause.
2. Comptez vos projets actifs. Si vous en avez déjà deux, mettez d'abord en pause celui dont vous avez le moins besoin.
3. Lancez la restauration depuis la page du projet. Comptez quelques minutes avant que tout réponde.
4. Testez votre application : connexion, lecture, écriture.
5. Gardez en tête qu'un projet de nouveau inactif repartira en pause après le même délai.

**Exemple.** Un compte porte trois projets : `api-demo` (actif, utilisé chaque jour), `poc-client` (actif, utilisé de temps en temps) et `vitrine` (en pause). Un rendez-vous demain demande `vitrine`. Vous êtes à 2 projets actifs sur 2 : mettez `poc-client` en pause, puis restaurez `vitrine`. Vous restez à deux projets actifs, et `api-demo` n'est jamais coupé.

## Plusieurs comptes : garder une vue d'ensemble

Entre prototypes et démonstrations, on gère souvent plusieurs comptes Supabase : le sien, celui d'une équipe, celui d'un client. Le tableau de bord n'en montre qu'un à la fois, et savoir ce qui tourne ou ce qu'on peut démarrer devient vite pénible. Dans tous les cas, respectez les conditions d'utilisation de Supabase.

## Comment Miss Supaboss vous aide

Miss Supaboss est une application web installable qui rassemble vos comptes Supabase gratuits sur un seul écran. Elle passe par l'API de gestion de Supabase (Management API), avec un jeton d'accès personnel par compte.

- **Une vue consolidée** : tous les projets de tous vos comptes, avec leur statut (actif, en pause, en cours, en erreur), une recherche, des filtres et des tris.
- **Un compteur de projets actifs** par compte (par exemple 2/2), et un parcours « Préparer la démo » en cinq étapes qui propose les projets à mettre en pause d'abord : vos favoris et vos « démos fréquentes » passent en dernier, les moins récemment actifs en premier.
- **La pause et la restauration** depuis l'application, après confirmation, avec un historique des opérations.
- **Les quotas de l'offre gratuite**, projet par projet : taille de la base, stockage de fichiers, utilisateurs actifs du mois (estimation), avec des seuils d'alerte réglables (70, 85 et 95 % par défaut). La bande passante sortante (egress) n'est pas exposée par l'API publique : l'application l'affiche comme indisponible.
- **La date de mise en pause**, quand l'application a vu le projet passer en pause, et une estimation de la fin de la fenêtre de restauration, dont vous réglez la durée dans les Réglages.
- **En version auto-hébergée** (un serveur lancé avec Docker) : des pauses et restaurations planifiées, par exemple chaque vendredi soir, et des alertes par notification Web Push ou par webhook.

## Pour commencer

La version publiée s'ouvre sur des données d'exemple : vous pouvez tout essayer sans rien connecter. Pour vos vrais comptes, désactivez le mode démo dans les Réglages, puis ajoutez chaque compte avec un nom parlant et son jeton d'accès personnel, créé depuis votre compte Supabase (rubrique Access Tokens).

Le jeton reste sur votre appareil. Il n'est transmis qu'au relais de l'application, en HTTPS, qui le fait suivre à l'API de Supabase. Vous pouvez le chiffrer par une phrase secrète, demandée à chaque ouverture. Un jeton d'accès personnel donne un large pouvoir sur votre compte : utilisez un appareil de confiance, et révoquez le jeton depuis Supabase au moindre doute.

Miss Supaboss est une application indépendante, ni affiliée à Supabase ni approuvée par Supabase. Supabase est une marque de son propriétaire.

## Questions fréquentes

### Au bout de combien de temps un projet Supabase gratuit est-il mis en pause ?

À la date de rédaction, la page de tarifs de Supabase indique une semaine d'inactivité. La règle peut évoluer : fiez-vous à la page en vigueur.

### Un projet en pause compte-t-il dans la limite de deux projets gratuits ?

Non. La documentation de Supabase précise que les projets en pause ne comptent pas dans cette limite. C'est pourquoi mettre en pause un projet peu utilisé permet d'en restaurer un autre.

### Mes données sont-elles perdues quand le projet est en pause ?

Pas immédiatement. Pendant la fenêtre de restauration, un clic suffit. Ensuite, Supabase propose de télécharger la sauvegarde et les fichiers pour les restaurer ailleurs. Ne comptez pas sur une conservation sans limite.

### Miss Supaboss empêche-t-elle la mise en pause ?

Non. Elle ne maintient pas vos projets en éveil. Elle vous montre ce qui est actif ou en pause, vous aide à restaurer le bon projet sans dépasser la limite et, en version auto-hébergée, planifie pauses et restaurations.
