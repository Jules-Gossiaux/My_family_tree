# Plan de construction

Ce document détaille les passes 0 à 10 et suit l'avancement. La vision et le modèle de données
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
| 5 | Fiche complète : dossier de vie, chronologie, notes | faite, trois restes ouverts ci-dessous |
| 6 | Poster PDF, deux modèles, avec portraits ; cadre de recadrage interactif | à faire |
| 7 | Parenté, questions ouvertes, recherche par surnom, filtres, annuaire | à faire |
| 8 | Export GEDCOM | à faire |
| 9 | Le cloud : Postgres et fichiers chez l'hébergeur, droits dans la base, le front sans serveur, comptes invités | faite (2026-11-02) |
| 10 | Le coffre sur le disque chaque dimanche, et le script qui le rejoue | faite (2026-11-05) |

Les passes 0 à 8 ont été écrites pour une application **locale** : c'est pour cela que leurs cases
citent `server/relations.ts` ou `schema.sql`. La passe 9 a déplacé la base chez l'hébergeur sans
effacer ce qui marchait ; les sections qui suivent disent lequel de ces deux mondes parle.

## Architecture

Deux chemins vivent dans le dépôt, et un seul mène à la famille.

**Le chemin d'aujourd'hui — le front en ligne.** Le navigateur tient tout : la connexion, la lecture,
l'écriture, le dépôt des fichiers. Aucune application ne se tient entre lui et la base.

```
src/                 interface React, compilée et servie par Vercel
  supabase.ts        le client, fabriqué une fois à partir des deux variables publiques
  session.ts         qui est connecté, et donc quelle ligne de family_member il traîne avec lui
  SignIn.tsx         l'écran d'entrée : une adresse e-mail, un lien reçu, un clic
  api.ts             la seule porte vers la base : vue() pour lire, les fonctions SQL pour écrire,
                     le bucket privé pour les fichiers — et l'empreinte sha256 calculée ici
  treeLayout.ts …    les écrans d'avant, inchangés de forme, avec des droits en face
supabase/migrations/ le schéma Postgres, ses fonctions SQL et ses politiques RLS
                     un fichier horodaté par changement, appliqué dans l'ordre, jamais réécrit après
```

**La base fait le travail que le serveur faisait.** Une naissance par personne, un lieu reconnu par son
nom, une source qu'on ne supprime pas pendant qu'on la cite, un doublon de photo reconnu à son empreinte :
ce sont des fonctions SQL appelées par `rpc`. Elles s'exécutent sous les droits de celui qui appelle — donc
un compte en lecture seule qui fabriquerait la requête dans l'onglet réseau se fait refuser par la base,
pas par un bouton grisé.

**Le chemin d'avant, encore là.** `server/index.ts` (Express) et `server/db.ts` (SQLite) servent la même
interface sur `http://localhost:…` quand on ouvre l'arbre depuis le disque. Ça marche, c'est testé, ce
n'est plus le chemin par lequel la famille entre — et la base sur laquelle ça écrit **ne se synchronise
pas** avec celle du cloud.

**Les scripts, qui sont le vrai usage de `server/` aujourd'hui :**

```
cloud.ts         le même accès à la base pour tous : adresse et clé secrètes lues, jamais affichées
import-cloud.ts  la base SQLite et ses médias montés chez l'hébergeur — une seule fois, en 2026-11-02
coffre.ts        descendre l'arbre du cloud sur le disque                  (npm run coffre)
ouvrir-coffre.ts le remonter : --list, --verifier, --retablir               (npm run ouvrir-coffre)
add-member.ts    un compte, sa ligne family_member, son droit d'écrire      (npm run membre)
snapshot.ts      une archive de la base SQLite, à la main et sans serveur  (npm run snapshot)
dates.ts relations.ts branches.ts life-events.ts places.ts sources.ts notes.ts media.ts
backup.ts export.ts restore.ts config.ts db.ts migrations.ts index.ts …  l'ère locale
```

Les dépendances du navigateur se résument à `react`, `react-dom` et `@supabase/supabase-js`, et ce sont
les trois seules que `package.json` tient en production. `express`, `better-sqlite3` et `adm-zip` sont
descendus en `devDependencies` : ils ne servent qu'aux scripts du disque et à l'application d'avant, et un
cousin qui ouvre l'arbre ne les télécharge pas.

Une exception, et elle est voulue : `src/api.ts` importe `server/dates.ts`. La grammaire des dates
françaises n'existe qu'à cet endroit ; le navigateur lit ce qui a été tapé et la base range ce qu'il en a
tiré. La réécrire en SQL donnerait deux règles pouvant dire deux choses différentes du même « vers 1890 ».

## Décisions techniques

| Sujet | Choix | Raison |
|---|---|---|
| Base | **Postgres chez l'hébergeur** (l'application locale, elle, reste sur SQLite) | la famille doit pouvoir écrire sans rien installer ; le disque ne garde que l'import, le coffre et les archives |
| Écriture | Des **fonctions SQL** appelées depuis le navigateur, pas des routes | le front n'a pas à savoir dans quel ordre insérer cinq tables, et une règle se vérifie côté base, donc par n'importe quel client |
| Lecture | Six fonctions de lecture rendant des JSON tout faits (`graph_json`, `state_json`, …), jamais un `select` composé écran par écran | les mêmes écrans ont été gardés de bout en bout : ce qui a changé est le transport, pas la forme des objets |
| L'écran sait où il vit | `state_json` répond `onServer: true`, le serveur local répond `false`, et les écrans se réduisent en conséquence | offrir « choisir le dossier » ou « sauvegarder » à quelqu'un qui est en ligne, c'est poser un bouton qui refuse à chaque clic |
| Droits | RLS : `is_member()` pour lire, `can_write()` pour écrire ; `family_member` ne montre que sa propre ligne ; troisième étage par les privilèges de rôle | celui qui tient la clé publique dans son onglet réseau ne devient pas éditeur pour autant |
| Fichiers | Bucket **privé**, URL signées de courte durée, adresses décidées par `plan_media_upload` | une adresse devinée ne doit pas ouvrir la photo d'un inconnu, et le navigateur ne choisit pas où il range |
| Connexion | Lien envoyé par e-mail, création de compte spontanée éteinte, invitation par `npm run membre` | pas de mot de passe à retenir pour quelqu'un qui ouvre l'arbre trois fois par an, et pas de porte ouverte au premier adresseur |
| Coffre | Descendu du cloud, écrit en `.part`, journal de réussite **et** d'échec, aucune purge automatique | une archive de trop coûte de la place, une archive de moins coûte des ancêtres |
| Rendu de l'arbre | SVG + React | net à l'impression, suffisant à 800 personnes |
| Mise en page | placement post-ordre, parents centrés sur leurs enfants | simple, sans dépendance |
| Identifiants | UUID v4 | pas de collision lors d'une future fusion de bases |
| Dates | jamais un champ `DATE`, toujours min/max/qualifier/texte | la généalogie vit dans l'approximation |
| Table des couples | nommée `couple` et non `union` | `UNION` est un mot réservé SQL |
| Unions | jamais créées sans qu'on les déclare | un enfant rattaché à un parent seul n'implique pas l'existence d'un second parent |
| Refus d'écriture | message en français compréhensible, porté par le code d'erreur SQL (`42501` un droit refusé, `P0002` une cible inconnue, …) et traduit à l'écran | la personne doit savoir quoi faire sans lire une pile d'appels |
| Source citée | ne s'efface pas : `event.source_id` et `media.source_id` n'ont pas de clé étrangère | supprimer quand même laisserait un fait pointant une ligne disparue, et l'écran n'aurait plus rien à montrer à la place de sa source |
| Notes | une seule table `note` avec `target_type` + `target_id`, plutôt qu'une colonne `note` par objet ou cinq tables de notes | la marge d'un acte et celle d'une personne sont la même chose ; une colonne ne peut pas porter de clé étrangère vers cinq tables, donc c'est le serveur qui vérifie la cible et l'effacement qui entraîne les notes |
| Upload des médias | l'objet part **du navigateur vers le bucket**, en octets bruts, l'adresse ayant été rendue par `plan_media_upload` avant le dépôt | pas de passerelle à faire passer par 20 Mo : le serveur d'avant recevait les octets (`express.raw`), aujourd'hui personne ne les revoie |
| Déduplication | empreinte `sha256` de l'original, calculée à l'écriture | la même photo scannée deux fois ne doit pas remplir le dossier ni peupler le bac de deux cases identiques |
| Vignettes | dessinées par le navigateur dans un `<canvas>`, `sharp` écarté | pas de binaire natif de plus à recompiler quand Node change ; le serveur range des octets, il ne décode rien |
| Lecture d'un média | par **URL signée** demandée au moment de l'afficher, jamais par un chemin public | une adresse glissée dans une requête ne doit ouvrir ni un fichier du bucket ni un dossier du disque ; et un lien signé qui meurt ne se transmet pas |
| Emplacement dans le bucket | dans `medias` : `photos/<année>/<id>.<ext>`, `documents/<année>/…`, `vignettes/<année>/<id>.jpg` — la même arborescence que sur le disque | ranger à l'année lue sur le fichier, et retrouver un objet sans ouvrir la base |

## Lancement

**Pour la famille, il n'y a plus rien à lancer.** Une adresse — `https://my-family-tree-virid.vercel.app` —,
un e-mail, un lien reçu, un clic. C'est la seule porte que la mère et les cousins auront à connaître, et
elle ne s'use pas quand Node change de version.

**Sur ce poste**, trois doubles-clics restent, et chacun répare ce dont il a besoin :

- `start.bat` ouvre l'application **locale**, sur la base SQLite d'avant. Le moteur `better-sqlite3` est
  un binaire compilé pour la version de Node installée : le script le détecte
  (`node -e "require('better-sqlite3')"`) et relance `npm rebuild better-sqlite3` avant de démarrer, sinon
  le double-clic n'afficherait qu'une erreur technique illisible. Si le module casse quand même,
  `server/db.ts` affiche la commande à taper au lieu d'une pile d'appels. Le navigateur est ouvert **par
  le serveur**, une fois l'écoute réellement établie (`OPEN_BROWSER=1`) : ouvrir trop tôt afficherait une
  erreur de connexion. Un port déjà pris donne un message en français et une fenêtre qui reste lisible.
  `package.json` déclare `engines: node « 22.x »`, la version que l'hébergeur de site prend pour
  construire ; ce poste roule sous Node 24, et c'est exactement ce décalage que le double-clic répare.
- `coffre.bat` descend l'arbre du cloud sur le disque. C'est lui que la tâche Windows
  `Coffre arbre genealogique` appelle chaque dimanche à 09:00. Il vérifie que `node` est là **avant**
  d'appeler `npm run coffre` et, si le geste échoue, écrit une ligne `ÉCHEC — …` dans
  `sauvegardes\coffre.log` : un dimanche silencieux n'est pas un dimanche réussi.
- `restore.bat` recharge une archive de l'ère SQLite : liste numérotée, numéro tapé, comparaison
  « elle contient / la base actuelle », puis le mot **OUI** à taper. Tout autre texte n'arrive pas
  jusqu'à la base. La liste énumère aussi les coffres, chacun marqué de la commande qui le recharge :
  le dossier tient deux mondes, et choisir un coffre ici n'a rien d'absurde — ça se refuse, en disant
  que la base SQLite attendue n'y est pas.

**Et pour l'arbre en ligne**, deux commandes qui s'assument en terminal, parce qu'elles écrivent chez
l'hébergeur : `npm run ouvrir-coffre` (`--list`, `--verifier`, `--retablir`) pour relire ou rétablir un
coffre, `npm run membre` pour inviter quelqu'un.

## Le dossier de données

Depuis la passe 9, ce dossier ne contient **plus l'arbre** : il contient ce qui a été importé, les
originaux de la boîte à chaussures, et les coffres. Les scripts — `coffre.ts`, `ouvrir-coffre.ts`,
`restore.ts` — lisent la **même** variable `FAMILY_DATA_DIR` que l'application locale, et `coffre.bat`
retombe sur `D:\Genealogie` quand elle n'est pas posée. C'est le seul endroit où le disque et le ciel se
serrent la main, donc le seul endroit où une erreur de chemin se paie deux façons.

Les règles qui suivent sont celles de l'application locale :

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

Ce qui protège l'arbre d'aujourd'hui est **le coffre**, et il ne dépend plus d'un bouton cliqué.

| Moment | Ce qui est archivé | Pourquoi |
|---|---|---|
| Chaque dimanche 09:00 (`coffre.bat`, tâche Windows `Coffre arbre genealogique`) | **tout ce que détient l'hébergeur** : chaque table en JSON, chaque objet du bucket, un manifeste d'empreintes | une semaine de saisie en famille ne doit pas tenir qu'à un seul endroit |
| Avant un `--retablir --remplacer` | un coffre de la base telle qu'elle est à cet instant | le voyage retour se décide avant le départ, pas après |
| `npm run coffre` à la main | idem | avant une manipulation risquée, ou pour vérifier que la porte fonctionne encore |

Un coffre s'appelle `coffre-AAAA-MM-JJ-HHMM.zip` — environ 21,5 Mo pour l'arbre d'aujourd'hui, 74 lignes et
24 fichiers —, il s'écrit en `.part` puis se renomme, et **rien n'est jamais purgé** : le script compte ses
voisins dans le dossier et écrit qu'il n'a rien supprimé.

Deux filets contre le silence, parce qu'une sauvegarde ratée sans personne devant l'écran est pire
qu'une sauvegarde refusée :

- `sauvegardes\coffre.log` reçoit **une ligne par dimanche**, réussie (`coffre-….zip 21.5 Mo 47 ligne(s)
  24 objet(s)`) ou ratée (`ÉCHEC — fetch failed — code 1`, avec le code de sortie). Le chemin de panne est
  testé avec une adresse impossible : aucune archive écrite, la ligne bien posée ;
- `coffre.bat` écrit sa propre ligne d'échec quand le geste ne démarre même pas — `node` introuvable, `npm`
  qui sort en erreur — puisque le journal du script n'existerait pas si le script n'a pas tourné.

**Reste à faire : la copie de la copie.** Le coffre écrit sur le même disque que l'import, donc les deux
meurent ensemble — voir SPEC §11.

### L'ère SQLite, toujours dans le dossier

`server/backup.ts` archiviait base, médias et réglages au démarrage si la dernière archive avait plus de
six heures, puis toutes les trente minutes **seulement si** le compteur `total_changes()` de SQLite avait
bougé — sans lui, chaque vérification produirait une archive identique et chasserait les vingt gardées.
Vingt archives nommées `famille-AAAA-MM-JJ-HHMM-motif.zip`, un échec affiché en bandeau par
`server/notices.ts`, le bouton « Sauvegarder » à la demande, et le **« Copier vers… »** de l'écran Réglages
qui livrait une archive octet pour octet au navigateur (`showSaveFilePicker`, nom validé serveur avant
d'être ouvert, un `..` glissé dans la requête ressortant en 404) : tout cela est de ce monde-là. Les
`sauvegardes\famille-*.zip` en sont les témoins, et le dernier s'appelle
`famille-2026-11-01-1435-avant-cloud.zip` — son nom dit pourquoi il n'a pas de suite.

### Recharger un coffre dans le cloud

`server/ouvrir-coffre.ts` fait le voyage inverse, et ses trois portes sont dans l'ordre où l'on apprend à
les franchir :

1. `--list` range les coffres du plus récent au plus ancien et les **distingue** des archives
   `famille-*.zip` : un dossier qui contient deux mondes ne doit pas les confondre ;
2. `--verifier <archive>` lit le manifeste, contrôle chaque empreinte `sha256` — table par table, fichier
   par fichier — et compare « ce que dit l'archive » à « ce que la base en ligne compte », **sans rien
   écrire**. Une ligne retouchée depuis l'écriture du coffre, une photo rognée de quatre octets, une table
   que le manifeste annonce et que l'archive a perdue : les trois se refusent et se nomment ;
3. `--retablir <archive>` remet les lignes et les fichiers. Deux refus le précèdent : une archive d'un
   **autre projet** — le manifeste porte la référence de l'hébergeur qui l'a vue naître — et une base
   **déjà peuplée**, qui demande `--remplacer` en plus.

Passé ces refus, l'ordre des gestes est le tout du script :

- **le filet d'abord** : le script s'appelle lui-même (`npm run coffre`) et écrit l'état de la base avant
  le premier geste ; il affiche son nom **avant** de toucher quoi que ce soit, et chaque chemin de panne le
  rappelle ;
- **les fichiers avant les lignes**, pour qu'aucune ligne n'annonce une image absente ;
- **les lignes dans l'ordre que les clés étrangères imposent** : `place`, `person`, `branch`, `couple`,
  `parent_child`, `event`, `media`, les tables de rattachement, `name_variant`, `note`, `source`,
  `family_member`, `tree_setting`. Les deux colonnes qui pointent en rond — `person.branch_id` et
  `place.parent_place_id` — sont posées **après coup**, remises ligne par ligne par une correction
  distincte ; sans ce différé, rien ne s'insère ;
- **le contrôle après** : recompter chaque table, vérifier objet par objet (`HEAD` sur le bucket) que le
  fichier est bien là et de la taille dite, et relire l'arbre par `rpc/graph_json` — la fonction que
  l'écran utilise, pas une imitation. Un écart fait sortir en erreur, filet annoncé.

La porte destructive a été franchie une fois pour de vrai, le 2026-11-05 : 47 lignes vidées puis reposées,
24 fichiers redéposés, base identique ligne pour ligne. Les essais qui falsifient une archive
(`tests/coffre-rejeu.test.ts`, douze cas) écrivent leurs propres ZIP dans un dossier temporaire et ne
touchent jamais le vrai dossier familial.

### Recharger une archive SQLite

Compter sur une sauvegarde que l'on n'a jamais su relire, c'est croire qu'on a deux copies.
`server/restore.ts` fait le voyage inverse de l'ère locale, et l'ordre de ses étapes est tout le sujet :

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

### Export JSON (ère locale)

`server/export.ts` écrit tout l'arbre dans un fichier que n'importe quel éditeur ouvre, sans
l'application — le troisième niveau de la spec, celui qui protège d'un logiciel qui disparaît. Il reste
attaché à l'application locale : l'écran en ligne ne l'offre pas, et c'est le coffre qui remplit ce rôle
pour l'arbre d'aujourd'hui.
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

La base qui compte aujourd'hui est celle de l'hébergeur, et elle n'a pas de `schema.sql` vivant : elle se
monte par les fichiers horodatés de `supabase/migrations/`, appliqués dans l'ordre, **un fichier par
changement et jamais réécrit une fois appliqué**. Chacun porte un nom de geste en français —
`regler_la_souche.sql` (le nom porte le mot d'avant, et le fichier appliqué ne se rebaptise pas),
`ecrire_les_fichiers.sql`, `corriger_les_personnes.sql` — parce qu'un fichier que
l'on retrouve trois mois plus tard doit dire ce qu'il réglait, pas seulement à quelle heure. Le schéma
résultant se relit par `--verifier` d'un coffre, qui compare les comptes table par table à ce schéma-là.

Deux conséquences valent d'être écrites :

- une correction ne se fait pas en modifiant le fichier du départ : elle s'écrit dans un fichier neuf, qui
  `alter table` ou remplace la fonction. C'est ce qui permet à la base de la maison et à celle du ciel
  d'avoir traversé les mêmes étapes dans le même ordre ;
- **le cloud est né avec les corrections que la base locale a dû migrer.** Là où `server/migrations.ts` a
  dû rattraper une base déjà peuplée, `20261101155242_arbre_en_ligne.sql` pose d'emblée `partner_a` et
  `partner_b` en `on delete set null`, de même que `branch.root_person_id` et `tree_setting.root_person_id` :
  les deux leçons de l'ère locale étaient sues au moment d'écrire la nouvelle table.

`schema.sql` est écrit avec des `CREATE TABLE IF NOT EXISTS` : il pose les tables d'une base neuve
mais ne rattrape pas une base déjà créée. Les ajustements de l'application locale passent donc par
`server/migrations.ts`, et `PRAGMA user_version` sert de calendrier — une migration ne se rejoue
pas, et une base ancienne traverse les versions dans l'ordre.

**Migration 1 — un couple survit à la suppression d'un de ses membres.** Avant, `partner_a` et
`partner_b` étaient en `ON DELETE CASCADE` : effacer une personne mal orthographiée détruisait son
union, ses actes de mariage, et par `SET NULL` la mémoire de l'union dont venaient les enfants. Les
deux colonnes passent en `ON DELETE SET NULL`, et `couple` n'est supprimée par
`pruneEmptyCouples()` que quand plus rien ne la justifie — ni un enfant, ni un acte, ni un membre.

## Les gestes, côté base

Le navigateur ne compose aucune requête sur les tables. `src/api.ts` appelle des fonctions SQL par `rpc`,
et c'est tout ce que l'interface sait faire de la base. Ce fut le seul changement sous les écrans : ils
n'ont pas eu à être repris, les fonctions rendant exactement les objets de `shared/types.ts`, `camelCase`
compris.

**Lire** — six fonctions, une par ce que l'écran montre, toutes `security invoker` :

| Fonction | Ce qu'elle rend |
|---|---|
| `state_json` | les comptes, la personne de référence, `onServer`, et ce que l'écran affiche comme lieu de l'arbre : `dataDir` y vaut littéralement « En ligne » |
| `graph_json` | personnes, couples, liens parent-enfant, branches — l'arbre entier en une passe |
| `person_detail_json` | la fiche : relations, vie triée, médias, notes, surnoms, lien avec « moi » |
| `places_json` · `sources_json` | les noms et les références déjà écrits, pour les proposer plutôt que les recopier |
| `unattached_media_json` | le bac d'entrée : les fichiers que personne ne réclame |

Un compte qui n'est pas de la famille reçoit des tableaux vides, pas une erreur à afficher — c'est RLS qui
décide, la fonction n'ayant rien à savoir.

**Écrire** — un geste, une fonction. Toutes celles que l'écran appelle posent d'abord, en français, le
refus à qui n'a pas le droit d'écrire (`Vous consultez cet arbre sans droit de modification.`, en code
Postgres `42501`). Quatre aides internes — `upsert_couple`, `link_parent_child`, `set_person_date`,
`prune_empty_couples` — ne portent pas la phrase : l'écran ne les appelle jamais directement, elles ne
courent qu'à l'intérieur d'un geste déjà gardé. `set_me` s'en passe, puisqu'il ne touche que la ligne du
compte qui le demande. Ce que chaque domaine garantit en plus de cela :

| Domaine | Fonctions | Ce qu'elles garantissent, outre ce que garantissait la route d'avant |
|---|---|---|
| Personnes | `create_person`, `update_person`, `delete_person`, `attach_relation`, `set_portrait`, `set_person_date` | une naissance et un décès par personne, deux parents au plus, pas de boucle. Aucune de ces fonctions n'écrit la personne de référence : effacer celle-ci la rend à `null` par la clé étrangère, et rien d'autre |
| Unions | `upsert_couple`, `link_parent_child`, `attribute_children_to_couple`, `prune_empty_couples` | une union n'existe que déclarée ; la déclarer rend aux enfants déjà nés des deux leur `couple_id` |
| Branches | `create_branch`, `update_branch`, `branch_descendants`, `delete_branch`, `assign_descendants`, `free_branch_color` | une teinte libre, une tête qui désigne une personne existante, et aucune case déplacée qui était déjà rangée ailleurs |
| Faits | `create_event`, `update_event`, `delete_event` | un sujet — personne **ou** union —, le lieu par son nom, et des dates qui ressemblent à des dates. La grammaire française, elle, reste lue par le navigateur |
| Lieux | `update_place`, `delete_place` | renommer suit ce qui pointait déjà ici ; effacer rend les faits et les fichiers à un lieu inconnu sans rien effacer d'eux |
| Sources | `create_source`, `update_source`, `delete_source` | une référence prise est refusée et nomme le genre de la ligne qui la porte ; une source citée ne s'efface pas, et le refus compte les citations |
| Notes | `create_note`, `update_note`, `delete_note` | la cible doit exister ; corriger ne change pas la date, la base n'en garde qu'une |
| Fichiers | `plan_media_upload`, `create_media`, `set_media_thumbnail`, `media_thumb_key`, `patch_media`, `delete_media`, `attach_media`, `detach_media` | l'empreinte dite avant l'envoi, l'adresse décidée par la base, les octets vérifiés après le dépôt, et une course perdue rendue propre (`create_media` répond `deduped`, le navigateur retire ce qu'il avait posé) |
| Réglages | `set_root`, `set_me` | le premier exige un droit d'écrire ; le second n'exige que d'être de la famille, puisqu'il ne pose que la ligne du compte qui le demande |

**Trois gestes refusés en ligne**, et dits comme tels plutôt que laissés à un bouton qui échouerait :
écrire une archive, lister les archives, choisir le dossier de données. Ce que le disque savait faire n'a
plus de sens depuis une adresse — `src/api.ts` le dit par une seule fonction, `seulementSurLeDisque()`.

## Contrat d'API de l'ère locale (passes 0 à 5)

Les routes ci-dessous sont celles du serveur Express que `start.bat` utilise encore. Rien en ligne ne les
appelle ; elles sont gardées parce qu'elles décrivent les mêmes règles, et que les tests de l'application
locale les tiennent.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/state` | dossier de données, statistiques (personnes, couples, médias, médias à rattacher), personne racine, personne « moi », dernière archive, avertissements |
| GET | `/api/graph` | personnes, couples, liens parent-enfant, branches, en une requête |
| GET | `/api/persons/:id` | fiche complète : relations, vie triée du plus ancien au plus récent, médias et notes de la personne |
| POST | `/api/persons` | création, avec rattachement optionnel |
| POST | `/api/persons/:id/relations` | rattacher deux personnes déjà dans la base |
| PATCH | `/api/persons/:id` | modification, `portraitMediaId` et `branchId` compris (mettre `null` retire le portrait, rend la personne au hors-classe) |
| DELETE | `/api/persons/:id` | suppression ; la personne de référence repart d'une personne qui existe encore, « moi » s'éteint |
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
| PUT | `/api/config` | `rootPersonId` (la personne de référence) et `mePersonId` (« moi »), réglés séparément : un champ absent laisse ce qui est écrit, `null` le retire, une id inconnue est refusée en 400 sans rien déplacer |
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
- [x] réglage « moi », distinct de la personne de référence : « C'est moi » dans le menu d'une personne, une ligne dans
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

## Passe 9 — l'arbre en ligne

- [x] `20261101155242_arbre_en_ligne.sql` : les quatorze tables en Postgres, avec les corrections que
  l'ère locale avait dû migrer, les deux fonctions de droit et les politiques RLS — lecture pour la
  famille, écriture pour ceux qui y ont droit, et chacun ne voit que sa propre ligne de compte
- [x] six fonctions de lecture rendant les objets tout faits des écrans (`ecran_en_ligne.sql`), et le
  retrait de `execute` à `public` et `anon` : la clé que le navigateur embarque ne lit plus rien sans compte
- [x] l'écriture portée par des fonctions SQL, groupe par groupe : les faits, les personnes, leur
  correction, les marges (notes, lieux, sources), les branches, les fichiers, « moi »
- [x] `src/supabase.ts`, `src/session.ts`, `src/SignIn.tsx` : le lien reçu par e-mail, le compte qui se
  reconnaît à sa ligne `family_member`, et l'écran qui dit ce qui manque plutôt que de tourner en rond
- [x] `src/api.ts`, la seule porte : lire par `rpc`, écrire par `rpc`, les fichiers par URL signées d'une
  heure, et trois gestes du disque refusés en ligne avec leur raison écrite
- [x] le dépôt d'un fichier en trois temps : `plan_media_upload` dit l'empreinte et l'adresse, le
  navigateur pose les octets dans le bucket privé, `create_media` contrôle la taille enregistrée puis écrit
  la ligne — un doublon est rendu, pas dupliqué
- [x] `server/import-cloud.ts` : la base SQLite et ses 24 fichiers montés chez l'hébergeur, une seule fois
- [x] `server/add-member.ts` (`npm run membre`) : le compte invité, sa ligne, son droit d'écrire, et
  `--liste` pour relire qui est dedans
- [x] le déploiement : Vercel sur `main`, l'artefact `dist/` que plus personne n'a à héberger soi-même
- [x] la base en ligne relue sans écran : `--verifier` et `rpc/graph_json` rendent les mêmes lignes et les
  mêmes objets que le coffre posé sur le disque, et la personne de référence à `null` comme état normal
- [ ] la preuve vécue : la mère entrée par son lien et écrivant, le cousin en lecture seule refusé avec un
  message qu'il comprend — invitation vers le 2026-11-11
- [x] le refus dit en français **partout** : `create_event` et `delete_event` laissaient encore parler
  RLS en anglais quand un compte sans droit d'écrire tente un fait de la vie ; la migration
  `20261107232621 dire_le_refus_en_francais` leur pose la phrase comme aux autres (`delete_event` est
  passée à `plpgsql` pour pouvoir la lever), éprouvée sur la base en ligne dans les deux sens

## Passe 10 — le coffre sur le disque

- [x] `server/coffre.ts` (`npm run coffre`) : chaque table en JSON, chaque objet du bucket, un manifeste
  d'empreintes, un ZIP écrit en `.part` puis renommé, et rien de purgé
- [x] la tâche Windows `Coffre arbre genealogique`, chaque dimanche à 09:00, par `coffre.bat`, qui écrit sa
  propre ligne d'échec quand `node` est introuvable — le journal du script n'existerait pas sinon
- [x] `sauvegardes\coffre.log`, une ligne par dimanche, réussie ou ratée ; le chemin de panne éprouvé sur
  une adresse impossible
- [x] `server/ouvrir-coffre.ts` : `--list`, `--verifier`, `--retablir`, dans l'ordre où l'on apprend à les
  franchir, avec le filet écrit avant le premier geste et le contrôle après le dernier
- [x] la porte destructive éprouvée sur la vraie base (2026-11-05) : 47 lignes et 24 fichiers repartis
  d'aplomb, `graph_json` relu, et `root_person_id` toujours vide après le voyage
- [x] `tests/coffre-rejeu.test.ts` : douze cas, chacun dans un dossier temporaire, sans réseau
- [ ] la copie de la copie : le coffre et les originaux sur deux supports qui ne meurent pas ensemble
  (SPEC §11)

## Limites connues

Ce qui manque encore, avec le fil qui le reprend. Les neuf premiers traits manquent à l'arbre **quel que
soit l'endroit d'où on le regarde** ; les suivants regardent un des deux mondes.

- **Aucun recadrage.** Les colonnes `crop_x`, `crop_y` et `crop_size` de `media_person` sont vides :
  le portrait est l'image entière, telle quelle. Le cadre de recadrage interactif appartient à la
  passe 6, parce que c'est le poster qui a besoin d'un visage centré, pas la fiche.
- **La date d'un média vient du fichier, pas de l'image.** `takenOf()` lit `file.lastModified`, pas
  l'EXIF : une photo de 1911 scannée en 2020 arrive datée de 2020. Elle se corrige dans la visionneuse
  (« Date lue sur le fichier »), et le dossier garde ses quatre colonnes de date floue.
- **Une vignette qui n'a pas pu être dessinée ne se rattrape pas.** Elle se dessine à l'entrée, par le
  navigateur, et personne ne la refait ensuite : la base comme le serveur d'avant ne décodent aucune
  image. Un JPEG que le navigateur n'a pas su réduire reste un carré vide, avec son nom en travers. Le
  fichier original, lui, est bien là.
- **Le bac ne voit que les personnes.** Une image rattachée à un événement (`media_event`) n'a encore
  aucun écran, dans aucun des deux mondes, et le compte de fichiers affiché sur une ligne de chronologie
  reste donc à zéro.
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
  nom que la famille connaît. Ce n'est pas un `OR` à ajouter côté client — ni `graph_json` ni `/api/graph`
  ne renvoient les surnoms, seuls les portent les personnes détaillées. À traiter avec l'annuaire de la
  passe 7, qui aura de toute façon besoin de chercher dans ces noms-là.
- **Supprimer une personne rend ses photos au bac.** `media_person` est en `ON DELETE CASCADE`, sur le
  disque comme en ligne : les fichiers restent en place, les médias retournent dans « à rattacher », mais
  recréer la personne ne repeuple pas sa galerie — il faut les rattacher à nouveau.
- **Écrire à deux ne se concilie pas.** Aucune fonction d'écriture ne compare ce qui était écrit avant :
  deux onglets ouverts sur la même fiche, le second enregistrement remplace le premier sans prévenir et
  sans afficher de désaccord. Il n'y a ni verrou, ni historique de ligne. C'est le prix assumé d'un arbre
  que la famille garde simple (SPEC §11).

Côté **disque**, les limites de l'application locale restent celles qu'elle s'était données :

- **Poser un fichier dans le dossier ne l'importe pas.** Seule l'écriture par l'écran pose à la fois une
  ligne et ses octets : copier un JPEG dans `D:\Genealogie\medias\` ne fait ni une ligne SQLite, ni une
  photo de l'arbre en ligne. Le tas d'originaux de la boîte à chaussures est donc un dépôt, pas une
  cinquième sauvegarde, et rien ne signale le désaccord.
- **La restauration ne se commande pas depuis l'écran.** Elle passe par `restore.bat`, application fermée :
  le serveur tient la base ouverte et remplacer ce sur quoi il est assis produirait un arbre à moitié
  écrit. L'écran Réglages le dit sous la liste des archives, avec les quatre gestes à faire. Un bouton
  « Restaurer » supposerait de redémarrer le serveur de l'intérieur, ou de passer par un fichier de
  consigne appliqué au démarrage — deux choses à construire en même temps que l'écran qui les montre, pas
  avant.
- **Une restauration ne supprime aucune photo.** Les médias de l'archive sont ajoutés à ceux du dossier,
  jamais l'inverse : les images supprimées depuis l'archive reviendraient avec leur ligne, mais celles
  ajoutées après restent en place même si plus personne ne les réclame.
- **L'export JSON ne porte pas les images**, seulement leurs chemins et leurs légendes : c'est un fichier
  de données, pas une archive. Les pixels vivent dans le ZIP. Il reste un geste du disque — l'écran en
  ligne ne l'offre pas, et ce qui protège l'arbre en ligne d'un logiciel qui disparaît est le coffre, dont
  chaque table se relit en JSON.

Côté **ciel**, trois limites viennent de ce que la base est chez un hébergeur et non sur la table du
salon :

- **Redéposer un coffre ne vide pas le bucket.** `--retablir` écrit les lignes de l'archive et ses objets,
  et ne retire pas les objets que l'archive ne nomme pas : une photo ajoutée après le coffre survit en
  octets sans ligne, et aucun écran ne compte ces orphelins. Le bucket grossit donc lentement, sans que
  l'arbre ne s'écarte de l'archive.
- **Recharger un coffre ne se fait pas depuis l'écran**, et ne se fera pas : la commande tient la clé
  secrète, et une porte d'écriture massive ouverte dans un navigateur serait une porte pour tout le monde.
  Elle reste un geste en terminal, avec le mot `OUI` du `restore.bat` local remplacé par `--remplacer`.
- **Une archive contrôlée n'est pas une archive juste.** `--verifier` contrôle les empreintes et les
  comptes, pas que l'arbre qu'elle contient est celui que l'on croyait : une fausse manœuvre de saisie
  vieille de trois semaines revient intacte. La comparaison annoncée avant de remplacer (combien de
  personnes ici, combien là) est ce qui doit faire tiquer.

Résolu : une personne ayant plusieurs unions n'apparaît plus qu'une seule fois, ses conjoints étant
dessinés dans le même bloc `[conjoint] [personne] [conjoint]`.

Résolu en passe 3 : le trait qui traversait l'arbre sans rien dire — l'enfant de deux parents solos, la
boucle d'un mariage entre cousins — est maintenant un lien signalé, compté dans la légende et cliquable.
Déclarer l'union de Paul et Marie (« Rattacher… » → conjoint, ou « Et l'autre parent est… » pendant la
saisie) ramène toujours l'enfant sous la jonction du couple et fait le pointillé disparaître : le trait
signale un lien que la base tient, pas une façon de le dessiner.

À assumer, ce n'est pas un bug : supprimer une personne emporte ses liens de parenté. Ses enfants
gardent l'autre parent et l'union dont ils sont issus, mais le parent effacé ne revient que par un coffre
— ou, pour l'arbre de l'ère locale, par une archive.

## Conventions

- Interface et code en français pour les libellés, anglais pour les noms de variables et de tables
  (cohérence avec l'écosystème, lisibilité pour un futur contributeur). Les fichiers de migration
  écrivent leurs commentaires en français, mais sans les accentuer : un `é` perdu entre un éditeur et
  une console ne doit pas rendre un schéma illisible.
- **Ni donnée familiale, ni secret dans le dépôt.** Le dossier de données est hors du projet. La clé
  secrète, l'adresse de connexion Postgres et la clé d'envoi des invitations vivent dans `.env.local`,
  qu'`.gitignore` couvre par `.env.*`. Deux choses sont publiques parce que c'est un choix assumé :
  l'adresse du projet et la clé publishable, que le navigateur embarque — et RLS garde la porte à leur
  place.
- Les tests (`npm test`) écrivent chacun dans leur propre dossier temporaire et sur SQLite : ils ne
  peuvent pas atteindre une vraie base, et **aucun ne joint l'hébergeur** — `coffre-rejeu.test.ts`
  fabriquerait une fausse adresse plutôt que d'appeler la bonne. Ce qui vérifie la base en ligne est
  ailleurs : `npm run ouvrir-coffre -- --list` énumère les coffres, `--verifier` compare ses comptes à
  ceux d'un coffre table par table.
- Pour tester l'application **locale** sans toucher aux vraies données, on démarre sur un dossier
  temporaire : `FAMILY_DATA_DIR=<dossier vide hors du projet> PORT=4599 npm start`. Sans ces deux
  variables, `npm start` ouvre `D:\Genealogie`, c'est-à-dire l'arbre de la maison.
- La restauration de l'ère locale suit la même résolution de dossier, donc elle aussi se teste avec un
  dossier à part : `npm run restore -- --data-dir <dossier> --list`. Sans `--data-dir`, ce sont les
  archives de la maison qui sont listées — et choisies, ensuite.
- **Un script qui écrit chez l'hébergeur ne se lance pas « pour voir »** : la base visée est celle où la
  famille saisit. Chacun offre d'abord une porte qui ne touche à rien — `ouvrir-coffre -- --list`,
  `--verifier`, `membre --liste` — et la porte qui remet tout en place refuse une base déjà peuplée tant
  que `--remplacer` n'y est pas ajouté. Ce qui efface se nomme dans la
  commande même, donc dans l'historique du terminal : c'est ce qui remplace le mot `OUI` du `restore.bat`
  local, et le fichier de migration déjà appliqué ne se retouche pas pour la même raison.
