# My_family_tree

Conserver et explorer l'arbre généalogique d'une **famille entière** — toutes les branches, tous les
cousins — avec photos, documents et notes. Gratuit, sans publicité, tenu par une seule personne.

L'arbre est en ligne : chacun ouvre une adresse, un lien reçu par e-mail l'y fait entrer, et lit ou écrit
selon le droit que la base lui reconnaît. Une copie complète — tables et fichiers — descend chaque dimanche
sur un disque de la maison.

Pas d'abonnement. Pas de réclame. Les droits tiennent dans une table, pas dans une tranche de tarif.

## Le principe

Ce n'est pas l'arbre d'une personne, c'est celui d'une famille. **Personne n'est la racine** : l'écran range
les cases tout seul, génération après génération, et chacun reste un point de vue, recentrable à volonté.

## Ce que fait l'application, aujourd'hui

- **Arbre par générations**, zoomable et déplaçable : une case par personne, les conjoints de part et
  d'autre, les branches remplies et colorées, et les liens que le dessin ne peut pas porter tracés en
  pointillés avec une légende qui les compte
- **Fiche personne** : photos, actes, chronologie de la vie, notes, relations — chaque fait portant sa date
  floue, son lieu et sa source
- **Photos et documents scannés** : import en lot, vignettes dessinées par le navigateur, doublons reconnus
  à leur empreinte, une photo de groupe rattachée à plusieurs personnes
- **Des droits, pas des boutons** : une cinquantaine de règles tenues dans la base, une invite par commande,
  et un compte en lecture seule refusé par la base elle-même, pas par un écran
- **Le coffre** : les archives datées du dimanche, un journal de réussite et d'échec, et le script qui sait
  les rejouer à l'endroit — éprouvé sur la vraie base

## Ce qui est écrit, pas encore construit

La frise familiale et les albums par époque, le poster imprimable avec ses portraits, les vues ascendant /
sablier / éventail, le calcul du lien de parenté exact, la recherche par surnom, l'export GEDCOM.
L'avancement réel se lit dans [`BUILD.md`](BUILD.md), la vision complète dans [`SPEC.md`](SPEC.md).

## Statut

En service pour la famille, et en cours d'épaississement. Les passes 6 et 7 sont les prochaines.

## Données

Les données ne sont **jamais** dans ce dépôt. L'arbre en ligne vit chez son hébergeur ; ses copies vivent
dans un dossier séparé (`D:\Genealogie\` par défaut) — l'import, les originaux de la boîte à chaussures, les
coffres. Voir la section « Stockage des données » de la spécification.

## Et l'application locale ?

Elle est encore là : le même dépôt sert l'arbre sur le disque, en SQLite, par `start.bat`. Ça marche, c'est
testé, ce n'est plus par là que la famille entre — et les deux bases ne se synchronisent pas.

## Licence

À définir.
