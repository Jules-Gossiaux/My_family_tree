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

export interface EventRow {
  id: string;
  type: string;
  date: GDate | null;
  place: string | null;
  description: string | null;
}

export interface GraphData {
  persons: Person[];
  couples: Couple[];
  parentChild: ParentChild[];
  rootId: string | null;
  dataDir: string;
}

export interface PersonDetail extends Person {
  nicknames: string[];
  events: EventRow[];
  parents: Person[];
  siblings: Person[];
  partners: Person[];
  children: Person[];
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
  counts: { persons: number; couples: number; media: number };
  backup: BackupInfo | null;
  /** Ce que le serveur sait et ne doit pas taire : sauvegarde manquée, schéma abîmé. */
  warnings: string[];
}
