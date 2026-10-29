# Plan de construction

Ce document détaille les passes 0, 1 et 2, et suit l'avancement. La vision et le modèle de données
sont dans [`SPEC.md`](SPEC.md).

## Principe

On ne construit pas écran par écran en finition. On traverse d'abord toutes les couches avec une
version minuscule mais complète (« balle traçante »), puis on épaissit.

| Passe | Contenu | État |
|---|---|---|
| 0 | Socle : base, ajout de personnes, arbre minimal, fiche minimale | en cours |
| 1 | Saisie rapide, dates floues, couples, demi-frères | en cours |
| 2 | Sauvegarde automatique en ZIP daté | en cours |
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
  migrations.ts  ajustements du schéma pour les bases déjà remplies
  notices.ts     ce que le serveur sait et doit afficher
  relations.ts   rattachement d'une personne à une autre, avec ses refus
  backup.ts      archive ZIP datée, au démarrage et pendant la session
  export.ts      tout l'arbre en un JSON lisible sans l'application
  index.ts       routes
  schema.sql     schéma complet
shared/          types partagés serveur / client
src/             interface React
  treeLayout.ts  calcul de position des cases
  TreeCanvas.tsx rendu SVG, zoom et déplacement
  PersonSheet.tsx fiche latérale
  AddPersonDialog.tsx saisie rapide
  AttachDialog.tsx choix d'une personne déjà existante à rattacher
  SettingsDialog.tsx écran Réglages : dossier, souche, copies, export
  saveFile.ts    écrire un fichier produit par le serveur là où l'utilisateur le veut
tests/           dates, relations, intégrité, migration, export, archives (`npm test`)
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

## Le dossier de données

`server/config.ts` le résout dans cet ordre : variable `FAMILY_DATA_DIR`, puis `config.local.json`
à la racine du projet, puis `D:\Genealogie` sous Windows (créé au besoin).

Il n'y a **plus de repli sur le dossier du projet**. Écrire une base là où le code est rangé, c'est
l'exposer à un déplacement, un `git clean`, ou un jour à une version publique du dépôt. Et ouvrir un
arbre vide sans le dire, c'est se faire peur : on croit ses données perdues alors qu'elles sont
ailleurs. Sur les systèmes où aucun choix ne peut être deviné, l'application s'arrête en écrivant
les deux façons d'indiquer le dossier.

Le chemin retenu est affiché au démarrage (`Données : …`) et repris dans l'en-tête de l'interface.
L'écran **Réglages** le change : il écrit `config.local.json` à la racine du projet et demande un
redémarrage. Deux chemins sont refusés à l'écran, parce qu'ils coûteraient plus tard : un dossier rangé
**dans le dépôt** (une famille versionnée par accident), et **la racine d'un disque** (`D:\` plutôt
que `D:\Genealogie`). Quand `FAMILY_DATA_DIR` est posée, elle prime et l'écran le dit — sans quoi on
croirait changer son dossier alors que rien ne bouge.

Le serveur ne rouvre pas la base en cours de route : la base est ouverte, les médias sont référencés
par des chemins relatifs, et partir à chaud produirait un arbre à moitié écrit. Le redémarrage est
donc demandé, jamais simulé.

## Sauvegarde des données

| Moment | Ce qui est archivé | Pourquoi |
|---|---|---|
| Au démarrage | base + médias + réglages, si la dernière archive a plus de 6 h | ce qu'une session d'hier a écrit ne doit tenir qu'une nuit |
| Toutes les 30 minutes | idem, seulement si quelque chose a été écrit | une après-midi de saisie ne dépend pas du seul bouton cliqué |
| Bouton « Sauvegarder » | idem, à la demande | avant une manipulation risquée |

Vingt archives sont gardées, nommées `famille-AAAA-MM-JJ-HHMM-motif.zip`, écrites dans un fichier
`.part` puis renommées : une coupure laisse l'archive précédente intacte, jamais une archive à
moitié écrite.

Le compteur `total_changes()` de SQLite décide si la session a vraiment écrit : sans lui, chaque
vérification produirait une archive identique et chasserait les vingt gardées.

Un échec de sauvegarde n'est pas seulement loggé : il passe par `server/notices.ts` et s'affiche
en bandeau. Une sauvegarde que l'on croit avoir est pire qu'une sauvegarde refusée.

### Faire sortir une copie du disque

Une archive rangée à côté des données ne protège ni de l'incendie ni du disque qui meurt. L'écran
Réglages liste les archives avec, sur chacune, un bouton **« Copier vers… »** qui la livre octet pour
octet au navigateur : `showSaveFilePicker` ouvre la fenêtre d'enregistrement (Chrome, Edge), les
autres navigateurs retombent sur le téléchargement. Dans les deux cas la copie quitte le disque, ce
qui est tout ce qu'on demande à ce bouton. Le nom de l'archive est validé serveur avant d'être ouvert :
`backupFile()` ne connaît que le motif `famille-…-[a-z]+.zip` et reste dans le dossier `sauvegardes`,
un `..` glissé dans la requête ressort en 404.

### Export JSON

`server/export.ts` écrit tout l'arbre dans un fichier que n'importe quel éditeur ouvre, sans
l'application — le troisième niveau de la spec, celui qui protège d'un logiciel qui disparaît.
Le document épouse les tables, sans inventer de vue : `persons`, `couples`, `parentChild`, `events`,
`places`, `media`, `notes`, `sources`, `branches`, précédés de `format`, `version`, `exportedAt`,
`rootPersonId`, `counts`, et d'une `note` qui explique comment relire les dates.

Deux choix y comptent :

- **une date garde ses quatre colonnes** (`min`, `max`, `qualifier`, `text`) réunies en un objet. Une
  date floue exportée en `1920-01-01` serait une date inventée ;
- **les naissances et décès ne sont pas dupliqués** depuis `event`, et `parentChild.coupleId` reste
  vide tant que l'union n'est pas déclarée. L'export ne dévine pas ce que la base tait.

Le fichier est proposé sous le nom `arbre-AAAAMMJJ-HHMM.json`. Les médias y sont désignés par leur
chemin relatif au dossier de données, donc reprise dans l'archive ZIP.

## Faire évoluer le schéma

`schema.sql` est écrit avec des `CREATE TABLE IF NOT EXISTS` : il pose les tables d'une base neuve
mais ne rattrape pas une base déjà créée. Les ajustements entre versions passent donc par
`server/migrations.ts`, et `PRAGMA user_version` sert de calendrier — une migration ne se rejoue
pas, et une base ancienne traverse les versions dans l'ordre.

**Migration 1 — un couple survit à la suppression d'un de ses membres.** Avant, `partner_a` et
`partner_b` étaient en `ON DELETE CASCADE` : effacer une personne mal orthographiée détruisait son
union, ses actes de mariage, et par `SET NULL` la mémoire de l'union dont venaient les enfants. Les
deux colonnes passent en `ON DELETE SET NULL`, et `couple` n'est supprimée par
`pruneEmptyCouples()` que quand plus rien ne la justifie — ni un enfant, ni un acte, ni un membre.

## Contrat d'API (passes 0 à 2)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/state` | dossier de données, statistiques, personne racine, dernière archive, avertissements |
| GET | `/api/graph` | personnes, couples, liens parent-enfant, en une requête |
| GET | `/api/persons/:id` | fiche complète : relations et événements |
| POST | `/api/persons` | création, avec rattachement optionnel |
| POST | `/api/persons/:id/relations` | rattacher deux personnes déjà dans la base |
| PATCH | `/api/persons/:id` | modification |
| DELETE | `/api/persons/:id` | suppression |
| PUT | `/api/config` | personne racine de l'arbre |
| PUT | `/api/config/data-dir` | dossier de données : écrit `config.local.json`, demande un redémarrage |
| POST | `/api/backup` | archive ZIP immédiate |
| GET | `/api/backups` | archives gardées dans le dossier de données |
| GET | `/api/backups/file?name=` | une archive, en flux, pour la copier sur un autre support |
| GET | `/api/export/json` | tout l'arbre en JSON, avec un nom de fichier proposé |

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
- [x] suppression avec confirmation

## Passe 2 — sauvegarde

- [x] archive ZIP datée : base, médias, réglages, avec mode d'emploi dans l'archive
- [x] sauvegarde au démarrage si la dernière est trop ancienne
- [x] sauvegarde pendant la session dès que la base a changé
- [x] bouton « Sauvegarder » et date de la dernière archive dans l'en-tête
- [x] avertissements à l'écran quand une sauvegarde échoue ou qu'un réglages est abîmé
- [x] un couple survit à la suppression d'un de ses membres (migration 1)
- [x] écran Réglages : dossier de données, personne de référence, archives, export
- [x] copie d'une archive vers un autre support (« Copier vers… », hors du disque)
- [x] export JSON de l'arbre, lisible sans l'application
- [ ] restauration depuis une archive

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
- **Rien ne remplace une archive.** « Copier vers… » sort une copie du disque, mais aucun écran ne la
  recharge : la restauration se fait encore à la main, application fermée, en remplaçant le fichier
  `famille.db` du dossier de données par celui de l'archive (le `LISEZMOI.txt` de l'archive le dit).
  Compter sur une sauvegarde que l'on n'a jamais su restaurer est le seul vrai risque de ce chapitre.
- **L'export JSON ne porte pas les images**, seulement leurs chemins et leurs légendes : c'est un
  fichier de données, pas une archive. Les pixels vivent dans le ZIP.

Résolu : une personne ayant plusieurs unions n'apparaît plus qu'une seule fois, ses conjoints étant
dessinés dans le même bloc `[conjoint] [personne] [conjoint]`.

À assumer, ce n'est pas un bug : supprimer une personne emporte ses liens de parenté. Ses enfants
gardent l'autre parent et l'union dont ils sont issus, mais le parent effacé ne revient que par une
sauvegarde.

## Conventions

- Interface et code en français pour les libellés, anglais pour les noms de variables et de tables
  (cohérence avec l'écosystème, lisibilité pour un futur contributeur).
- Aucune donnée familiale dans le dépôt. Le dossier de données est hors du projet.
- Pour tester sans toucher aux vraies données, on démarre sur un dossier temporaire :
  `FAMILY_DATA_DIR=<dossier vide hors du projet> PORT=4599 npm start`. Sans ces deux variables,
  `npm start` ouvre `D:\Genealogie`, c'est-à-dire l'arbre de la maison.
- Les tests (`npm test`) écrivent chacun dans leur propre dossier temporaire : ils ne peuvent pas
  atteindre une vraie base, et chaque fichier a son processus.
