# Arbre généalogique familial — spécification

> Statut : **en discussion** pour ce qui reste à construire, rien n'est figé. Les points marqués
> `[À VALIDER]` attendent une réponse. Ce qui est construit et comment : [`BUILD.md`](BUILD.md).

## 1. Objectif

Une application **locale, personnelle et gratuite** pour conserver et explorer l'histoire d'une **famille entière** :
visualiser toutes les branches et tous les cousins, rassembler photos, documents et notes autour de chaque
personne, et produire des objets durables (poster imprimable, livre PDF).

Ce n'est pas l'arbre d'une personne : c'est celui d'une famille. L'utilisateur en est le gardien, pas le centre.

## 2. Non-objectifs

- Pas de cloud, pas de synchronisation, pas de collaboration temps réel.
- Pas de génération automatique de récits par IA : une biographie inventée est pire qu'une case vide.
- Pas de réseau social familial, pas de partage public.
- Pas de dépendance à un service tiers qui pourrait disparaître.

## 3. Contraintes

| Contrainte | Conséquence |
|---|---|
| 100 % gratuit | Uniquement des bibliothèques open source, aucun service payant, aucune clé API |
| Local | Tout dans un dossier choisi par l'utilisateur ; fonctionne hors ligne |
| Durable (20 ans) | Format ouvert (SQLite + JPEG/PNG), export JSON, sauvegardes datées |
| Volume | 300 à 800 personnes, quelques milliers de médias → SVG suffit, pas de WebGL |
| Débutant acceptable | Un `start.bat` pour ouvrir l'arbre, un `restore.bat` pour recharger une archive, une fenêtre de navigateur, zéro terminal |

## 4. Ce que « l'arbre de la famille » change

C'est la décision structurante du projet, et elle contrarie l'intuition habituelle.

### 4.1 Pas de racine unique, mais une souche

Un arbre ascendant part d'une personne et ne remonte qu'une ligne : il ne peut pas montrer les cousins.
Pour voir la famille, il faut partir du **couple souche** (le plus ancien ancêtre commun connu) et
**descendre** : chaque enfant, puis ses enfants, etc. Les cousins apparaissent alors naturellement.

- La **souche** est configurable : le menu d'une personne et l'écran Réglages disent qui est « la personne
  de référence », et l'arbre descend de là. **Un seul couple souche à la fois** aujourd'hui — la base ne
  connaît qu'un `rootPersonId`. Que la famille ait plusieurs origines est réel, et le modèle le permettra
  (plusieurs souches = plusieurs arbres de descendance sur les mêmes données), mais ce n'est pas encore
  écrit.
- L'utilisateur est un **point de vue**, pas la structure. Ce point de vue a un nom dans les réglages :
  **« moi »**, et il est **distinct de la souche**. L'arbre descend de la souche ; les phrases du type
  « cousin issu de germain, par les Gossiaux » partent de la personne que chacun se choisit. Confondre
  les deux, c'est dessiner la famille autour d'un seul individu et perdre le principe du §1.
  Le réglage est écrit : `mePersonId` dans `config.json`, posé par le menu d’une personne (« C’est moi »)
  ou par les Réglages, et retiré de là. Centrer la vue reste possible sur n'importe qui.
- Un chemin est toujours calculable entre deux personnes reliées : c'est une propriété des données, pas
  encore un écran. Le calculateur de parenté du §4.5 est ce qui le dira en mots.

### 4.2 Le couple est l'unité de dessin

Un individu seul ne suffit pas : un cousin est l'enfant d'un **couple**. On dessine donc des blocs
« union » avec les enfants accrochés en dessous, et non des flèches d'individu à individu.
C'est la seule représentation qui survive aux familles recomposées (un parent, deux unions, des
demi-frères de chaque côté).

C'est en place, avec une nuance qui a son prix : **une case par personne**, les conjoints alignés autour
d'elle dans le même bloc `[conjoint] [personne] [conjoint]`. Sans cette règle, une personne à trois unions
apparaissait trois fois et chaque doublon se croyait une autre personne.

### 4.3 Le graphe peut contenir des cycles

Deux cousins qui se marient créent une boucle : le graphe cesse d'être un arbre. Le moteur de mise en
page doit **casser le cycle** (choisir un arbre couvrant) et signaler le lien supplémentaire par un
trait discret, sans planter ni boucler à l'infini. Cas réel dans toutes les grandes familles.

De ces trois exigences, les trois tiennent. La mise en page ne plante pas et ne boucle pas ; une écriture
qui créerait une boucle est refusée en 409 ; et un lien que la descendance ne peut pas dessiner — une boucle
déjà présente dans la base, un enfant dont la case est dessinée sous un autre bloc, une union dont les deux
cases vivent chacune ailleurs — sort du calcul sous le nom de `crossLink` et se trace **en pointillés**, du
bas de la case du parent au haut de celle de l'enfant, ou de bord à bord pour une union. Une légende, en bas
à gauche du canevas, compte ces traits et dit de quoi il s'agit ; chacun se clique et ouvre la fiche de la
personne visée. Se taire là-dessus ferait croire que la famille ne contient pas ces liens.

Une règle commande le tout : **une personne a une seule case**. Un enfant réclamé par deux blocs n'est
placé que par le premier — sinon ses deux cases se croiraient deux personnes différentes et la largeur du
sous-arbre serait comptée deux fois. Le bloc qui voit son conjoint déjà posé ailleurs ne le duplique pas.

### 4.4 Il y a des branches orphelines

On découvre souvent « la cousine germaine de mamie » sans savoir où l'accrocher. L'application doit
accepter des **personnes et des groupes non rattachés**, visibles dans un espace dédié, en attente
d'être connectés. Refuser cette possibilité, c'est obliger à inventer des liens faux. **En place** : les
non rattachés sont dessinés à part, et le bouton « Rattacher… » relie deux personnes déjà saisies sans
jamais inventer le conjoint qui manque. Une branche non rattachée se pose dans un ordre qui compte : les
personnes qui n'ont aucun parent connu deviennent racines **avant** les autres, sans quoi un enfant posé le
premier deviendrait sa propre branche et perdrait la descendance de son parent.

### 4.5 La parenté se calcule, elle ne se devine pas

Avec 400 personnes, personne ne sait dire spontanément ce qu'est « le petit-fils de la sœur de mon
arrière-grand-père ». Le calculateur de parenté (« cousin issu de germain », « arrière-petite-cousine »)
n'est pas un gadget : ce sera la fonction la plus consultée du logiciel.

Il est rangé en **passe 7**, et non en v1 comme l'écriture de cette spec le promettait. Ce n'est pas un
désintérêt : c'est qu'il a deux dépendances que rien d'autre n'exige. Il lui faut un « moi » (§4.1) — le
réglage et les deux écrans qui le posent sont écrits depuis la passe 3 ; et il lui faut des liens stables,
alors que la saisie — les couples déclarés, les demi-frères, les branches à rattacher — change encore de
forme passe après passe. Une parenté calculée trop tôt s'affiche faux souvent, et le doute qu'elle installe
coûte plus qu'elle ne rend. La ligne « comment elle est liée à toi » de la fiche (§8.2) attend donc la
passe 7 : la fiche montre aujourd'hui les liens directs — parents, conjoints, enfants — et n'interprète rien.

## 5. Stack

- **Node.js + TypeScript**, serveur HTTP unique servant l'API et le front déjà compilé
- **SQLite** via `better-sqlite3` — un seul fichier, sauvegarde triviale
- **React + Vite**, rendu des arbres en **SVG** (pas de canvas pour l'arbre)
- **Vignettes générées côté navigateur**, dans un `<canvas>`, à l'import d'un média. `sharp` est écarté :
  c'est un binaire compilé pour la version de Node installée, donc une mise à jour de Node le rend
  chargeable — le `start.bat` teste et rebâtit déjà SQLite, il n'a pas à porter un second module natif.
  Le canvas suffit à quelques milliers d'images et lit l'orientation EXIF sans rien réécrire
  (`createImageBitmap(file, { imageOrientation: 'from-image' })`).
- **Leaflet + OpenStreetMap** pour la carte (v2)
- Export PDF du poster : **pdf-lib** ou impression navigateur haute résolution. La passe 6 tranche ;
  aucune des deux pistes n'est encore une dépendance du projet

Toutes ces dépendances sont sous licence libre (MIT / Apache-2.0 / domaine public). Le projet n'en compte
aujourd'hui que cinq (`better-sqlite3`, `express`, `react`, `react-dom`, `adm-zip`) : chaque ajout doit
payer sa place.

## 6. Stockage des données — décision

### 6.1 Principe

**Le code est public, les données sont privées.** Le dépôt GitHub ne contient que du code.
Aucune donnée familiale, aucun nom, aucune photo ne doit jamais y entrer : c'est une règle absolue,
et le `.gitignore` est écrit en conséquence.

Les données vivent donc **hors du dépôt**, dans un dossier unique, choisi par l'utilisateur.

### 6.2 Emplacement retenu

```
D:\Genealogie\
├── data\famille.db            base SQLite (plus ses -wal et -shm tant qu'elle est ouverte)
├── medias\
│   ├── photos\1923\...        originaux, jamais retouchés, rangés à l'année lue sur le fichier
│   ├── documents\1923\...     scans d'actes, lettres, livrets — même rangement que les photos
│   └── vignettes\1923\...     générées par le navigateur, supprimables
├── scans_bruts\               les scans tels quels, jamais modifiés
├── sauvegardes\               ZIP datés automatiques
├── exports\                   posters, livres
└── config.json                paramètres locaux (souche, « moi », préférences)
```

**Pourquoi ici :**

| Raison | Détail |
|---|---|
| Hors du dépôt | Le repo est sur GitHub ; les données ne doivent jamais y être |
| Chemin court | Windows limite à 260 caractères ; `D:\Genealogie\medias\photos\1923\` laisse de la marge |
| Disque adapté | `D:` a 591 Go libres, et le projet y est déjà |
| Un seul dossier à sauvegarder | Copier `D:\Genealogie\` suffit à tout préserver |
| Survit au code | Supprimer le dépôt ne détruit pas vingt ans de photos |
| Trouvable | Un dossier à la racine du disque se retrouve dans l'explorateur sans chercher |

Le chemin est enregistré dans `config.local.json` (ignoré par git), modifiable depuis l'écran Réglages.
Le serveur crée les huit dossiers ci-dessus au démarrage, avec `D:\Genealogie` pour repli sous Windows ;
sur un système où rien ne peut être deviné, il s'arrête en écrivant les deux façons d'indiquer le dossier.
`exports\` reste vide tant que la passe 6 n'y écrit pas son poster. `scans_bruts\` n'appartient qu'à
l'utilisateur : l'application n'y écrit jamais, et un import qui part de là **copie**, ne déplace rien —
la boîte à chaussures reste la source.

Deux chemins sont refusés à l'écran, parce qu'ils coûteraient plus tard : un dossier rangé **dans le dépôt**
— une famille versionnée par accident — et **la racine d'un disque** (`D:\` plutôt que `D:\Genealogie`).

### 6.3 Sauvegarde

Une copie sur le même disque ne protège de rien. Trois niveaux, et les trois existent :

1. **ZIP automatique** dans `sauvegardes\` : base, médias et réglages, nommés
   `famille-AAAA-MM-JJ-HHMM-motif.zip`. À l'ouverture quand la dernière archive a plus de six heures, puis
   toutes les trente minutes dès que la base a vraiment été écrite, et sur le bouton « Sauvegarder ».
   Vingt archives gardées ; chacune s'écrit dans un `.part` puis se renomme, pour qu'une coupure laisse
   l'archive précédente entière et jamais une archive à moitié écrite. Un échec s'affiche en bandeau :
   une sauvegarde que l'on croit avoir est pire qu'une sauvegarde refusée.
2. **Copie sur un support externe** — la seule vraie sauvegarde. L'écran Réglages liste les archives et
   chacune se livre octet pour octet au navigateur par **« Copier vers… »** : la fenêtre d'enregistrement
   s'ouvre, la copie quitte le disque. Le nom demandé est validé serveur avant d'être ouvert, un `..`
   glissé dans la requête ressort en 404.
3. **Export JSON** lisible sans l'application, en cas de catastrophe logicielle. Il porte les personnes,
   les couples, les liens, les événements, les notes, les sources et les chemins des médias — pas les
   pixels, qui vivent dans le ZIP. Une date y garde ses quatre colonnes : une date floue exportée en
   `1920-01-01` serait une date inventée.

### 6.4 Recharger une archive

Cela se commande **hors de l'application**, parce qu'aucun programme ne remplace proprement la base sur
laquelle il est assis. `restore.bat` — ou `npm run restore -- --list` — dresse la liste des archives,
lit celle qu'on choisit dans un fichier temporaire, contrôle son intégrité et ses tables, compare « elle
contient » à « la base actuelle », et demande de taper `OUI`. Ce n'est qu'après : copie de sûreté de
ce qui est en place, l'échange par renommage (jamais une écriture par-dessus), les journaux `-wal` et
`-shm` périmés effacés, et les médias de l'archive **ajoutés** à ceux du dossier — une restauration ne
supprime aucune photo. Ce qui est installé est relu sur le disque et les chiffres affichés viennent de là.

Trois règles à garder : une archive qui échoue au contrôle n'est pas installée ; une archive contrôlée
n'est pas une archive juste — elle dit ce qu'elle contient, pas si ce contenu était vrai ; et la copie de
sûreté rend le voyage retour possible même après un choix regrettable.

## 7. Modèle de données

### 7.1 Dates floues

Une date n'est **jamais** un champ `DATE`. En généalogie on ne sait presque jamais avec précision.

```
date_min       TEXT   -- ISO 8601 partiel : "1920", "1920-03", "1920-03-14"
date_max       TEXT   -- pour les fourchettes
date_qualifier TEXT   -- exact | about | before | after | between | unknown
date_text      TEXT   -- ce qui est écrit tel quel : "vers 1920", "avant-guerre"
```

`date_min = date_max` + `exact` → date certaine. `about` → « vers ». `between` → fourchette.
L'affichage choisit la formulation, la base ne ment jamais.

À la saisie, une seule case texte suffit : `server/dates.ts` y lit « avant 1900 », « av. 1900 »,
« après 1945 », « vers 1920 », « environ 1870 », « circa 1870 », « ~1900 », « entre 1914 et 1918 »,
« entre 1914-1918 », et les formes partielles « 1920 », « 1920-03 », « 1920-03-14 » — accents et ponctuation
indifférents. Ce qu'elle ne comprend pas n'est pas jeté : « après-guerre 1945 » ressort tel quel en
`date_text` avec `unknown`, et une date que la machine ne sait pas interpréter est une date que l'on peut
encore relire. Une date que la machine a effacée est perdue.

### 7.2 Tables

**person** — `id`, `given_names`, `family_name`, `birth_name`, `sex`, `living`,
`portrait_media_id`, `summary`, `branch_id`, `created_at`, `updated_at`

**name_variant** — `person_id`, `name`, `type` (alias / orthographe / **surnom**).
Indispensable dans une grande famille : « Tata Michèle » est le seul nom que tout le monde connaît.

**branch** — `id`, `name`, `color`, `root_person_id`. Les branches (paternelle, maternelle,
famille alliée) colorent l'arbre et servent de filtre. **Retenu** : indispensable à 400 personnes
pour s'y retrouver d'un coup d'œil.

Quatre règles la tiennent debout :

- **une personne ne porte qu'une branche** (`person.branch_id`) : la teinte d'une case doit se lire sans
  ambivalence ;
- **une branche ne vole pas ses gens à une autre branche** : ranger la descendance d'une personne laisse
  en place celles qui ont déjà été classées à la main ;
- **deux branches ne portent ni le même nom ni la même teinte** : le nom seul les distingue, et deux
  lignes de la même couleur se lisent comme une seule. Le refus dit laquelle reprendre ;
- **la tête de ligne est une personne, pas un identifiant au hasard** : `root_person_id` est en
  `ON DELETE SET NULL` — effacer la personne dont partait une branche la laisse debout et en quête d'une
  autre tête, au lieu de laisser en base une référence qui ne désigne plus personne (migration 2).

**place** — `id`, `name`, `lat`, `lon`, `parent_place_id`. Hiérarchie ville → département → pays.

Trois règles, parce qu'un lieu se tape plus souvent qu'il ne se règle :

- **le nom seul désigne le lieu** : un fait qui écrit « Roubaix » trouve la ligne qui porte déjà ce nom,
  ou la pose si personne ne l'a encore écrit. Sans quoi trois orthographes d'un même village font trois
  lieux à la frappe et trois moitiés d'arbre géographique. La comparaison ignore la casse et les espaces ;
- **un lieu n'entre pas par une fiche à part** : il arrive avec le fait qui l'a vu. Une liste de lieux
  sans fait derrière n'est qu'un réservoir de fautes de frappe ;
- **effacer un lieu ne touche ni aux faits ni aux fichiers** : leurs `place_id` sont en
  `ON DELETE SET NULL`, et le compte rendu dit combien restent sans lieu — c'est ce que l'on veut savoir
  avant de cliquer. Un lieu mal orthographié se corrige (renommer suit tout ce qui y pointe), il ne
  s'efface pas.

`lat`, `lon` et `parent_place_id` restent vides : la géographie et la hiérarchie ne sont remplies par
aucun écran aujourd'hui.

**couple** — `id`, `partner_a`, `partner_b`, `type` (mariage / pacs / concubinage / inconnu),
`start_date_*`, `end_date_*`, `status` (en cours / divorcé / veuf / séparé), `place_id`.
C'est l'unité de dessin de l'arbre. Trois choix y comptent :

- la table s'appelle **`couple` et non `union`** : `UNION` est un mot réservé SQL, et une base qui oblige
  à écraser le nom métier à chaque requête est une base que l'on code à contre-cœur ;
- les deux membres sont en **`ON DELETE SET NULL`** : effacer une personne mal orthographiée ne détruit
  ni son mariage ni, par cascade, la mémoire de l'union dont viennent ses enfants. Une ligne `couple` qui
  n'a plus rien pour elle — ni membre, ni enfant, ni acte — est supprimée par `pruneEmptyCouples()` ;
- **une union n'existe que si on la déclare.** Rattacher un enfant à un parent ne crée jamais de second
  parent par défaut.

**parent_child** — `parent_id`, `child_id`, `couple_id`, `nature` (biologique / adoptif / beau-parent /
inconnu), `certainty`. `couple_id` permet de savoir de quelle union l'enfant est issu — indispensable pour
les demi-frères. Il reste vide tant que l'union n'est pas déclarée, et un enfant rattaché à un seul des
deux membres n'est jamais rangé dans le couple.

**event** — `id`, `person_id`, `couple_id`, `type` (naissance, baptême, décès, inhumation, profession,
résidence, autre), `date_*`, `place_id`, `description`, `source_id`, `confidence`

Trois règles la tiennent debout, et le serveur les écrit telles qu'il les refuse :

- **un fait porte une personne ou une union, jamais les deux ni aucune** : sans sujet, il ne s'affiche
  sur aucun écran et devient une ligne perdue dans la base ;
- **une naissance et un décès par personne** : une seconde est refusée en 409 et nomme le fait à
  reprendre. Les autres types se répètent librement — une vie compte trois résidences ;
- **la date tapée sur la fiche est le fait du même nom** : « 12 mars 1912 » écrit une ligne `event`
  de type `naissance`, pas une colonne de plus dans `person`. Un fait aurait deux dates selon
  l'endroit où on l'a saisi sinon.

**media** — `id`, `kind` (photo / document), `original_path`, `thumb_path`, `sha256`, `mime`,
`width`, `height`, `date_*`, `caption`, `place_id`, `source_id`,
`document_type` (acte de naissance, livret de famille, lettre, carte postale…)

**media_person** — `media_id`, `person_id`, `role` (sujet / témoin / arrière-plan / auteur), et le cadrage
du portrait : `crop_x`, `crop_y`, `crop_size` (§8.8).
Une photo de groupe à un mariage peut concerner quinze personnes. C'est la table qui rend
les cousins utilisables.

**media_event** — `media_id`, `event_id`

**note** — `id`, `body` (Markdown), `target_type`, `target_id`, `created_at`

**source** — `id`, `kind` (acte / photo / témoignage / web / livre), `reference`, `reliability`

**confidence** — `certain` / `probable` / `douteux`. Porté par tout fait, pas par la personne.

### 7.3 Ce que la base remplit vraiment aujourd'hui

Le schéma est écrit en entier depuis la passe 0 — créer les tables à la fin coûte une migration et un
jour de doute sur les clés — mais toutes ne sont pas encore nourries. Ce qui vit :

| Table | Écriture |
|---|---|
| `person`, `couple`, `parent_child`, `name_variant` | remplies et lues par l'interface |
| `event` | **écrite et lue en entier depuis la passe 5** : la chronologie de la fiche montre tous les faits, les écrit, les corrige, les efface — et la date tapée sur la fiche reste le fait du même nom |
| `media`, `media_person` | **remplies et lues depuis la passe 4** : le bac, la galerie d'une personne, le portrait |
| `branch` | **remplie et lue depuis la passe 3** : nom, teinte, tête de ligne, personnes rangées |
| `place` | **remplie et lue depuis la passe 5** : le nom tapé sur un fait trouve la ligne ou la pose ; Réglages la renomme et l'efface. `lat`, `lon`, `parent_place_id` restent vides |
| `note`, `source` | posées, traversées par l'export JSON, **rien ne les remplit** : les notes et les sources viennent avec la suite de la passe 5 |
| `media_event` | posée, et absente de l'export : le rattachement d'un média à un événement se joue en passe 5 |

L'export JSON porte donc des listes vides plutôt que de les inventer, et une table vide n'est pas une
fonction abandonnée : c'est une fonction qui n'a pas encore sa passe.

## 8. Écrans

### 8.1 L'arbre

Canevas zoomable, plusieurs mises en page calculées sur les mêmes données :

| Vue | Usage | État |
|---|---|---|
| **Descendance depuis la souche** | La vue de la famille : toutes les branches, tous les cousins | **en place** — une case par personne, conjoints dessinés de part et d'autre, blocs d'union, enfants sous la jonction |
| Ascendant | Remonter depuis une personne (toi, ou n'importe qui) | à construire |
| Sablier | Une personne, ses ancêtres et ses descendants | à construire |
| Éventail | Lecture d'ensemble, modèle du poster | à construire (passe 6) |
| Canevas libre | Familles recomposées, liens transverses | à construire |

Les cases d'une même personne ne se répètent pas : une personne ayant plusieurs unions apparaît **une
seule fois**, ses conjoints étant alignés autour d'elle dans le même bloc.

Ce que la barre de l'arbre sait faire aujourd'hui : rechercher un nom et zoomer dessus, agrandir, réduire,
ajuster la vue, déplacer le canevas à la souris, ouvrir la fiche d'une personne par un clic, et passer par
un menu contextuel pour la modifier, la rattacher, la supprimer, la définir comme souche ou comme « moi »,
ou créer une branche qui part d'elle. Les liens que la descendance ne dessine pas — second parent, boucle,
union dont les deux cases sont ailleurs — paraissent en pointillés, avec une légende qui les compte (§4.3).

Une branche se remplit et se lit sans quitter l'arbre : la case porte une teinte au bas de son encadrement
(nom de la branche dans l'infobulle), et une ligne de pastilles au-dessus du canevas les énumère avec le
compte de leurs cases — cliquer l'une d'elles ouvre la tête de ligne et amène l'arbre sur elle. Une branche
sans tête de ligne reste affichée, grisée, et dit pourquoi elle ne se clique pas.

La même barre porte une pastille à part, dorée : **« Me recentrer »** saute sur la personne « moi » (§4.1),
l'ouvre et amène l'arbre dessus. Tant que ce choix n'est pas fait — ou tant que la personne désignée a quitté
l'arbre depuis — la pastille reste visible, éteinte, et dit où le régler plutôt que de disparaître sans
raison.

Ce qui manque et attend son fil : le filtre par branche — les branches sont remplies (§7.3), mais la barre
de filtres n'est pas encore dessinée ; le filtre vivants/décédés n'a pas non plus de ligne de commande.

### 8.2 La fiche personne — « dossier de vie »

L'écran central. Cliquer sur une personne ouvre **tout** ce qui la concerne, en un seul endroit :

- portrait, nom, nom de naissance, surnom, dates, lieux
- **comment elle est liée à toi** (« cousine issue de germain, par les Gossiaux »), en une phrase — le
  calculateur de parenté du §4.5 la livre en passe 7 ; en attendant la fiche donne les liens directs
- événements de sa vie, dans l'ordre
- toutes ses photos et tous ses documents, **dans l'ordre chronologique** — la vie se lit du plus ancien
  au plus récent, une date inconnue se range à la fin (§8.4 pour l'import)
- ses notes (passe 5)
- ses relations (parents, fratrie, unions, enfants) cliquables
- ses sources et niveaux de confiance (passe 5)

Ce que la fiche sait déjà faire : un en-tête avec nom, nom de naissance, surnoms et dates telles qu'elles
sont écrites ; une section « Vie » qui est une chronologie — chaque fait de la base y passe, du plus
ancien au plus récent, une date non lisible se range à la fin avec son texte intact ; chaque ligne donne
le nom du fait, la date telle qu'elle a été tapée, le lieu, la description, le degré de confiance, la
source citée et le compte de fichiers qui s'y rattachent ; « Modifier » ouvre le fait en place (type,
date libre, lieu, ce qui s'est passé, confiance), « + Un fait de plus » en ajoute un, « Retirer ce fait » le
supprime après une seconde question ; une seconde naissance ou un second décès est refusé, et le refus
dit lequel reprendre. Le champ « Lieu » propose les noms qui portent déjà quelque chose dans la base : un
nom neuf devient une ligne de lieu, et un nom qui n'a plus rien derrière lui cesse d'être proposé plutôt
que de propager sa faute de frappe. La date de naissance et le décès affichés en haut de la fiche sont la même ligne
que le fait de la chronologie : la saisie rapide et l'éditeur de vie écrivent au même endroit. Quatre
sections de relations — Parents, Unions, Fratrie, Enfants — où chaque nom est cliquable ; un bouton
« Rattacher… » pour relier deux personnes déjà saisies ; la modification en place ; et la suppression
confirmée, y compris par la touche Suppr. Depuis la passe 4, elle est aussi une galerie : glisser des
fichiers dessus les importe et les rattacher à cette personne, chaque vignette s'ouvre en grand dans la
visionneuse, la légende et la date lue se corrigent là, « Faire le portrait » donne à cette image le
visage de la case et de l'en-tête, et « Retirer de ce dossier » rend le fichier au bac sans rien effacer.

L'écran Réglages, lui, tient la liste des lieux : chaque ligne porte le compte de faits — et de fichiers —
qui y pointent, se renomme sur place, et s'efface après une seconde question qui dit ce qui reste sans
lieu. On n'y ajoute rien : un lieu entre par un fait.

Y manquent encore, et c'est la suite de la passe 5 : la source d'un fait se lit mais ne se choisit pas
(elle arrive avec la table `source`), les notes de la fiche, les faits d'une union — le serveur les
accepte et les rend déjà, la fiche ne les montre pas — et le rattachement d'un fichier à un fait.

### 8.3 L'annuaire

À 400 personnes, la liste devient indispensable : tri par nom, branche, génération, année de naissance ;
recherche par nom, surnom, lieu. C'est aussi le point d'entrée pour ajouter quelqu'un.

Aujourd'hui, seule la recherche instantanée de l'en-tête existe — elle trouve les noms de famille, les
prénoms et les noms de naissance, et zoome sur la personne ; elle ne cherche pas encore dans les surnoms,
alors que « Tata Michèle » est souvent le seul nom que la famille connaît. L'annuaire en tant qu'écran
vient avec la passe 7, quand les filtres et les branches lui donnent de quoi être trié.

### 8.4 Le bac d'entrée

Zone où l'on dépose en vrac photos et documents scannés, sans encore savoir qui est dessus.
Rattachement ultérieur, seul ou par lot (« ajouter Marie à ces 20 photos »).
Sans cet écran, le projet se bloque dès la première boîte à chaussures. **En place** depuis la passe 4.

Ce que l'écran fait aujourd'hui :

- **déposer** — glisser des fichiers sur la zone, ou les choisir par le bouton. Quarante fichiers au
  plus par passage, et ce qui dépasse est dit plutôt qu'avidé. JPEG, PNG, WebP, GIF et PDF sont pris ;
  un autre format est refusé en nommant les reconnus ; un fichier de plus de 60 Mo est refusé avant
  d'être écrit ;
- **reconnaître un doublon** — la photo déjà dans le dossier n'est pas écrite une seconde fois, et le
  lot le annonce (« 3 ajoutés, 1 déjà dans le dossier ») au lieu de compter deux fois la même image ;
- **dater ce qu'on ne sait pas dater** — la date du fichier sur le disque sert de première hypothèse ;
  elle se corrige ensuite dans la visionneuse, avec les quatre colonnes d'une date floue ;
- **rattacher par lot** — cocher plusieurs personnes, un seul bouton. Une photo de groupe appartient
  autant à chacun : c'est la table `media_person`, pas une colonne `person_id` ;
- **ouvrir en grand** — la visionneuse suit l'image par son identifiant : corriger une date réordonne la
  galerie chronologiquement, le lecteur reste sur la photo qu'il montrait ;
- **détacher ou supprimer** — détacher rend le fichier au bac, supprimer est le seul geste de
  l'application qui efface des octets sur le disque et le demande deux fois.

Le compteur de l'en-tête donne ce qui attend un rattachement. Un document sans vignette — un PDF, ou
une image que le navigateur n'a pas su décoder — entre sans aperçu, avec son nom en travers : refuser
une preuve pour un problème d'affichage serait un mauvais échange.

### 8.5 Questions ouvertes

Liste générée automatiquement : personnes sans dates, parents inconnus, dates contradictoires,
médias non rattachés, personnes sans photo, **branches non rattachées**. Transforme l'application
en carnet de recherche. **Passe 7**, à l'exception des branches non rattachées : elles sont déjà visibles
dans l'arbre, rangées à part, depuis la passe 1.

### 8.6 Chronologie

Trois échelles sur les mêmes données : frise par personne, frise familiale globale, albums par époque.
Superposition du contexte historique (guerres, exode) depuis un fichier local. **Passe 5** — la première
des trois échelles est en place : la section « Vie » de la fiche (§8.2) trie les faits de la personne et
s'y saisit, avec leur lieu ; les deux autres demandent les médias de la passe 4 pour être autre chose
qu'une liste de dates, et viennent avec les sources.

### 8.7 Export

- **Poster** : PDF vectoriel haute résolution, A2/A1, **deux modèles** — descendance depuis la souche
  et éventail — **avec les portraits**. Le portrait imprimé est un carré issu d'un recadrage manuel
  (voir 8.8), pas la photo entière : une photo de groupe de 1952 recadrée automatiquement donne
  un poster illisible. **Passe 6.**
- **Livre** : PDF, une page par personne (v2)
- **GEDCOM** : l'export est rangé en **passe 8**, et l'import en v2. Ce format ne sert qu'à parler à
  d'autres logiciels — ce n'est pas un but de ce projet, c'est une porte de sortie — et il a ses propres
  pièges de dates et de couples : le traiter après la passe 7 évite de figer un modèle de données qui
  change encore. La spec ne promet donc plus un export GEDCOM en v1.
- **JSON + ZIP** : sauvegarde complète, lisible sans l'application. **En place** (voir §6.3 et §6.4) :
  l'écran Réglages donne le bouton d'archive, la liste des copies, la sortie hors du disque, et le chemin
  à suivre pour recharger — le rechargement lui-même se commande dehors.

### 8.8 Recadrage des portraits

Un portrait imprimable est un **carré centré sur le visage**, découpé dans la photo d'origine.
L'application propose un cadre déplaçable et zoomable, mémorisé par couple (personne, média) :
la même photo peut fournir le portrait de plusieurs personnes, avec des cadrages différents.
Sans cet outil, un poster avec portraits est impossible à produire proprement.

Les trois colonnes qui stockent le cadrage (`crop_x`, `crop_y`, `crop_size` dans `media_person`) sont déjà
posées et restent **vides**. L'outil est découpé en deux : la passe 4, faite, importe les photos et choisit
le portrait d'une personne — le cadrage centré est alors celui du navigateur (`object-fit: cover`), rien n'est
mémorisé par personne ; le cadre déplaçable et zoomable arrive en **passe 6**, avec le poster qui en a
vraiment besoin. Le construire avant, ce serait dessiner une poignée pour une porte qui n'existe pas encore.

## 9. Ordre de construction

On ne construit pas écran par écran en finition : on traverse d'abord toutes les couches avec une
version minuscule (« balle traçante »), puis on épaissit. Chaque passe se termine par quelque chose
d'utilisable.

| Passe | Contenu | Résultat à la fin | État |
|---|---|---|---|
| **0** | Base, ajouter 3 personnes, arbre minimal, fiche minimale | Ça clique et ça répond, de bout en bout | faite |
| **1** | Saisie rapide au clavier, dates floues, unions, demi-frères | La famille se saisit pour de vrai | faite |
| **2** | Sauvegarde automatique en ZIP daté, réglages, export JSON, restauration | Les données ne peuvent plus être perdues | faite |
| **3** | Arbre de descendance, blocs couples, zoom, recentrer, branches colorées | Le projet devient réel et beau | faite |
| **4** | Médias : import, vignettes, bac d'entrée, rattachement par lot, choix du portrait | Les visages arrivent | faite |
| **5** | Fiche complète : dossier de vie, chronologie, notes, documents | Cliquer sur quelqu'un raconte sa vie | à faire |
| **6** | Poster : deux modèles, avec portraits ; cadre de recadrage interactif | Un objet à offrir | à faire |
| **7** | Calculateur de parenté, questions ouvertes, recherche approfondie, filtres, annuaire | L'outil devient confortable | à faire |
| **8** | Export GEDCOM | La famille peut quitter le logiciel sans perdre son arbre | à faire |

L'avancement détaillé, ligne par ligne, est dans [`BUILD.md`](BUILD.md) — c'est là qu'il faut regarder,
pas ici.

**v1** = passes 0 à 6 : un arbre que l'on saisit, que l'on protège, que l'on imprime. Les passes 7 et 8
viennent ensuite, sur un v1 qui marche — elles rendent l'outil confortable et interopérable, pas usable.
**v2** = livre PDF, fusion de doublons, statistiques, carte des lieux, import GEDCOM.
**v3** = reconnaissance faciale locale, notes audio.

## 10. Décisions prises

| Sujet | Décision |
|---|---|
| Poster | Les deux modèles (descendance et éventail), **avec portraits** |
| Documents | Rattachés **à une personne et à un événement** (les deux tables existent) |
| Branches colorées | Oui |
| Ordre de construction | Balle traçante, puis épaississement (voir §9) |
| Stockage | `D:\Genealogie\` |
| Reconnaissance faciale | v3, locale, gratuite |
| « moi » | **Un réglage distinct de la souche** (§4.1) : l'arbre descend de la souche, les phrases de parenté partent de « moi ». Posé avec la passe 3, qui apporte « me recentrer » — pas avant, pour ne pas écrire un réglage que rien ne consomme. |
| Calculateur de parenté | **Passe 7**, plus la ligne « comment elle est liée à toi » de la fiche (§4.5, §8.2) |
| GEDCOM | Export en **passe 8**, import en v2 (§8.7) |
| Vignettes | Générées **côté navigateur** dans un canvas, à l'import. Pas de `sharp` : un second binaire à rebuilder à chaque version de Node (§5) |
| Import d'un média | **Octets bruts**, original jamais retouché, écrit en `.part` puis renommé sous `medias/<type>/<année>/` ; doublons reconnus à l'empreinte `sha256` ; les fichiers ne sont relus que par leur identifiant, revalidé contre le dossier de données |
| Sortie d'un média | **Détacher n'est pas supprimer** : détacher rend au bac, supprimer efface les deux fichiers et se confirme deux fois (§8.4) |
| Tables des unions | Nommées `couple`, avec `couple_id` partout et les membres en `ON DELETE SET NULL` (§7.2) |
| Recharger une archive | Par `restore.bat`, **application fermée** : contrôle, comparaison, `OUI`, copie de sûreté, échange par renommage (§6.4) |

## 11. Reste à décider

1. `[À VALIDER]` Format du poster : A2, A1, les deux au choix à l'export ?
2. `[À VALIDER]` La souche : quel couple ? (à définir au moment de la saisie, pas maintenant)
3. `[À VALIDER]` Une fois le réglage « moi » posé : la fiche affiche-t-elle d'office la parenté depuis
   « moi », ou seulement sur demande ? La première option est plus chaleureuse, la seconde
   plus lisible quand personne ne se reconnaît dans le centrage choisi.
4. `[À VALIDER]` Plusieurs souches : la famille a-t-elle des origines réellement distinctes et non reliées,
   ou un seul couple souche suffit-il ? La réponse pèse sur la passe 3 — une vue de descendance unique, ou
   une vue par souche que l'on choisit. Un `rootPersonId` unique est ce qui est écrit aujourd'hui (§4.1).
