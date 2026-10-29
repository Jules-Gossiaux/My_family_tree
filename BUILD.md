# Plan de construction

Ce document détaille les passes 0 et 1, et suit l'avancement. La vision et le modèle de données
sont dans [`SPEC.md`](SPEC.md).

## Principe

On ne construit pas écran par écran en finition. On traverse d'abord toutes les couches avec une
version minuscule mais complète (« balle traçante »), puis on épaissit.

| Passe | Contenu | État |
|---|---|---|
| 0 | Socle : base, ajout de personnes, arbre minimal, fiche minimale | en cours |
| 1 | Saisie rapide, dates floues, couples, demi-frères | en cours |
| 2 | Sauvegarde automatique en ZIP daté | à faire |
| 3 | Arbre de descendance abouti, branches colorées | à faire |
| 4 | Médias : import, vignettes, bac d'entrée, recadrage portrait | à faire |
| 5 | Fiche complète : dossier de vie, chronologie, notes | à faire |
| 6 | Poster PDF, deux modèles, avec portraits | à faire |
| 7 | Parenté, questions ouvertes, recherche, filtres | à faire |

## Architecture

```
server/          API HTTP + accès SQLite
  config.ts      résolution du dossier de données
  db.ts          ouverture de la base, application du schéma
  dates.ts       analyse des dates floues
  relations.ts   rattachement d'une personne à une autre, avec ses refus
  index.ts       routes
  schema.sql     schéma complet
shared/          types partagés serveur / client
src/             interface React
  treeLayout.ts  calcul de position des cases
  TreeCanvas.tsx rendu SVG, zoom et déplacement
  PersonSheet.tsx fiche latérale
  AddPersonDialog.tsx saisie rapide
  AttachDialog.tsx choix d'une personne déjà existante à rattacher
tests/           tests du parseur de dates et des relations (`npm test`)
```

Le serveur sert l'API et, en production, le front compilé par Vite. Un seul processus, un seul port.

## Décisions techniques

| Sujet | Choix | Raison |
|---|---|---|
| Base | SQLite via `better-sqlite3` | un fichier, sauvegarde triviale, synchrone donc simple |
| Rendu de l'arbre | SVG + React | net à l'impression, suffisant à 800 personnes |
| Mise en page | placement post-ordre, parents centrés sur leurs enfants | simple, sans dépendance |
| Identifiants | UUID v4 | pas de collision lors d'une future fusion de bases |
| Dates | jamais un champ `DATE`, toujours min/max/qualifier/texte | la généalogie vit dans l'approximation |
| Table des couples | nommée `couple` et non `union` | `UNION` est un mot réservé SQL |
| Unions | jamais créées sans qu'on les déclare | un enfant rattaché à un parent seul n'implique pas l'existence d'un second parent |
| Refus d'écriture | message en français compréhensible, code HTTP 400/404/409 | la personne doit savoir quoi faire sans lire une pile d'appels |

## Lancement

`start.bat` est le seul écran d'entrée pour l'utilisateur. Il doit donc se réparer lui-même :

- Le moteur SQLite est un **binaire compilé pour la version de Node installée**. Une mise à jour de
  Node rend le module chargeable : `start.bat` le détecte (`node -e "require('better-sqlite3')"`) et
  relance `npm rebuild better-sqlite3` avant de démarrer. Sans ce test, le double-clic n'affiche
  qu'une erreur technique illisible. `package.json` déclare `engines: node >= 20`.
- Si le module casse quand même, `server/db.ts` affiche la commande à taper au lieu d'une pile
  d'appels.
- Le **navigateur est ouvert par le serveur**, une fois l'écoute réellement établie (`OPEN_BROWSER=1`
  posé par `start.bat`) : ouvrir la page trop tôt afficherait une erreur de connexion.
- Un port déjà pris (double démarrage) donne un message en français et un code de sortie non nul,
  que `start.bat` traduit par une fenêtre qui reste lisible au lieu de se refermer.

## Contrat d'API (passes 0 et 1)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/state` | dossier de données, statistiques, personne racine |
| GET | `/api/graph` | personnes, couples, liens parent-enfant, en une requête |
| GET | `/api/persons/:id` | fiche complète : relations et événements |
| POST | `/api/persons` | création, avec rattachement optionnel |
| POST | `/api/persons/:id/relations` | rattacher deux personnes déjà dans la base |
| PATCH | `/api/persons/:id` | modification |
| DELETE | `/api/persons/:id` | suppression |
| PUT | `/api/config` | personne racine de l'arbre |

Le rattachement à la création prend la forme :

```json
{ "givenNames": "Marie", "familyName": "Dubois",
  "relation": { "type": "child", "ofPersonId": "…", "otherParentId": "…" } }
```

`type` vaut `child`, `parent` ou `partner`. C'est ce qui permet d'enchaîner la saisie sans
repasser par un écran vide : on ajoute toujours quelqu'un **par rapport à quelqu'un**.

## Rattacher des personnes qui existent déjà

La même structure s'envoie seule à `POST /api/persons/:id/relations`, où `:id` est la personne
soumise. Depuis l'interface : bouton « Rattacher… » de la fiche, ou menu contextuel d'une case.

Le corps de la règle tient en trois phrases, et il est écrit une seule fois dans
`server/relations.ts` — les deux routes passent par là :

- **Une union n'existe que si on la déclare.** Rattacher un enfant à un parent ne crée jamais de
  conjoint par défaut. Le second parent n'est posé que par `otherParentId`, choisi explicitement
  dans la saisie (« Et l'autre parent est… », avec le choix assumé « Personne — on ne déclare pas
  d'union »).
- **Deux parents au plus.** Une troisième parenté est refusée : « Cette personne a déjà deux
  parents. Commencez par en remplacer un. »
- **Pas de boucle.** Devenir le parent de son propre ascendant est refusé en 409, avec le motif
  dans le message.

Un lien déjà existant n'est pas dupliqué. Surtout, déclarer l'union d'un couple rend cette union
aux enfants que la base connaît **déjà des deux** : leurs liens héritent du `couple_id` et les
enfants basculent sous la jonction du couple. Un enfant rattaché à un seul des deux n'est jamais
rangé dans l'union.

## Passe 0 — socle

- [x] projet, dépendances, configuration
- [x] schéma SQLite complet
- [x] API de lecture et d'écriture des personnes
- [x] arbre de descendance minimal avec zoom et déplacement
- [x] fiche latérale minimale
- [x] saisie rapide au clavier

## Passe 1 — saisie

- [x] dates floues analysées depuis un texte libre
- [x] couples, enfants, parents, conjoints
- [x] demi-frères (l'enfant sait de quelle union il est issu)
- [x] recherche instantanée dans l'en-tête
- [x] modification d'une personne existante depuis la fiche
- [x] branches non rattachées visibles dans l'arbre
- [x] rattachement de deux personnes déjà existantes, sans union inventée
- [x] une case par personne, conjoints dessinés de part et d'autre
- [ ] suppression avec confirmation

## Limites connues

À traiter en passe 3 :

- **Deux parents solos et l'enfant pend des deux blocs.** Luc fils de Paul sans union déclarée, et
  aussi fils de Marie sans union déclarée, est dessiné **une seule fois** mais rattaché aux deux
  cases : la mise en page ne peut le placer que sous l'un des deux, et le second lien traverse
  l'arbre à l'horizontale. Déclarer l'union de Paul et Marie (« Rattacher… » → conjoint, ou
  « Et l'autre parent est… » pendant la saisie) ramène l'enfant sous la jonction du couple et
  supprime le trait qui traverse.
- **Pas de gestion visuelle des cycles.** Un mariage entre cousins est ignoré au-delà du premier
  passage, sans signalement. Une écriture qui créerait une boucle est refusée, mais un cycle déjà
  présent dans la base n'est pas signalé à l'écran.
- **Aucune photo, aucun document** : c'est la passe 4.

Résolu : une personne ayant plusieurs unions n'apparaît plus qu'une seule fois, ses conjoints étant
dessinés dans le même bloc `[conjoint] [personne] [conjoint]`.

## Conventions

- Interface et code en français pour les libellés, anglais pour les noms de variables et de tables
  (cohérence avec l'écosystème, lisibilité pour un futur contributeur).
- Aucune donnée familiale dans le dépôt. Le dossier de données est hors du projet.
