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
- Recherche insensible aux accents et aux variantes de noms (`Ctrl/Cmd+K`), surlignage et recentrage.
- Menu contextuel sur chaque carte : ouvrir la fiche, ajouter un lien, rattacher une personne existante, définir « Moi », créer une branche, calculer un lien de parenté, supprimer.
- Dates **en texte libre** (`vers 1890`, `avant 1914`, `12 mars 1890`) décomposées en interne en quatre colonnes, jamais affichées telles quelles.
- Fiche personne : identité et variantes de noms, portrait avec cadrage, dates de vie, notes libres, coordonnées, galerie de photos et documents.

### Données familiales

- **Faits de vie** : un événement peut concerner une ou plusieurs personnes avec un rôle ; date floue, lieu, notes, sources et médias. La naissance et le décès restent sur la fiche pour l'arbre et créent un événement par défaut synchronisé. Une **frise chronologique** classifie les faits et les unions.
- **Lieux** nommés (type, parent optionnel) : renommage par identifiant, suppression refusée tant qu'une citation existe.
- **Sources** à cote unique (accents et casse ignorés) : plusieurs citations par fait, suppression refusée tant que la source est utilisée.
- **Médias partagés** : une photo peut illustrer plusieurs personnes ; chaque personne choisit son portrait et son propre cadrage. Boîte à médias avec glisser-déposer, lots, vignettes, déduplication par empreinte SHA-256, visionneuse plein écran et rattachement multiple.
- Export/import JSON complet (document + fichiers en data URLs), compatible avec les versions v1, v2 et v3. Export **GEDCOM 5.5.1** (`ABT`, `BEF`, `AFT` pour les dates floues).
- **Sauvegardes automatiques** tournantes et restauration, avec bandeau visible en cas d'échec d'enregistrement.

### Réglages personnels

Ils sont **distincts du document familial** : marqueur « Moi », personne de référence, branches colorées. Hors ligne ils sont rangés sous le profil `local` ; en ligne, sous l'identifiant du compte connecté. Chaque membre retrouve donc son propre marqueur sur un arbre partagé.

## Démarrage

```bash
npm install
npm run dev
```

Le projet démarre sur un arbre vide. Sans configuration Supabase, **tout reste local** : `localStorage` pour le document JSON versionné `simple-family-tree:v3`, IndexedDB pour les fichiers. Aucun compte, aucun backend, aucune donnée envoyée sur le réseau.

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

## Mode en ligne (Supabase)

Le mode local reste le comportement par défaut. Le cloud s'active uniquement si les deux variables d'environnement sont présentes au démarrage.

### 1. Créer le schéma

Dans le projet Supabase, ouvrir **SQL Editor** et exécuter [`supabase/migrations/20261118210000_v3.sql`](supabase/migrations/20261118210000_v3.sql). Le script crée :

- `families`, `family_members`, `family_documents`, `invitations` ;
- les fonctions `family_role()`, `can_write()`, `can_admin()`, `create_family()`, `accept_invitation()` ;
- les politiques RLS : lecture réservée aux membres, écriture aux rôles `admin` et `editor` ;
- le bucket Storage privé `family-media` (60 Mo par fichier) avec ses politiques de lecture, création, **modification** et suppression.

Le document v3 entier est stocké dans une seule colonne `jsonb`. Ce choix évite un moteur de synchronisation entité par entité ; le schéma d'octets, lui, reste identique à IndexedDB.

### 2. Configurer le front-end

```bash
cp .env.example .env.local
```

Renseigner `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` avec les valeurs du projet (**clé anon publique uniquement — jamais la clé `service_role` dans le navigateur**), puis relancer `npm run dev`.

### 3. Première synchronisation

Le bouton **Passer au cloud** apparaît dans la barre supérieure. Il faut ensuite :

1. créer un compte ou se connecter ;
2. créer un arbre (le créateur en devient admin) ou saisir un jeton d'invitation ;
3. cliquer sur **Ouvrir cet arbre en ligne**.

À cette étape, l'application copie **d'abord les octets des médias** d'IndexedDB vers Storage, **puis le document JSON**. Les clés restent inchangées : `SupabaseMediaStore` préfixe chaque clé par l'identifiant de l'arbre cloud, ce qui satisfait les politiques RLS. L'arbre local n'est pas effacé.

Si certains médias sont absents en local ou refusés par Storage, un message précise le nombre concerné ; l'arbre reste utilisable et ces fichiers peuvent être réimportés depuis un export JSON.

### 4. Inviter quelqu'un

La création d'invitations n'a pas encore d'interface. Un admin peut insérer une ligne depuis le SQL Editor, puis transmettre le jeton généré :

```sql
insert into public.invitations (family_id, email, role)
values ('UUID_DE_L_ARBRE', 'personne@exemple.fr', 'editor')
returning token;
```

La personne invitée saisit ce jeton dans **Passer au cloud → Invitation reçue**. L'adresse doit correspondre à son e-mail de connexion ; le jeton expire après 14 jours.

### 5. Déployer sur Vercel

Importer le dépôt dans Vercel, framework **Vite**, commande de build `npm run build`, répertoire de sortie `dist`. Déclarer les deux variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans les variables d'environnement du projet.

### Limites actuelles

- L'interface n'a pas encore de gestionnaire d'invitations ni d'écran d'administration des rôles : la table `invitations` et `family_members` se gèrent côté Supabase.
- Un membre `viewer` peut ouvrir l'arbre mais ses modifications sont refusées par RLS ; le bandeau d'erreur affiche le refus. Une désactivation préventive des boutons reste à faire.
- Les réglages personnels (Moi, branches) sont dans le `localStorage` du navigateur, clés par compte : ils ne suivent pas encore d'un appareil à l'autre.

## Organisation du code

- `src/domain/` : modèle v3 (`types.ts`), opérations métier (`operations.ts`), événements de vie (`lifeEvents.ts`), répertoires lieux/sources (`directories.ts`), migrations et validation (`repository.ts`), stockage des médias (`mediaStore.ts`), dates floues (`dates.ts`), pont Supabase (`supabase.ts`).
- `src/layout/` : moteur de placement généalogique maison (`classic.ts`), façade (`layout.ts`), types partagés (`model.ts`), vues (`views.ts`), arbitrage des modes (`grouping.ts`).
- `src/components/` : canevas SVG, fiche personne, panneau latéral à onglets, dialogues de création/édition, galerie, boîte à médias, frise, réglages, sauvegardes et accès au cloud.
- `src/test/` : tests Vitest du modèle, des opérations, du placement, des vues et des migrations.
- `supabase/migrations/` : schéma SQL, rôles, RLS et Storage.

## Statut

Version v3 : mode local complet et testé, mode Supabase opérationnel avec invitations via SQL. Les rôles et la synchronisation multi-appareils des réglages personnels restent à finaliser.
