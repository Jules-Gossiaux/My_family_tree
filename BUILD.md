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
  index.ts       routes
  schema.sql     schéma complet
shared/          types partagés serveur / client
src/             interface React
  treeLayout.ts  calcul de position des cases
  TreeCanvas.tsx rendu SVG, zoom et déplacement
  PersonSheet.tsx fiche latérale
  AddPersonDialog.tsx saisie rapide
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

## Contrat d'API (passes 0 et 1)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/state` | dossier de données, statistiques, personne racine |
| GET | `/api/graph` | personnes, couples, liens parent-enfant, en une requête |
| GET | `/api/persons/:id` | fiche complète : relations et événements |
| POST | `/api/persons` | création, avec rattachement optionnel |
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
- [ ] suppression avec confirmation

## Limites connues de la passe 0

Ces points sont assumés pour l'instant, et traités en passe 3 :

- **Une personne à plusieurs unions apparaît plusieurs fois.** Jean marié deux fois est dessiné
  deux fois, une fois par couple. La correction consiste à faire de l'union une case à part entière,
  avec la personne au centre et ses conjoints de part et d'autre.
- **Pas de gestion visuelle des cycles.** Un mariage entre cousins est ignoré au-delà du premier
  passage, sans signalement.
- **Aucune photo, aucun document** : c'est la passe 4.

## Conventions

- Interface et code en français pour les libellés, anglais pour les noms de variables et de tables
  (cohérence avec l'écosystème, lisibilité pour un futur contributeur).
- Aucune donnée familiale dans le dépôt. Le dossier de données est hors du projet.
