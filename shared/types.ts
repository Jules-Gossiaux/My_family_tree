export type Qualifier = 'exact' | 'about' | 'before' | 'after' | 'between' | 'unknown';

export type Sex = 'M' | 'F' | 'X' | '?';

export interface GDate {
  min: string | null;
  max: string | null;
  qualifier: Qualifier;
  text: string | null;
}

export interface Person {
  id: string;
  givenNames: string;
  familyName: string;
  birthName: string | null;
  sex: Sex;
  living: boolean;
  summary: string | null;
  branchId: string | null;
  /** Le média choisi comme portrait. Le cadrage du visage arrive en passe 6, l'identifiant suffit déjà. */
  portraitMediaId: string | null;
  birth: GDate | null;
  death: GDate | null;
}

export interface Couple {
  id: string;
  /** Les deux partenaires peuvent être effacés de la base : l'union, elle, reste et porte les enfants. */
  partnerA: string | null;
  partnerB: string | null;
  type: string;
  status: string;
  start: GDate | null;
}

export interface ParentChild {
  id: string;
  parentId: string;
  childId: string;
  coupleId: string | null;
  nature: string;
}

/**
 * Une branche de l'arbre : une ligne que l'on colore pour la reconnaître d'un coup d'œil.
 * `rootPersonId` est la personne dont la branche part, pas une personne de plus — c'est elle que
 * l'on range, avec ses descendants.
 */
export interface Branch {
  id: string;
  name: string;
  /** Hexadécimal, tel que le rend le sélecteur de couleur du navigateur. */
  color: string;
  rootPersonId: string | null;
  /** Combien de personnes portent cette branche — 0 veut dire qu'elle est là sans servir encore. */
  personCount: number;
}

/**
 * Un fait de la vie, tel que la fiche le montre. La date garde son texte d'origine : « vers 1912 »
 * s'affiche tel qu'il a été écrit, pas converti en une année sèche.
 */
export interface EventRow {
  id: string;
  personId: string | null;
  coupleId: string | null;
  type: string;
  /** Le même type, dit en français pour l'écran. */
  label: string;
  date: GDate | null;
  place: string | null;
  placeId: string | null;
  description: string | null;
  /** certain / probable / douteux — porté par le fait, pas par la personne. */
  confidence: string;
  sourceId: string | null;
  /** La référence telle qu'elle se cite sur l'acte, et le genre du document. */
  source: string | null;
  sourceKind: string | null;
  /** Combien de photos ou de documents sont reliés à ce fait. */
  mediaCount: number;
}

/** Ce que l'on écrit d'un fait : le type seul est obligatoire, le reste se tait ou se met à `null`. */
export interface EventInput {
  personId?: string | null;
  coupleId?: string | null;
  type?: string;
  dateText?: string | null;
  placeId?: string | null;
  /** Le lieu tapé tel quel : le serveur le trouve ou le crée, c'est le nom seul qui le désigne. */
  placeName?: string | null;
  description?: string | null;
  confidence?: string;
  sourceId?: string | null;
}

/**
 * Un lieu, tel que l'écran le montre : son nom et ce qui s'y est déjà passé. Les faits et les
 * fichiers ne sont pas comptés pour décorer — effacer un lieu se refuse mieux quand on le sait.
 */
export interface PlaceRow {
  id: string;
  name: string;
  eventCount: number;
  mediaCount: number;
}

/**
 * Une source citée par des faits : son genre, sa référence, sa fiabilité — et combien de lignes la
 * réclament. Le compte est là pour la même raison que celui des lieux : on n'efface pas ce qui sert.
 */
export interface SourceRow {
  id: string;
  /** acte, photo, temoignage, web, livre — tel que la base le stocke. */
  kind: string;
  /** Le même genre, dit en français pour l'écran. */
  label: string;
  /** La cote, le titre, l'adresse : ce qui distingue cette source de ses voisines. */
  reference: string | null;
  /** certain / probable / douteux, porté par la source elle-même. */
  reliability: string;
  eventCount: number;
  mediaCount: number;
}

/** Ce que l'on écrit d'une source : le genre et la référence, la fiabilité se devance « probable ». */
export interface SourceInput {
  kind?: string;
  reference?: string | null;
  reliability?: string;
}

/**
 * Une note telle qu'elle s'affiche : le texte, et la ligne qu'elle commente. La cible se dit par un
 * type et un identifiant parce qu'une marge se pose aussi bien sur une personne que sur un acte.
 */
export interface NoteRow {
  id: string;
  body: string;
  /** personne, union, fait, fichier ou lieu — les cinq lignes que l'on peut noter. */
  targetType: string;
  targetId: string;
  /** Écrite une fois : corriger le texte ne change pas la date, la fiche dit donc « écrite le ». */
  createdAt: string;
}

/** Ce que l'on écrit d'une note : son texte et sur quoi il se pose. */
export interface NoteInput {
  body?: string | null;
  targetType?: string | null;
  targetId?: string | null;
}

export interface GraphData {
  persons: Person[];
  couples: Couple[];
  parentChild: ParentChild[];
  branches: Branch[];
  rootId: string | null;
  dataDir: string;
}

/** Ce que l'on écrit d'une branche. Le nom est seul obligatoire ; la couleur se choisit toute seule. */
export interface BranchInput {
  name?: string;
  color?: string;
  rootPersonId?: string | null;
}

export interface PersonDetail extends Person {
  nicknames: string[];
  events: EventRow[];
  parents: Person[];
  siblings: Person[];
  partners: Person[];
  children: Person[];
  media: Media[];
  /** Ce que l'on a écrit en marge de cette personne, dans l'ordre où ça l'a été. */
  notes: NoteRow[];
}

export type MediaKind = 'photo' | 'document';

export interface MediaPersonRef {
  id: string;
  name: string;
  role: string;
}

/**
 * Un média tel que l'écran le voit. Les fichiers ne se dessinent jamais par un chemin : la clé
 * désigne l'objet dans le coffre, et sans URL signée elle ne donne accès à rien.
 */
export interface Media {
  id: string;
  kind: MediaKind;
  mime: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  documentType: string | null;
  date: GDate | null;
  hasThumb: boolean;
  /** L'original dans le coffre `medias`. */
  key: string;
  /** Sa vignette, quand elle existe. */
  thumbKey: string | null;
  persons: MediaPersonRef[];
  createdAt: string;
}

export type RelationType = 'child' | 'parent' | 'partner';

export interface RelationInput {
  type: RelationType;
  ofPersonId: string;
  otherParentId?: string | null;
}

export interface CreatePersonInput {
  givenNames: string;
  familyName?: string;
  birthName?: string | null;
  sex?: Sex;
  living?: boolean;
  birthText?: string | null;
  deathText?: string | null;
  relation?: RelationInput | null;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

export interface AppState {
  dataDir: string;
  /** Le dossier courant vient de la variable FAMILY_DATA_DIR : ce choix prime sur l'écran Réglages. */
  dataDirFromEnv: boolean;
  rootPersonId: string | null;
  /** Qui vous êtes dans l'arbre — distinct de la souche, qui dit seulement d'où part la descendance. */
  mePersonId: string | null;
  counts: { persons: number; couples: number; media: number; mediaUnattached: number };
  backup: BackupInfo | null;
  /** Ce que le serveur sait et ne doit pas taire : sauvegarde manquée, schéma abîmé. */
  warnings: string[];
}
