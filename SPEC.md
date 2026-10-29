# Arbre généalogique familial — spécification

> Statut : **en discussion**, rien n'est figé. Les points marqués `[À VALIDER]` attendent une réponse.

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
| Débutant acceptable | Un `start.bat`, une fenêtre de navigateur, zéro terminal |

## 4. Ce que « l'arbre de la famille » change

C'est la décision structurante du projet, et elle contrarie l'intuition habituelle.

### 4.1 Pas de racine unique, mais une souche

Un arbre ascendant part d'une personne et ne remonte qu'une ligne : il ne peut pas montrer les cousins.
Pour voir la famille, il faut partir du **couple souche** (le plus ancien ancêtre commun connu) et
**descendre** : chaque enfant, puis ses enfants, etc. Les cousins apparaissent alors naturellement.

- La **souche** est configurable (on peut avoir plusieurs souches si la famille a plusieurs origines).
- L'utilisateur est un **point de vue**, pas la structure : bouton « me recentrer », et la possibilité
  de centrer la vue sur n'importe qui.
- Un chemin est toujours calculable entre deux personnes reliées : c'est le calculateur de parenté.

### 4.2 Le couple est l'unité de dessin

Un individu seul ne suffit pas : un cousin est l'enfant d'un **couple**. On dessine donc des blocs
« union » avec les enfants accrochés en dessous, et non des flèches d'individu à individu.
C'est la seule représentation qui survive aux familles recomposées (un parent, deux unions, des
demi-frères de chaque côté).

### 4.3 Le graphe peut contenir des cycles

Deux cousins qui se marient créent une boucle : le graphe cesse d'être un arbre. Le moteur de mise en
page doit **casser le cycle** (choisir un arbre couvrant) et signaler le lien supplémentaire par un
trait discret, sans planter ni boucler à l'infini. Cas réel dans toutes les grandes familles.

### 4.4 Il y a des branches orphelines

On découvre souvent « la cousine germaine de mamie » sans savoir où l'accrocher. L'application doit
accepter des **personnes et des groupes non rattachés**, visibles dans un espace dédié, en attente
d'être connectés. Refuser cette possibilité, c'est obliger à inventer des liens faux.

### 4.5 La parenté se calcule, elle ne se devine pas

Avec 400 personnes, personne ne sait dire spontanément ce qu'est « le petit-fils de la sœur de mon
arrière-grand-père ». Le calculateur de parenté (« cousin issu de germain », « arrière-petite-cousine »)
n'est pas un gadget : c'est la fonction la plus consultée du logiciel. **v1.**

## 5. Stack

- **Node.js + TypeScript**, serveur HTTP unique servant l'API et le front déjà compilé
- **SQLite** via `better-sqlite3` — un seul fichier, sauvegarde triviale
- **React + Vite**, rendu des arbres en **SVG** (pas de canvas)
- **sharp** pour les vignettes et l'orientation EXIF
- **Leaflet + OpenStreetMap** pour la carte (v2)
- Export PDF vectoriel via **pdf-lib** ou impression navigateur haute résolution

Toutes ces dépendances sont sous licence libre (MIT / Apache-2.0 / domaine public).

## 6. Stockage des données — décision

### 6.1 Principe

**Le code est public, les données sont privées.** Le dépôt GitHub ne contient que du code.
Aucune donnée familiale, aucun nom, aucune photo ne doit jamais y entrer : c'est une règle absolue,
et le `.gitignore` est écrit en conséquence.

Les données vivent donc **hors du dépôt**, dans un dossier unique, choisi par l'utilisateur.

### 6.2 Emplacement retenu

```
D:\Genealogie\
├── data\famille.db            base SQLite (un seul fichier)
├── medias\
│   ├── photos\1923\...        originaux, jamais retouchés
│   ├── documents\actes\...    scans d'actes, lettres, livrets
│   └── vignettes\...          générées, supprimables
├── scans_bruts\               les scans tels quels, jamais modifiés
├── sauvegardes\               ZIP datés automatiques
├── exports\                   posters, livres
└── config.json                paramètres locaux (souche, préférences)
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

### 6.3 Sauvegarde

Une copie sur le même disque ne protège de rien. Trois niveaux :

1. **ZIP automatique** dans `sauvegardes\` à chaque session (base + médias, horodaté).
2. **Copie sur un support externe** — la seule vraie sauvegarde. L'application propose un bouton
   « sauvegarder vers… » qui écrit le ZIP où l'utilisateur veut.
3. **Export JSON** lisible sans l'application, en cas de catastrophe logicielle.

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

### 7.2 Tables

**person** — `id`, `given_names`, `family_name`, `birth_name`, `sex`, `living`,
`portrait_media_id`, `summary`, `branch_id`, `created_at`, `updated_at`

**name_variant** — `person_id`, `name`, `type` (alias / orthographe / **surnom**).
Indispensable dans une grande famille : « Tata Michèle » est le seul nom que tout le monde connaît.

**branch** — `id`, `name`, `color`, `root_person_id`. Les branches (paternelle, maternelle,
une famille alliée) permettent de colorer l'arbre et de filtrer. `[À VALIDER]` utile ou superflu ?

**place** — `id`, `name`, `lat`, `lon`, `parent_place_id`. Hiérarchie ville → département → pays.

**union** — `id`, `partner_a`, `partner_b`, `type` (mariage / pacs / concubinage / inconnu),
`start_date_*`, `end_date_*`, `status` (en cours / divorcé / veuf / séparé)
C'est l'unité de dessin de l'arbre.

**parent_child** — `parent_id`, `child_id`, `union_id`, `nature` (biologique / adoptif / beau-parent /
inconnu), `certainty`. `union_id` permet de savoir de quelle union l'enfant est issu — indispensable
pour les demi-frères.

**event** — `id`, `person_id`, `union_id`, `type` (naissance, baptême, décès, inhumation, profession,
résidence, autre), `date_*`, `place_id`, `description`, `source_id`, `confidence`

**media** — `id`, `kind` (photo / document), `original_path`, `thumb_path`, `sha256`, `mime`,
`width`, `height`, `date_*`, `caption`, `place_id`, `source_id`,
`document_type` (acte de naissance, livret de famille, lettre, carte postale…)

**media_person** — `media_id`, `person_id`, `role` (sujet / témoin / arrière-plan / auteur)
Une photo de groupe à un mariage peut concerner quinze personnes. C'est la table qui rend
les cousins utilisables.

**media_event** — `media_id`, `event_id`

**note** — `id`, `body` (Markdown), `target_type`, `target_id`, `created_at`

**source** — `id`, `kind` (acte / photo / témoignage / web / livre), `reference`, `reliability`

**confidence** — `certain` / `probable` / `douteux`. Porté par tout fait, pas par la personne.

## 8. Écrans

### 8.1 L'arbre

Canevas zoomable, plusieurs mises en page calculées sur les mêmes données :

| Vue | Usage |
|---|---|
| **Descendance depuis la souche** (par défaut) | La vue de la famille : toutes les branches, tous les cousins |
| Ascendant | Remonter depuis une personne (toi, ou n'importe qui) |
| Sablier | Une personne, ses ancêtres et ses descendants |
| Éventail | Lecture d'ensemble, modèle du poster |
| Canevas libre | Familles recomposées, liens transverses |

Contrôles permanents : **me recentrer**, **centrer sur…**, filtre par branche, filtre vivants/décédés,
recherche instantanée avec zoom sur la personne.

### 8.2 La fiche personne — « dossier de vie »

L'écran central. Cliquer sur une personne ouvre **tout** ce qui la concerne, en un seul endroit :

- portrait, nom, nom de naissance, surnom, dates, lieux
- **comment elle est liée à toi** (« cousine issue de germain, par les Gossiaux »), en une phrase
- événements de sa vie, dans l'ordre
- toutes ses photos, dans l'ordre chronologique
- tous ses documents (actes, lettres)
- ses notes
- ses relations (parents, fratrie, unions, enfants) cliquables
- ses sources et niveaux de confiance

### 8.3 L'annuaire

À 400 personnes, la liste devient indispensable : tri par nom, branche, génération, année de naissance ;
recherche par nom, surnom, lieu. C'est aussi le point d'entrée pour ajouter quelqu'un.

### 8.4 Le bac d'entrée

Zone où l'on dépose en vrac photos et documents scannés, sans encore savoir qui est dessus.
Rattachement ultérieur, seul ou par lot (« ajouter Marie à ces 20 photos »).
Sans cet écran, le projet se bloque dès la première boîte à chaussures.

### 8.5 Questions ouvertes

Liste générée automatiquement : personnes sans dates, parents inconnus, dates contradictoires,
médias non rattachés, personnes sans photo, **branches non rattachées**. Transforme l'application
en carnet de recherche.

### 8.6 Chronologie

Trois échelles sur les mêmes données : frise par personne, frise familiale globale, albums par époque.
Superposition du contexte historique (guerres, exode) depuis un fichier local.

### 8.7 Export

- **Poster** : PDF vectoriel haute résolution, A2/A1, descendance et/ou éventail
- **Livre** : PDF, une page par personne (v2)
- **GEDCOM** : export (v1), import (v2)
- **JSON + ZIP** : sauvegarde complète, lisible sans l'application

## 9. Feuille de route

**v1 — le socle**
modèle de données · arbre de descendance depuis la souche · fiche personne · annuaire · saisie rapide ·
bac d'entrée · calculateur de parenté · chronologie · recherche · export poster · sauvegarde auto

**v2 — la profondeur**
livre PDF · fusion de doublons · statistiques · carte des lieux · import GEDCOM · filtres par branche

**v3 — le confort**
reconnaissance faciale locale (regroupement proposé, jamais imposé) · notes audio

## 10. Décisions ouvertes

1. `[À VALIDER]` Poster : descendance depuis la souche, éventail, ou les deux ? Avec portraits ou noms et dates seuls ?
2. `[À VALIDER]` Documents rattachés à un événement, à une personne, ou les deux ?
3. `[À VALIDER]` Notion de « branches » colorées : utile ou surcharge visuelle ?
4. `[À VALIDER]` Ordre de construction : modèle + arbre d'abord, ou saisie + fiches d'abord ?
