# My_family_tree

Arbre généalogique familial : visualisation, faits de vie, lieux, sources et médias. L'interface et les commentaires de code sont en français.

> **Le projet principal est celui-ci**, à la racine du dépôt. L'ancienne version (serveur local, migrations Supabase, coffre, scripts Windows) reste consultable dans [`legacy/`](legacy/) avec sa propre documentation [`legacy/README.md`](legacy/README.md), [`legacy/BUILD.md`](legacy/BUILD.md) et [`legacy/SPEC.md`](legacy/SPEC.md).

## Principe

- Arbre **global**, sans racine ni personne centrale : toutes les branches et tous les cousins sont visibles de la même façon par tous.
- **Pastilles d'union** sur chaque couple, traits courts entre conjoints, une descente depuis le milieu, barre de fratrie et petites verticales vers chaque enfant.
- Modèle d'unions complet : remariages, demi-fratries, mariages entre cousins ; les croisements sont minimisés.
- Règle produit : **toujours demander** avant de résoudre un doublon de filiation. Rien n'est fusionné automatiquement.

## Fonctionnalités

- Ajout d'une personne, d'un parent, d'un frère/sœur, d'un enfant ou d'un conjoint ; édition et suppression des fiches.
- Placement automatique déterministe (`balanced` par défaut, `siblings`, `couples`, `off`), pan/zoom.
- Recherche insensible aux accents (`Ctrl/Cmd+K`), surlignage et recentrage.
- Dates **en texte libre** (`vers 1890`, `avant 1914`, `12 mars 1890`) décomposées en quatre colonnes éditables.
- Fiche personne : identité, portrait avec cadrage, dates de vie, notes libres, coordonnées, galerie de photos et documents.
- **Faits de vie** : un événement peut concerner une ou plusieurs personnes avec un rôle ; date floue, lieu, notes, sources et médias. La naissance et le décès restent sur la fiche pour l'arbre et créent un événement par défaut synchronisé.
- **Lieux** nommés (type, parent optionnel) : renommage par identifiant, suppression refusée tant qu'une citation existe.
- **Sources** à cote unique (accents et casse ignorés) : plusieurs citations par fait, suppression refusée tant que la source est utilisée.
- **Médias partagés** : une photo peut illustrer plusieurs personnes ; chaque personne choisit son portrait et son propre cadrage. Les octets sont stockés dans IndexedDB, jamais dans le JSON.
- Import/export JSON complet (document + fichiers en data URLs), compatible avec les versions v1, v2 et v3.

## Démarrage

```bash
npm install
npm run dev
```

Build de production :

```bash
npm run build
npm run preview
```

Le projet démarre sur un arbre vide. Les données restent dans le navigateur (`localStorage` pour le document JSON versionné `simple-family-tree:v3`, IndexedDB pour les fichiers). Aucun compte, aucun backend, aucune donnée envoyée sur le réseau.

## Organisation du code

- `src/domain/` : modèle v3 (`types.ts`), opérations métier (`operations.ts`), événements de vie (`lifeEvents.ts`), répertoires lieux/sources (`directories.ts`), migrations et validation (`repository.ts`), stockage des médias (`mediaStore.ts`), dates floues (`dates.ts`).
- `src/layout/` : moteur de placement généalogique maison (`classic.ts`), façade (`layout.ts`), types partagés (`model.ts`), arbitrage des modes (`grouping.ts`).
- `src/components/` : canevas SVG, fiche personne, panneau latéral à onglets, dialogues de création/édition, galerie, sélecteurs de lieux et sources.

## Passage prévu à Supabase

Le modèle est déjà prêt pour la phase en ligne : identifiants UUID, `family_id` partout, événements et médias référencés par identifiant, clés de fichiers `${familyId}/${mediaId}` compatibles avec un bucket Storage. Le passage consistera à remplacer `FamilyRepository` et `MediaStore` par des implémentations Postgres + Storage, sans modifier l'interface. Vercel ne servira que l'interface.

## Statut

Version locale v3, en cours de développement.
