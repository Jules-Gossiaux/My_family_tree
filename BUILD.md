# Plan de construction

Ce document détaille les passes 0 à 5, et suit l'avancement. La vision et le modèle de données
sont dans [`SPEC.md`](SPEC.md).

## Principe

On ne construit pas écran par écran en finition. On traverse d'abord toutes les couches avec une
version minuscule mais complète (« balle traçante »), puis on épaissit.

| Passe | Contenu | État |
|---|---|---|
| 0 | Socle : base, ajout de personnes, arbre minimal, fiche minimale | faite |
| 1 | Saisie rapide, dates floues, couples, demi-frères | faite |
| 2 | Sauvegarde automatique en ZIP daté, réglages, export JSON, restauration | faite |
| 3 | Arbre de descendance abouti, branches colorées, réglage « moi » et « me recentrer » | faite |
| 4 | Médias : import, vignettes, bac d'entrée, rattachement par lot, choix du portrait | faite |
| 5 | Fiche complète : dossier de vie, chronologie, notes | à faire |
| 6 | Poster PDF, deux modèles, avec portraits ; cadre de recadrage interactif | à faire |
| 7 | Parenté, questions ouvertes, recherche par surnom, filtres, annuaire | à faire |
| 8 | Export GEDCOM | à faire |

## Architecture

```
server/          API HTTP + accès SQLite
  config.ts      résolution du dossier de données
  db.ts          ouverture de la base, application du schéma
  dates.ts       analyse des dates floues
  migrations.ts  ajustements du schéma pour les bases déjà remplies
  notices.ts     ce que le serveur sait et doit afficher
  app-config.ts  les deux personnes de référence : la souche de l'arbre et « moi »
  relations.ts   rattachement d'une personne à une autre, avec ses refus
  branches.ts    lignes de famille : nom, teinte, tête de ligne et personnes rangées
  life-events.ts faits d'une vie : type, date libre, lieu, source, confiance
  places.ts      lieux trouvés ou posés par le nom qu'écrit un fait, renommés et effacés
  sources.ts     sources déclarées dans Réglages et citées par un fait, refusées tant qu'on les cite
  notes.ts       notes posées sur une personne, une union, un fait, un fichier ou un lieu
  backup.ts      archive ZIP datée, au démarrage et pendant la session
  export.ts      tout l'arbre en un JSON lisible sans l'application
  restore.ts     recharge une archive : contrôle, copie de sûreté, échange
  media.ts       range, retrouve et détache les photos et les documents
  index.ts       routes
  schema.sql     schéma complet
shared/          types partagés serveur / client
src/             interface React
  treeLayout.ts  calcul de position des cases, et des liens que la descendance ne peut pas dessiner
  TreeCanvas.tsx rendu SVG, zoom, déplacement, teintes de branche et leurs pastilles
  PersonSheet.tsx fiche latérale, galerie de la personne, portrait et branche
  LifeTimeline.tsx chronologie de la vie : ajouter, corriger et retirer un fait, son lieu et sa source
  NoteList.tsx   marge écrite d'un objet : ajouter, corriger et retirer une note
  AddPersonDialog.tsx saisie rapide
  AttachDialog.tsx choix d'une personne déjà existante à rattacher
  SettingsDialog.tsx écran Réglages : dossier, souche, « moi », branches, lieux, sources, copies, export
  saveFile.ts    écrire un fichier produit par le serveur là où l'utilisateur le veut
  thumbnails.ts  vignette dessinée par le navigateur, type et date pris du fichier
  MediaInbox.tsx bac d'entrée : importer en lot puis rattacher à plusieurs personnes
  MediaLightbox.tsx visionneuse plein écran, avec ou sans éditeur à l'intérieur
  MediaEditor.tsx légende, date lue et type d'un média déjà en place
tests/           dates, relations, branches, réglages, faits de la vie, lieux, intégrité, migration,
                 export, archives, restauration, médias (`npm test`)
start.bat        démarrer l'application
restore.bat      recharger une archive de sauvegarde
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
| Source citée | ne s'efface pas : `event.source_id` et `media.source_id` n'ont pas de clé étrangère | supprimer quand même laisserait un fait pointant une ligne disparue, et l'écran n'aurait plus rien à montrer à la place de sa source |
| Notes | une seule table `note` avec `target_type` + `target_id`, plutôt qu'une colonne `note` par objet ou cinq tables de notes | la marge d'un acte et celle d'une personne sont la même chose ; une colonne ne peut pas porter de clé étrangère vers cinq tables, donc c'est le serveur qui vérifie la cible et l'effacement qui entraîne les notes |
| Upload des médias | octets bruts (`express.raw`), jamais de JSON base64 | un JPEG de 20 Mo en base64 pèse 27 Mo de texte et encrera le tas Node ; les octets entrent tels quels |
| Déduplication | empreinte `sha256` de l'original, calculée à l'écriture | la même photo scannée deux fois ne doit pas remplir le dossier ni peupler le bac de deux cases identiques |
| Vignettes | dessinées par le navigateur dans un `<canvas>`, `sharp` écarté | pas de binaire natif de plus à recompiler quand Node change ; le serveur range des octets, il ne décode rien |
| Serving d'un média | par identifiant (`/api/media/:id/original`), chemin revalidé contre le dossier de données | un chemin glissé dans une requête ne doit pas ouvrir un fichier hors du dossier familial |
| Emplacement sur disque | `medias/<photo\|document>/<année>/<id>.<ext>`, écrit en `.part` puis renommé | ranger à l'année vue sur le fichier et une coupure ne laisse jamais une moitié d'image que la base croirait entière |

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

`restore.bat` est le second écran d'entrée, et le seul qui écrase des données. Il reprend les mêmes
réparations (dépendances, moteur SQLite) puis laisse `server/restore.ts` parler : liste numérotée des
archives, numéro tapé, comparaison « elle contient / la base actuelle », puis le mot **OUI** à taper.
Tout autre texte n'arrive pas jusqu'à la base.

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
`backupFile()` ne connaît que le motif `famille-…-HHMM-motif.zip` et reste dans le dossier
`sauvegardes`, un `..` glissé dans la requête ressort en 404.

### Recharger une archive

Compter sur une sauvegarde que l'on n'a jamais su relire, c'est croire qu'on a deux copies.
`server/restore.ts` fait le voyage inverse, et l'ordre de ses étapes est tout le sujet :

1. **contrôler avant d'écarter** — la base de l'archive est écrite dans un fichier de côté, ouverte
   en lecture, passée à `PRAGMA integrity_check` et à la table `person` qu'elle doit contenir. Une
   archive vide, abîmée ou venue d'ailleurs est refusée avant que quoi que ce soit ait bougé ;
2. **copier ce qui va être écrasé** — une archive `…-avant-restauration.zip` de la base en place,
   produite par `backup()` et donc lisible même si le fichier de départ était à moitié écrit. Deux
   restaurations dans la même minute gardent leurs deux copies (`…-b.zip`) ;
3. **échanger les fichiers** — `famille.db` est renommé puis remplacé, jamais écrit par-dessus : une
   coupure laisse l'un ou l'autre, jamais deux moitiés. Si le second renommage échoue, le premier est
   défait dans la foulée. Les journaux `-wal` et `-shm` de la base qui n'est plus là sont effacés,
   sinon ils feraient relire l'ancienne base à la nouvelle ;
4. **relire ce qui est en place** — les comptages annoncés à l'écran viennent du fichier posé, pas de
   l'archive que l'on croyait installer.

Les réglages et les médias voyagent avec l'archive : `config.json` est remplacé par celui de
l'archive, les fichiers de `medias/` sont ajoutés à ceux du dossier. **Rien n'est supprimé** — une
restauration ramène des personnes et les photos que leurs lignes réclament, ce n'est pas un tri. Une
entrée d'archive dont le nom sortirait du dossier des médias est écartée et dite à l'écran.

L'application refuse de travailler si quelqu'un écoute sur le port : remplacer une base sous un
programme qui l'utilise produirait un arbre à moitié écrit. `--force` passe outre, en le disant.

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

## Contrat d'API (passes 0 à 5)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/state` | dossier de données, statistiques (personnes, couples, médias, médias à rattacher), personne racine, personne « moi », dernière archive, avertissements |
| GET | `/api/graph` | personnes, couples, liens parent-enfant, branches, en une requête |
| GET | `/api/persons/:id` | fiche complète : relations, vie triée du plus ancien au plus récent, médias et notes de la personne |
| POST | `/api/persons` | création, avec rattachement optionnel |
| POST | `/api/persons/:id/relations` | rattacher deux personnes déjà dans la base |
| PATCH | `/api/persons/:id` | modification, `portraitMediaId` et `branchId` compris (mettre `null` retire le portrait, rend la personne au hors-classe) |
| DELETE | `/api/persons/:id` | suppression ; la souche repart d'une personne qui existe encore, « moi » s'éteint |
| POST | `/api/branches` | création ; avec `rootPersonId`, range toute la descendance de cette personne |
| PATCH | `/api/branches/:id` | nom, teinte, tête de ligne — ne déplace aucune personne |
| POST | `/api/branches/:id/descendants` | range la descendance de la tête (ou de `rootPersonId` donné) ; répond `assigned: 0` si tout le monde était déjà classé |
| DELETE | `/api/branches/:id` | efface la branche et rend ses personnes au hors-classe |
| POST | `/api/events` | un fait de la vie : `personId` **ou** `coupleId`, `type`, `dateText` en français libre, `placeName` (le nom tapé, qui trouve la ligne de lieu ou la pose), `description`, `confidence`, `placeId`, `sourceId` — 400 si la forme ne convient pas, 404 si le sujet est inconnu, 409 si c'est une seconde naissance ou un second décès. Tout se valide avant toute écriture : un refus ne laisse pas un lieu neuf orphelin dans la base |
| PATCH | `/api/events/:id` | corrige un fait : un champ absent laisse ce qui est écrit, `dateText: ""` rend la date, `placeName: ""`, `placeId` ou `sourceId` à `null` rendent le lieu ou la source |
| DELETE | `/api/events/:id` | efface un fait ; un fichier qui y était relié garde son image, il perd le lien |
| GET | `/api/places` | tous les lieux, triés par nom, avec le compte de faits et de fichiers qui y pointent |
| PATCH | `/api/places/:id` | renommer : les lignes qui pointaient déjà ici suivent le nouveau nom ; 409 si un autre lieu le porte déjà, et le refus nomme lequel |
| DELETE | `/api/places/:id` | effacer un nom : ses faits et ses fichiers restent, ils deviennent sans lieu ; la réponse compte ce qui reste |
| GET | `/api/sources` | toutes les sources, triées par genre puis par référence, avec le compte de faits et de fichiers qui les citent |
| POST | `/api/sources` | déclarer une source : `kind` (acte, photo, temoignage, web, livre), `reference`, `reliability` — 400 hors de ces listes ou sans référence, 409 si la référence est déjà prise, et le refus nomme le genre de la ligne qui la porte |
| PATCH | `/api/sources/:id` | corrige genre, référence ou fiabilité sans déplacer une citation ; 404 si la source est inconnue, 409 si la référence est celle d'une voisine |
| DELETE | `/api/sources/:id` | efface une source que plus rien ne cite ; tant qu'un fait ou un fichier la nomme, c'est un 409 qui compte les citations à retirer |
| POST | `/api/notes` | une note posée sur une ligne qui existe : `targetType` (person, couple, event, media, place), `targetId`, `body` — 400 hors de ces cinq cibles ou sans texte, 404 si la ligne visée n'est pas dans la base |
| PATCH | `/api/notes/:id` | corrige le texte ; la date d'écriture ne bouge pas, la base n'en garde qu'une |
| DELETE | `/api/notes/:id` | efface une note ; 404 si elle est inconnue |
| PUT | `/api/config` | `rootPersonId` (la souche) et `mePersonId` (« moi »), réglés séparément : un champ absent laisse ce qui est écrit, `null` le retire, une id inconnue est refusée en 400 sans rien déplacer |
| PUT | `/api/config/data-dir` | dossier de données : écrit `config.local.json`, demande un redémarrage |
| POST | `/api/backup` | archive ZIP immédiate |
| GET | `/api/backups` | archives gardées dans le dossier de données |
| GET | `/api/backups/file?name=` | une archive, en flux, pour la copier sur un autre support |
| GET | `/api/export/json` | tout l'arbre en JSON, avec un nom de fichier proposé |
| POST | `/api/media?kind=&mime=&taken=&width=&height=` | l'original en octets bruts ; répond `deduped: true` et 200 si la photo était déjà là, 201 sinon, 413 si elle dépasse 60 Mo |
| PUT | `/api/media/:id/thumbnail` | la vignette dessinée par le navigateur, en octets bruts |
| GET | `/api/media?state=a-relier` | le bac d'entrée : les médias que personne ne réclame |
| GET | `/api/media/:id/original` · `/thumbnail` | les fichiers, en flux, revalidés contre le dossier de données |
| PATCH | `/api/media/:id` | légende, type (`photo`/`document`), type d'acte, date lue |
| DELETE | `/api/media/:id` | supprimer le média **et ses deux fichiers du disque** |
| POST | `/api/media/:id/persons` | rattacher à une ou plusieurs personnes (`personIds`, `role`) |
| DELETE | `/api/media/:id/persons/:personId` | détacher d'une personne, sans rien effacer |

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

## Les photos et les documents

Une famille a deux sortes de preuves : les visages et les papiers. Les deux entrent par le même
geste — on dépose des fichiers — et repartent par deux chemins distincts : la fiche d'une personne,
qui montre sa propre galerie, et le **bac d'entrée**, qui montre ce que personne ne réclame encore.

Le trajet d'un fichier, tel qu'il est écrit dans le code :

1. le navigateur lit le fichier, devine si c'est une **photo** ou un **document** (PDF), retient la
   date que le disque connaît (`file.lastModified`) et dessine une vignette de 512 px dans un canvas ;
2. l'original part en octets bruts à `POST /api/media` ; `server/media.ts` vérifie le type, la taille,
   calcule le `sha256` ; si cette empreinte existe déjà, **rien n'est écrit une seconde fois** et la
   réponse le dit (`deduped`) ;
3. sinon le fichier est posé en `.part` puis renommé sous `medias/<photo|document>/<année>/<id>.<ext>`,
   la ligne est créée, et la vignette arrive dans la foulée par `PUT /api/media/:id/thumbnail` ;
4. le média est rattaché : à la personne dont la fiche est ouverte, ou, depuis le bac, à plusieurs
   personnes d'un seul lot — c'est la table `media_person` qui rend une photo de groupe utilisable.

Trois choses se jouent à l'écran :

- **le portrait** est un choix assumé, pas une taille : « Faire le portrait », dans la visionneuse.
  La case de la personne en tête d'arbre prend alors cette image ; retirer le portrait rend juste la
  case à son défile d'initiales, jamais le média disparaît ;
- **la visionneuse suit l'identifiant du média, jamais sa place.** Corriger une date dans le dossier
  de vie réordonne la galerie chronologiquement ; rester sur un index ferait sauter le lecteur sur une
  photo voisine sans qu'on lui ait rien demandé ;
- **supprimer est à deux temps.** « Détacher » rend le média au bac et ne touche à rien sur le disque ;
  « Supprimer » est le seul endroit de l'application qui efface des fichiers, et il le demande deux fois.

Un média dont la vignette n'a pas pu être dessinée (HEIC, GIF animé, format que Chrome ne décode pas)
entre quand même, sans aperçu, avec son nom en travers : refuser une photo sous prétexte qu'on ne sait
pas la réduire serait perdre une preuve pour un problème d'affichage.

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
- [x] restauration d'une archive (`restore.bat`) : contrôle, copie de sûreté, échange de fichiers

## Passe 3 — lire l'arbre

- [x] un lien que la descendance ne peut pas dessiner sort du calcul (`crossLinks`) et se trace en pointillés
- [x] trois motifs distingués : un parent qu'aucun trait ne relie à son enfant déjà posé ailleurs, une
  boucle dans la famille, une union dont les deux cases vivent dans deux blocs
- [x] légende en bas du canevas : elle compte les traits et dit ce qu'ils signifient ; chaque trait se clique
  et ouvre la fiche de la personne visée
- [x] une seule case par personne, même réclamée par deux blocs — sans quoi la largeur du sous-arbre se
  compte deux fois et le doublon se croyait une autre personne
- [x] branches non rattachées posées dans un ordre qui ne vole pas leur descendance aux parents
- [x] tests de mise en page (`tests/layout.test.ts`) : cycle, deux parents solos, cousins mariés dans les
  deux ordres d'arêtes, double union, enfant né du couple dessiné
- [x] branches remplissables et colorées sur les cases : « Créer une branche ici » du menu d'une personne en
  pose une qui part d'elle et range sa descendance, la fiche donne ou rend une branche, Réglages change les
  noms, les teintes et les têtes de ligne
- [x] une branche ne déplace jamais une personne déjà rangée ailleurs, et ne tourne pas en rond dans une
  boucle de famille ; son nom et sa teinte ne se partagent pas
- [x] pastilles des branches au-dessus du canevas : elles comptent les cases de chaque ligne, colorent la
  case d'un coup d'œil et amènent l'arbre sur la tête de ligne quand on les clique
- [x] migration 2 : `branch.root_person_id` devient une vraie référence en `SET NULL`, et une tête qui ne
  désignait plus personne est remise à zéro plutôt que de rester pendante
- [x] tests serveur des branches (`tests/branches.test.ts`), et reprise d'une base ancienne peuplée de
  branches dans `tests/migration.test.ts`
- [x] réglage « moi », distinct de la souche : « C'est moi » dans le menu d'une personne, une ligne dans
  Réglages, et la pastille « Me recentrer » de la barre du canevas, qui saute sur cette personne et ouvre
  sa fiche ; éteinte et expliquée quand le choix n'est pas fait ou que la personne a quitté l'arbre
- [x] `PUT /api/config` tenu par `server/app-config.ts` et testé (`tests/config.test.ts`) : un champ absent
  laisse l'autre, `null` retire, une id inconnue est refusée sans rien écrire, et effacer une personne de
  référence ne laisse aucun réglage pendu
- [ ] filtre par branche, filtre vivants/décédés

## Passe 4 — photos et documents

- [x] import par glisser-déposer et par bouton, en lot, sur la fiche et dans le bac
- [x] formats reconnus : JPEG, PNG, WebP, GIF, PDF ; les autres sont refusés en disant pourquoi
- [x] plafond à 60 Mo, annoncé en 413 avant d'écrire quoi que ce soit
- [x] écriture `.part` puis renommage, rangee sous `medias/<type>/<année>/`
- [x] déduplication par `sha256` : un doublon est dit comme tel, pas compté comme un ajout
- [x] vignettes dessinées par le navigateur, sans dépendance native
- [x] bac d'entrée avec compteur dans l'en-tête, import en lot et rattachement à plusieurs personnes
- [x] galerie dans la fiche, dans l'ordre où la vie s'est déroulée
- [x] visionneuse plein écran, image et PDF, navigation clavier et flèches
- [x] portrait choisi, retiré, repris sur la case de la personne
- [x] légende, date lue sur le fichier et type d'acte modifiables après coup (`MediaEditor`)
- [x] détacher (rend au bac) et supprimer (efface les fichiers), avec confirmation à deux temps
- [x] tests serveur sur de vrais fichiers dans un dossier temporaire (`tests/media.test.ts`)

## Passe 5 — le dossier de vie

Les faits d'une vie, d'abord, parce que tout le reste du dossier s'accroche à eux.

- [x] `server/life-events.ts` : un fait porte une personne **ou** une union, jamais les deux ni aucune
- [x] sept types (naissance, baptême, décès, inhumation, profession, résidence, autre) et trois degrés
  de confiance (certain, probable, douteux) ; ailleurs que dans ces listes, c'est un 400 qui les cite
- [x] une naissance et un décès par personne : le second est refusé en 409 et nomme le fait à reprendre
- [x] la date se tape en français libre ; ce que l'analyseur ne lit pas reste du texte en « unknown »,
  sans année inventée, et se range à la fin de la vie
- [x] la date de naissance et le décès de la fiche écrivent le fait du même nom (`setPersonDateEvent`) :
  un fait n'a pas deux lignes selon l'endroit où on l'a tapé
- [x] routes `POST`, `PATCH` et `DELETE /api/events` ; `GET /api/persons/:id` rend la vie triée, avec son
  lieu, sa source et le compte de fichiers reliés
- [x] `src/LifeTimeline.tsx` : la section « Vie » est une chronologie — ajout, édition en place, retrait à
  deux temps, et le refus du serveur montré tel quel
- [x] la fiche n'a plus qu'un seul callback de rechargement (`onChanged`) là où brancher et média en
  avaient deux qui faisaient la même chose
- [x] tests serveur des faits de la vie (`tests/life-events.test.ts`, 25 cas ; 121 tests au total)

Les lieux d'un fait, ensuite, parce qu'une ville sans écran se recopie et se disperse :

- [x] `server/places.ts` : le nom seul désigne un lieu — la ligne qui le porte déjà est retrouvée sans
  distinction de casse ni espace de trop, sinon elle est posée. Rien ne se saisit à part
- [x] un fait écrit son lieu par `placeName` : les validations passent d'abord, l'écriture des deux
  tables se fait dans une transaction — un refus ne laisse pas un nom neuf orphelin dans la base
- [x] routes `GET`, `PATCH` et `DELETE /api/places` : la liste avec ses comptes, un renommage qui suit
  ce qui pointait déjà ici, un effacement qui rend les faits et les fichiers à un lieu inconnu en
  comptant ce qui reste
- [x] le champ « Lieu » de la chronologie propose les noms déjà écrits et passe sous silence ceux qui ne
  portent plus rien : une faute de frappe ne se repique pas en suggestion
- [x] une section « Lieux » dans Réglages, sur les lignes de branche : compte par ligne, renommage,
  suppression à deux temps
- [x] tests serveur des lieux (`tests/places.test.ts`, 13 cas ; 134 tests au total)

Les sources d'un fait, ensuite, parce qu'une cote recopiée en texte libre ne se retrouve plus :

- [x] `server/sources.ts` : la référence désigne la source — une cote, un titre, une adresse — sans
  distinction de casse ni espace de trop ; un même texte déjà pris est refusé en 409 et dit sous quel
  genre la ligne existe
- [x] cinq genres et trois fiabilités, stockés sans accent, dits en français à l'écran ; hors de ces
  listes c'est un 400 qui les cite, et rien ne s'écrit
- [x] une source encore citée ne s'efface pas : `event.source_id` et `media.source_id` n'ont pas de clé
  étrangère, donc le refus vaut mieux qu'une ligne effacée sous un fait qui la nommait — et il compte
- [x] routes `GET`, `POST`, `PATCH` et `DELETE /api/sources` ; `knownSource` vit dans ce module et
  `life-events.ts` la lui demande, au lieu de la redupliquer
- [x] le champ « Source » de la chronologie, à côté du lieu : la liste des sources déclarées, « Aucune
  source » pour la rendre à l'ignorée, et le genre en explication au survol de la ligne
- [x] une section « Sources » dans Réglages : ajout par genre choisi, ligne qui porte sa référence, son
  genre, sa fiabilité et son compte de citations, effacement qui se refuse tant qu'il reste un fait
- [x] un refus d'ajout, dans Réglages, ne s'écrit plus au bas du défilement : l'épingler au bord visible
  de la boîte est ce qui fait qu'on le lit
- [x] tests serveur des sources (`tests/sources.test.ts`, 13 cas ; 147 tests au total)

Les notes, enfin, parce qu'une phrase qu'on ne peut pas dater n'a rien à faire dans la chronologie :

- [x] `server/notes.ts` : une note se pose sur `person`, `couple`, `event`, `media` ou `place`, et la
  ligne visée doit exister — `note` n'a pas de clé étrangère, une seule colonne ne peut pas désigner
  cinq tables, donc c'est le serveur qui refuse la cible inventée en 404 et le type inconnu en 400
- [x] une note n'a ni date généalogique, ni confiance, ni source : elle garde ce que l'on sait sans le
  prouver, et ne concurrence pas le fait de la chronologie
- [x] corriger une note n'en change pas la date — la base n'en a qu'une — et l'écran dit « écrite le »
- [x] ce que l'on efface emporte ses notes : `dropNotesFor` est appelé par le retrait d'un fait, la date
  vidée sur la fiche, l'effacement d'un fichier ou d'un lieu, l'union élaguée et la personne supprimée,
  chacun dans sa propre transaction
- [x] routes `POST`, `PATCH` et `DELETE /api/notes` ; `GET /api/persons/:id` rend les notes de la personne
  dans l'ordre où elles ont été écrites
- [x] `src/NoteList.tsx` : la section « Notes » de la fiche — cadre de texte, édition en place, retrait à
  deux temps, et le refus du serveur montré tel quel
- [x] `body` se relit tel qu'il est tapé, ses sauts de ligne gardés : aucun moteur Markdown pour trois
  phrases de marge
- [x] tests serveur des notes (`tests/notes.test.ts`, 12 cas ; 159 tests au total)

Ce qui reste de la passe 5 :

- [ ] un écran pour les faits d'une union : le serveur les accepte et les rend déjà dans l'ordre
  (`eventsOfCouple`), la fiche ne les montre pas encore
- [ ] les notes : `server/notes.ts`, une note se lit et s'écrit sur la fiche, sur un fait, sur un fichier
- [ ] rattacher un fichier à un fait (`media_event`), le montrer sur la ligne de chronologie et porter
  la table à l'export JSON
- [ ] la frise familiale globale et les albums par époque (§8.6), qui demandent les médias datés

## Limites connues

Ce qui manque encore, avec le fil qui le reprend :

- **Aucun recadrage.** Les colonnes `crop_x`, `crop_y` et `crop_size` de `media_person` sont vides :
  le portrait est l'image entière, telle quelle. Le cadre de recadrage interactif appartient à la
  passe 6, parce que c'est le poster qui a besoin d'un visage centré, pas la fiche.
- **La date d'un média vient du fichier, pas de l'image.** `takenOf()` lit `file.lastModified`, pas
  l'EXIF : une photo de 1911 scannée en 2020 arrive datée de 2020. Elle se corrige dans la visionneuse
  (« Date lue sur le fichier »), et le dossier garde ses quatre colonnes de date floue.
- **Une vignette qui n'a pas pu être dessinée ne se rattrape pas.** Le serveur ne décode rien, donc il
  ne peut pas la refaire plus tard : un JPEG que le navigateur n'a pas su réduire reste un carré vide,
  avec son nom en travers. Le fichier original, lui, est bien là.
- **Poser un fichier sur le disque ne l'importe pas.** Seule la route écrit la ligne et range l'image :
  copier un JPEG dans `medias/` à la main le rend invisible de l'application, et rien ne le signale.
- **Supprimer une personne rend ses photos au bac.** `media_person` est en `ON DELETE CASCADE` : les
  fichiers restent sur le disque, les médias retournent dans « à rattacher », mais recréer la personne
  ne repeuple pas sa galerie — il faut les rattacher à nouveau.
- **Le bac ne voit que les personnes.** Une image rattachée à un événement (`media_event`) n'a encore
  aucun écran, et le compte de fichiers affiché sur une ligne de chronologie reste donc à zéro.
- **Une source se cite, elle ne se montre pas.** Le champ « Source » d'un fait choisit dans ce que
  Réglages a déclaré, et la référence corrigée suit les faits qui la citent. Mais `media.source_id`
  n'est écrit par aucun écran — un fichier ne dit toujours pas de quoi il témoigne — et une source ne
  porte ni date, ni extrait, ni lien : la table `source` ne garde que son genre, sa référence et sa
  fiabilité.
- **Un lieu n'a que son nom.** `lat`, `lon` et `parent_place_id` ne sont remplis par personne : ni
  hiérarchie ville → pays, ni carte. `media.place_id` attend son écran aussi, donc une photo ne dit
  toujours pas où elle a été prise. Et deux orthographes d'un même lieu ne se fusionnent pas encore :
  renommer vers un nom déjà porté est refusé et nomme celui qui l'a, il faut réécrire le lieu sur chaque
  fait — c'est précisément ce que la liste « Lieux » des Réglages rend visible.
- **La recherche ne voit pas les surnoms.** Elle filtre sur les prénoms, le nom de famille et le nom de
  naissance, jamais sur `name_variant` : « Tata Michèle » ne se trouve pas, alors que c'est souvent le seul
  nom que la famille connaît. Ce n'est pas un `OR` à ajouter côté client — `/api/graph` ne renvoie pas les
  surnoms, seuls les portent les personnes détaillées. À traiter avec l'annuaire de la passe 7, qui aura
  de toute façon besoin de chercher dans ces noms-là.
- **La restauration ne se commande pas depuis l'écran.** Elle passe par `restore.bat`, application
  fermée : le serveur tient la base ouverte et remplacer ce sur quoi il est assis produirait un arbre
  à moitié écrit. L'écran Réglages le dit sous la liste des archives, avec les quatre gestes à faire.
  Un bouton « Restaurer » supposerait de redémarrer le serveur de l'intérieur, ou de passer par un
  fichier de consigne appliqué au démarrage — deux choses à construire en même temps que l'écran qui
  les montre, pas avant.
- **Une archive contrôlée n'est pas une archive juste.** Le script vérifie que la base s'ouvre, pas
  que l'arbre qu'elle contient est celui que l'on croyait : une fausse manœuvre de saisie vieille de
  trois semaines revient intacte. La comparaison annoncée avant de remplacer (combien de personnes
  ici, combien là) est ce qui doit faire tiquer.
- **Une restauration ne supprime aucune photo.** Les médias de l'archive sont ajoutés à ceux du
  dossier, jamais l'inverse : les images supprimées depuis l'archive reviendraient avec leur ligne,
  mais celles ajoutées après restent en place même si plus personne ne les réclame.
- **L'export JSON ne porte pas les images**, seulement leurs chemins et leurs légendes : c'est un
  fichier de données, pas une archive. Les pixels vivent dans le ZIP.

Résolu : une personne ayant plusieurs unions n'apparaît plus qu'une seule fois, ses conjoints étant
dessinés dans le même bloc `[conjoint] [personne] [conjoint]`.

Résolu en passe 3 : le trait qui traversait l'arbre sans rien dire — l'enfant de deux parents solos, la
boucle d'un mariage entre cousins — est maintenant un lien signalé, compté dans la légende et cliquable.
Déclarer l'union de Paul et Marie (« Rattacher… » → conjoint, ou « Et l'autre parent est… » pendant la
saisie) ramène toujours l'enfant sous la jonction du couple et fait le pointillé disparaître : le trait
signale un lien que la base tient, pas une façon de le dessiner.

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
- La restauration suit la même résolution de dossier, donc elle aussi se teste avec un dossier à
  part : `npm run restore -- --data-dir <dossier> --list`. Sans `--data-dir`, ce sont les archives de
  la maison qui sont listées — et choisies, ensuite.
- Les tests (`npm test`) écrivent chacun dans leur propre dossier temporaire : ils ne peuvent pas
  atteindre une vraie base, et chaque fichier a son processus.
