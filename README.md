# My_family_tree

Arbre généalogique familial : visualisation, faits de vie, lieux, sources et médias. L'interface et les commentaires de code sont en français.

> **Le projet principal est celui-ci**, à la racine du dépôt. L'ancienne version (serveur local, migrations Supabase, coffre, scripts Windows) reste consultable dans [`legacy/`](legacy/) avec sa propre documentation [`legacy/README.md`](legacy/README.md), [`legacy/BUILD.md`](legacy/BUILD.md) et [`legacy/SPEC.md`](legacy/SPEC.md).

## Principe

- Arbre **global**, sans racine ni personne centrale : toutes les branches et tous les cousins sont visibles de la même façon par tous.
- **Pastilles d'union** sur chaque couple, traits courts entre conjoints, une descente depuis le milieu, barre de fratrie et petites verticales vers chaque enfant.
- Modèle d'unions complet : remariages, demi-fratries, mariages entre cousins ; les croisements sont minimisés.
- Règle produit : **toujours demander** avant de résoudre un doublon de filiation. Rien n'est fusionné automatiquement, aucune personne n'est supprimée par un nettoyage.

## Fonctionnalités

### Arbre et fiches

- Ajout d'une personne, d'un parent, d'un frère/sœur, d'un enfant ou d'un conjoint ; édition et suppression des fiches. En cas d'erreur, un parent ou un conjoint peut être **remplacé ou retiré** sans supprimer la personne ni détacher les enfants.
- Placement automatique déterministe (`balanced` par défaut, `siblings`, `couples`, `off`), pan/zoom, vues **classique / ascendants / sablier / éventail** et mise en page d'impression.
- Recherche insensible aux accents et aux variantes de noms (`Ctrl/Cmd+K`), surlignage de tous les résultats et recentrage sur la personne choisie. Les homonymes sont distingués dans tous les sélecteurs par date de naissance, puis par parents, conjoints ou enfants.
- Menu contextuel sur chaque carte : ouvrir la fiche, ajouter un lien, rattacher une personne existante, définir « Moi », créer une branche, calculer un lien de parenté, supprimer.
- Dates **en texte libre** (`vers 1890`, `avant 1914`, `12 mars 1890`) décomposées en interne en quatre colonnes, jamais affichées telles quelles.
- Fiche personne : identité et variantes de noms, portrait avec cadrage, dates de vie, notes libres, coordonnées, galerie de photos et documents.

### Données familiales

- **Faits de vie** : un événement peut concerner une ou plusieurs personnes avec un rôle, ou rester **non rattaché** ; date floue, lieu, notes, sources et médias. La naissance et le décès restent sur la fiche pour l'arbre et créent un événement par défaut synchronisé. Une **frise chronologique** classifie les faits et les unions ; chaque fait peut être modifié depuis la frise ou la liste.
- **Lieux** nommés (type, parent optionnel) : renommage par identifiant, suppression refusée tant qu'une citation existe.
- **Sources** à cote unique (accents et casse ignorés) : plusieurs citations par fait, suppression refusée tant que la source est utilisée.
- **Médias partagés** : une photo peut illustrer plusieurs personnes ; elle peut être rattachée à une autre personne directement depuis sa fiche, sans perdre les liaisons existantes. Chaque personne choisit son portrait et son propre cadrage. Boîte à médias avec glisser-déposer, lots, vignettes, déduplication par empreinte SHA-256, visionneuse plein écran et rattachement multiple.
- Export/import JSON complet (document + fichiers en data URLs), compatible avec les versions v1, v2 et v3. Export **GEDCOM 5.5.1** (`ABT`, `BEF`, `AFT` pour les dates floues).
- **Sauvegardes automatiques** tournantes et restauration, avec bandeau visible en cas d'échec d'enregistrement.

### Réglages personnels

Ils sont **distincts du document familial** : marqueur « Moi », personne de référence, branches colorées. Hors ligne ils sont rangés sous le profil `local` ; en ligne, sous l'identifiant du compte connecté. Chaque membre retrouve donc son propre marqueur sur un arbre partagé.

## Démarrage

```bash
npm install
npm run dev
```

Le projet fonctionne uniquement en ligne : au premier lancement, la modale **Accéder à votre arbre** s'ouvre pour se connecter ou créer un compte. Les deux variables Supabase sont obligatoires ; sans elles, l'application affiche un message de configuration et n'enregistre rien localement.

Build de production :

```bash
npm run build
npm run preview
```

Tests et vérification de types :

```bash
npm test
npm run typecheck
```

## Fonctionnement en ligne (Supabase)

Il n'y a plus de mode local : le document vit dans `family_documents` et les médias dans le bucket Storage. Le `localStorage` ne sert plus qu'aux réglages personnels et à mémoriser le dernier arbre ouvert.

### 1. Créer le schéma

Dans le projet Supabase, ouvrir **SQL Editor** et exécuter [`supabase/migrations/20261118210000_v3.sql`](supabase/migrations/20261118210000_v3.sql). Le script crée :

- `families`, `family_members`, `family_documents`, `invitations` ;
- les fonctions `family_role()`, `can_write()`, `can_admin()`, `create_family()`, `accept_invitation()` et `create_invitation()` ;
- les politiques RLS : lecture réservée aux membres, écriture aux rôles `admin` et `editor` ;
- le bucket Storage privé `family-media` (60 Mo par fichier) avec ses politiques de lecture, création, **modification** et suppression.

Le document v3 entier est stocké dans une seule colonne `jsonb`. Ce choix évite un moteur de synchronisation entité par entité ; le schéma d'octets, lui, reste identique à IndexedDB.

### 2. Configurer le front-end

```bash
cp .env.example .env.local
```

Renseigner `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` avec les valeurs du projet (**clé anon publique uniquement — jamais la clé `service_role` dans le navigateur**), puis relancer `npm run dev`.

### 3. Première ouverture

La modale s'ouvre dès que l'utilisateur n'a pas de session :

1. se connecter ou créer un compte ;
2. ouvrir un arbre existant, en créer un, ou saisir un jeton d'invitation ;
3. si un ancien arbre local est détecté, choisir **Importer et ouvrir** une seule fois ou **Ignorer**.

Ouvrir un arbre existant ne l'écrase jamais avec un document vide : le contenu du cloud fait foi. Le cas échéant, la migration locale copie d'abord les octets des médias d'IndexedDB vers Storage, puis le document JSON. Les clés restent inchangées : `SupabaseMediaStore` préfixe chaque clé par l'identifiant de l'arbre, ce qui satisfait les RLS. Les sauvegardes du navigateur sont supprimées après un import réussi.

Si certains médias sont absents en local ou refusés par Storage, un message précise le nombre concerné ; l'arbre reste utilisable et ces fichiers peuvent être réimportés depuis un export JSON.

### 4. Inviter quelqu'un

Un admin génère le jeton depuis la modale, section **Inviter un proche** (ou via la fonction SQL `create_invitation`). La personne crée son compte avec son e-mail et son mot de passe, puis choisit **Rejoindre un arbre** et saisit le jeton : aucune adresse n'est imposée, le jeton expire après 90 jours et ne sert qu'une fois.

```sql
select public.create_invitation('UUID_DE_L_ARBRE', 'editor');
```

### 5. Déployer sur Vercel

Importer le dépôt dans Vercel, framework **Vite**, commande de build `npm run build`, répertoire de sortie `dist`. Déclarer les deux variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans les variables d'environnement du projet.

### Limites actuelles

- La création de jetons est réservée aux admins depuis l'interface ; l'attribution fine des rôles se fait encore côté Supabase (`family_members`).
- Un membre `viewer` peut ouvrir l'arbre mais ses modifications sont refusées par RLS ; le bandeau d'erreur affiche le refus. Une désactivation préventive des boutons reste à faire.
- Une frise chronologique est disponible pour chaque personne dans l’onglet « Faits de vie » (bouton « Frise »). Une frise **multi-personnes / familiale** reste à prévoir dans une version future.
- Les réglages personnels (Moi, branches) sont dans le `localStorage` du navigateur, clés par compte : ils ne suivent pas encore d'un appareil à l'autre.

## Organisation du code

- `src/domain/` : modèle v3 (`types.ts`), opérations métier (`operations.ts`), événements de vie (`lifeEvents.ts`), répertoires lieux/sources (`directories.ts`), migrations et validation (`repository.ts`), stockage des médias (`mediaStore.ts`), dates floues (`dates.ts`), pont Supabase (`supabase.ts`).
- `src/layout/` : moteur de placement généalogique maison (`classic.ts`), façade (`layout.ts`), types partagés (`model.ts`), vues (`views.ts`), arbitrage des modes (`grouping.ts`).
- `src/components/` : canevas SVG, fiche personne, panneau latéral à onglets, dialogues de création/édition, galerie, boîte à médias, frise, réglages, tiroir d'outils et modale de compte.
- `src/test/` : tests Vitest du modèle, des opérations, du placement, des vues et des migrations.
- `supabase/migrations/` : schéma SQL, rôles, RLS et Storage.

## Statut

Version v3 : application 100 % en ligne, connexion/création de compte, arbres partagés et jetons d'accès générés par l'admin. Header allégé avec tiroir d'outils sur desktop et burger sur mobile. Les rôles fins et la synchronisation multi-appareils des réglages personnels restent à finaliser.
