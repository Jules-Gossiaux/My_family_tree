import { newId, now } from './id';

/**
 * Modèle v3 — les faits de vie, les lieux, les sources et les médias sont des
 * entités à part entière, référencées par identifiant. La fiche personne garde
 * les champs simples qui servent à l'arbre (dates, adresse, cimetière) ; les
 * faits détaillés vivent dans `events`.
 *
 * Règles d'union inchangées : deux slots, liens de filiation typés, jamais de
 * fusion automatique d'un doublon. Phase 2 (Supabase) : les tableaux deviennent
 * des tables SQL avec RLS sur `family_id`, et `media.key` devient un chemin du
 * bucket Storage `${family_id}/${media.id}`. Aucun changement de forme prévu.
 */

export type Id = string;

export type Gender = 'male' | 'female' | 'other' | 'unspecified';

/** Nature du lien entre un partenaire d'une union et un enfant. */
export type LinkType =
  | 'biological'
  | 'adoptive'
  | 'legal'
  | 'step'
  | 'unknown';

export const LINK_LABELS: Record<LinkType, string> = {
  biological: 'Biologique',
  adoptive: 'Adoptif',
  legal: 'Légal',
  step: 'Beau-parent',
  unknown: 'Non renseigné',
};

export const FILIATION_TYPES: LinkType[] = [
  'biological',
  'adoptive',
  'legal',
  'step',
  'unknown',
];

export const LINK_DESCRIPTIONS: Record<LinkType, string> = {
  biological: 'Parent biologique : branche pleine, filiation de naissance.',
  adoptive: 'Parent adoptif : branche en tirets, filiation reconnue.',
  legal: 'Lien légal (tutelle, reconnaissance) : branche en pointillés longs.',
  step: 'Beau-parent : aucune branche de filiation, seul le couple est dessiné.',
  unknown: 'Nature du lien non renseignée : branche discrète.',
};

export type UnionStatus =
  | 'married'
  | 'partnered'
  | 'separated'
  | 'divorced'
  | 'widowed'
  | 'unknown';

export const UNION_STATUS_LABELS: Record<UnionStatus, string> = {
  married: 'Mariés',
  partnered: 'En couple',
  separated: 'Séparés',
  divorced: 'Divorcés',
  widowed: 'Veuvage',
  unknown: 'Non renseigné',
};

export const UNION_STATUSES: UnionStatus[] = [
  'married',
  'partnered',
  'separated',
  'divorced',
  'widowed',
  'unknown',
];

/** Type d'un fait de vie. La liste est ouverte : `other` + titre libre. */
export type EventType =
  | 'birth'
  | 'death'
  | 'marriage'
  | 'divorce'
  | 'baptism'
  | 'burial'
  | 'census'
  | 'residence'
  | 'occupation'
  | 'military'
  | 'education'
  | 'other';

export const EVENT_LABELS: Record<EventType, string> = {
  birth: 'Naissance',
  death: 'Décès',
  marriage: 'Mariage',
  divorce: 'Divorce',
  baptism: 'Baptême',
  burial: 'Sépulture',
  census: 'Recensement',
  residence: 'Déménagement',
  occupation: 'Profession',
  military: 'Service militaire',
  education: 'Scolarité',
  other: 'Autre fait',
};

export const EVENT_TYPES = Object.keys(EVENT_LABELS) as EventType[];

export function eventLabelFor(type: EventType): string {
  return EVENT_LABELS[type];
}

/** Rôle d'une personne dans un événement. Champ libre complété à la saisie. */
export const PARTICIPANT_ROLES = [
  'principal',
  'conjoint',
  'parent',
  'enfant',
  'témoin',
  'officiant',
  'informateur',
  'autre',
] as const;

export const PARTICIPANT_ROLE_LABELS: Record<string, string> = {
  principal: 'Personne concernée',
  conjoint: 'Conjoint',
  parent: 'Parent',
  enfant: 'Enfant',
  témoin: 'Témoin',
  officiant: 'Officier d’état civil',
  informateur: 'Informateur',
  autre: 'Autre rôle',
};

export type PlaceKind =
  | 'city'
  | 'address'
  | 'hospital'
  | 'church'
  | 'cemetery'
  | 'region'
  | 'country'
  | 'other';

export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  city: 'Commune',
  address: 'Adresse',
  hospital: 'Hôpital',
  church: 'Église',
  cemetery: 'Cimetière',
  region: 'Région',
  country: 'Pays',
  other: 'Autre lieu',
};

export const PLACE_KINDS = Object.keys(PLACE_KIND_LABELS) as PlaceKind[];

export type SourceKind =
  | 'civil'
  | 'census'
  | 'parish'
  | 'archive'
  | 'book'
  | 'web'
  | 'oral'
  | 'family'
  | 'other';

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  civil: 'État civil',
  census: 'Recensement',
  parish: 'Registre paroissial',
  archive: 'Archive',
  book: 'Livre',
  web: 'Site web',
  oral: 'Témoignage oral',
  family: 'Documents familiaux',
  other: 'Autre source',
};

export const SOURCE_KINDS = Object.keys(SOURCE_KIND_LABELS) as SourceKind[];

/** Cadrage du portrait : point de focalisation (0..1) et zoom (>= 1). */
export interface PortraitCrop {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_PORTRAIT_CROP: PortraitCrop = { x: 0.5, y: 0.5, zoom: 1 };

export interface EventParticipant {
  personId: Id;
  role: string;
}

/** Une citation pointe toujours vers une notice de source déclarée. */
export interface SourceCitation {
  sourceId: Id;
  detail?: string;
}

export interface LifeEvent {
  id: Id;
  familyId: Id;
  type: EventType;
  title?: string;
  /** Texte libre : mêmes règles que les dates de la fiche. */
  date?: string;
  placeId?: Id;
  notes?: string;
  participants: EventParticipant[];
  citations: SourceCitation[];
  mediaIds: Id[];
  /** Lien optionnel vers une union, pour un mariage par exemple. */
  unionId?: Id;
  createdAt: string;
  updatedAt: string;
}

export interface Place {
  id: Id;
  familyId: Id;
  name: string;
  kind: PlaceKind;
  /** Hiérarchie légère et optionnelle : commune → région → pays. */
  parentId?: Id;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: Id;
  familyId: Id;
  /** Cote de la notice : unique dans la famille, casse et accents ignorés. */
  reference: string;
  title: string;
  kind: SourceKind;
  url?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type MediaKind = 'photo' | 'document';

/**
 * Un média est partagé : il appartient à la famille et porte la liste des
 * personnes auxquelles il est rattaché. `key` est la clé du stockage d'octets
 * (IndexedDB ici, chemin Storage demain), jamais une donnée binaire en JSON.
 */
export interface Media {
  id: Id;
  familyId: Id;
  kind: MediaKind;
  key: string;
  fileName: string;
  mimeType: string;
  title?: string;
  date?: string;
  personIds: Id[];
  citations: SourceCitation[];
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: Id;
  familyId: Id;
  firstName: string;
  lastName: string;
  gender: Gender;
  /** Texte libre : « vers 1890 », « avant 1914 », ISO historique… */
  birthDate?: string;
  deathDate?: string;
  /** Coordonnées (cimetière uniquement affiché si décès renseigné). */
  address?: string;
  phone?: string;
  email?: string;
  cemetery?: string;
  /** Ancien champ v2 : conservé à l'import, transformé en média partagé. */
  photoUrl?: string;
  bio?: string;
  notes?: string;
  /** Média choisi comme portrait, avec le cadrage propre à cette personne. */
  portraitMediaId?: Id;
  portraitCrop?: PortraitCrop;
  /** Lieux nommés cités depuis la fiche. */
  addressPlaceId?: Id;
  cemeteryPlaceId?: Id;
  /** Événements naissance/décès créés automatiquement et maintenus synchros. */
  defaultBirthEventId?: Id;
  defaultDeathEventId?: Id;
  createdAt: string;
  updatedAt: string;
}

export interface UnionChild {
  childId: Id;
  linkA: LinkType;
  linkB: LinkType;
}

export interface Union {
  id: Id;
  familyId: Id;
  /** null = slot à compléter (second parent non renseigné). */
  partnerAId: Id | null;
  partnerBId: Id | null;
  /** Ordre du tableau = ordre d'affichage de la fratrie. */
  children: UnionChild[];
  status: UnionStatus;
  startDate?: string;
  endDate?: string;
  /** Conjoint actuel, par opposition aux unions anciennes. */
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyData {
  version: 3;
  familyId: Id;
  persons: Person[];
  unions: Union[];
  places: Place[];
  sources: Source[];
  events: LifeEvent[];
  media: Media[];
  updatedAt: string;
}

export interface NewPersonInput {
  firstName: string;
  lastName: string;
  gender: Gender;
  birthDate?: string;
  deathDate?: string;
  address?: string;
  phone?: string;
  email?: string;
  cemetery?: string;
  notes?: string;
}

export interface UnionMetaInput {
  status: UnionStatus;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
}

export interface MutationResult {
  data: FamilyData;
  personId: Id;
}

export function emptyFamily(): FamilyData {
  return {
    version: 3,
    familyId: newId(),
    persons: [],
    unions: [],
    places: [],
    sources: [],
    events: [],
    media: [],
    updatedAt: now(),
  };
}

export function createPerson(familyId: Id, input: NewPersonInput): Person {
  const timestamp = now();
  return {
    id: newId(),
    familyId,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    gender: input.gender,
    birthDate: input.birthDate?.trim() || undefined,
    deathDate: input.deathDate?.trim() || undefined,
    address: input.address?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    cemetery: input.cemetery?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createUnion(
  familyId: Id,
  partnerAId: Id | null,
  partnerBId: Id | null,
  children: UnionChild[] = [],
  meta: Partial<UnionMetaInput> = {},
): Union {
  const timestamp = now();
  return {
    id: newId(),
    familyId,
    partnerAId,
    partnerBId,
    children,
    status: meta.status ?? (partnerAId && partnerBId ? 'partnered' : 'unknown'),
    startDate: meta.startDate,
    endDate: meta.endDate,
    isCurrent: meta.isCurrent ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface PlaceInput {
  name: string;
  kind: PlaceKind;
  parentId?: Id;
  notes?: string;
}

export function createPlace(familyId: Id, input: PlaceInput): Place {
  const timestamp = now();
  return {
    id: newId(),
    familyId,
    name: input.name.trim(),
    kind: input.kind,
    parentId: input.parentId,
    notes: input.notes?.trim() || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface SourceInput {
  reference: string;
  title: string;
  kind: SourceKind;
  url?: string;
  notes?: string;
}

export function createSource(familyId: Id, input: SourceInput): Source {
  const timestamp = now();
  return {
    id: newId(),
    familyId,
    reference: input.reference.trim(),
    title: input.title.trim(),
    kind: input.kind,
    url: input.url?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface LifeEventInput {
  type: EventType;
  title?: string;
  date?: string;
  placeId?: Id;
  notes?: string;
  participants: EventParticipant[];
  citations?: SourceCitation[];
  mediaIds?: Id[];
  unionId?: Id;
}

export function createLifeEvent(
  familyId: Id,
  input: LifeEventInput,
): LifeEvent {
  const timestamp = now();
  return {
    id: newId(),
    familyId,
    type: input.type,
    title: input.title?.trim() || undefined,
    date: input.date?.trim() || undefined,
    placeId: input.placeId,
    notes: input.notes?.trim() || undefined,
    participants: input.participants,
    citations: input.citations ?? [],
    mediaIds: input.mediaIds ?? [],
    unionId: input.unionId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface MediaInput {
  kind: MediaKind;
  /** Fourni par `addMedia` ; présent ici pour les imports directs. */
  key?: string;
  fileName: string;
  mimeType: string;
  personIds?: Id[];
  title?: string;
}

export function createMedia(familyId: Id, input: MediaInput): Media {
  const timestamp = now();
  return {
    id: newId(),
    familyId,
    kind: input.kind,
    key: input.key ?? mediaKey(familyId, 'pending'),
    fileName: input.fileName.trim(),
    mimeType: input.mimeType,
    personIds: input.personIds ?? [],
    title: input.title?.trim() || undefined,
    citations: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Clé de stockage stable, déjà au format du futur bucket Supabase. */
export function mediaKey(familyId: Id, mediaId: Id): string {
  return `${familyId}/${mediaId}`;
}

export function touch(data: FamilyData): FamilyData {
  return { ...data, updatedAt: now() };
}

export function personLabel(person: Person): string {
  const full = `${person.firstName} ${person.lastName}`.trim();
  return full || 'Sans nom';
}

export function unionPartnerIds(union: Union): Id[] {
  const result: Id[] = [];
  if (union.partnerAId) result.push(union.partnerAId);
  if (union.partnerBId) result.push(union.partnerBId);
  return result;
}

export type UnionSlot = 'A' | 'B';

/** Un lien « step » n'est PAS une filiation : il ne dessine aucune branche. */
export function isFiliationLink(link: LinkType): boolean {
  return link !== 'step';
}

/** Au moins un des deux partenaires a un lien de filiation vers cet enfant. */
export function unionHasFiliation(child: UnionChild): boolean {
  return isFiliationLink(child.linkA) || isFiliationLink(child.linkB);
}

/**
 * Union « fantôme » : elle porte moins de DEUX branches visibles. Un nœud
 * d'union n'a de sens que comme jonction :
 *   - 2 partenaires        → couple, même sans enfant ;
 *   - 1 partenaire + 1 enfant → parent isolé avec son enfant ;
 *   - 0 partenaire + 2 enfants → ancre d'une fratrie aux parents inconnus.
 *
 * Tout le reste (0 partenaire + 1 enfant, 1 partenaire sans enfant, union
 * vide) laisse un cercle isolé et une branche morte au-dessus d'une personne :
 * c'est exactement ce qui apparaissait après la suppression des parents.
 *
 * On compte les branches réellement DESSINÉES : un lien « step » des deux
 * côtés ne produit aucune branche de filiation et ne justifie pas l'union.
 */
export function isGhostUnion(union: Union): boolean {
  const branches =
    unionPartnerIds(union).length +
    union.children.filter(unionHasFiliation).length;
  return branches < 2;
}

/**
 * Invariant à l'échelle de l'arbre : aucune union morte ne survit à une
 * suppression, un import ou une migration. Les personnes ne sont jamais
 * supprimées ici — seule la coquille d'union vide est retirée.
 */
export function pruneGhostUnions(data: FamilyData): FamilyData {
  const unions = data.unions.filter((union) => !isGhostUnion(union));
  return unions.length === data.unions.length
    ? data
    : touch({ ...data, unions });
}

/** Invariant : un enfant n'a qu'UNE union portant un lien biologique. */
export function unionHasBiological(child: UnionChild): boolean {
  return child.linkA === 'biological' || child.linkB === 'biological';
}

export function freeSlot(union: Union): UnionSlot | null {
  if (!union.partnerAId) return 'A';
  if (!union.partnerBId) return 'B';
  return null;
}

export function slotOfPartner(union: Union, personId: Id): UnionSlot | null {
  if (union.partnerAId === personId) return 'A';
  if (union.partnerBId === personId) return 'B';
  return null;
}

export function partnerInSlot(union: Union, slot: UnionSlot): Id | null {
  return slot === 'A' ? union.partnerAId : union.partnerBId;
}

export function linkInSlot(child: UnionChild, slot: UnionSlot): LinkType {
  return slot === 'A' ? child.linkA : child.linkB;
}

export function withPartnerInSlot(
  union: Union,
  slot: UnionSlot,
  personId: Id | null,
): Union {
  return slot === 'A'
    ? { ...union, partnerAId: personId }
    : { ...union, partnerBId: personId };
}

export function withLinkInSlot(
  child: UnionChild,
  slot: UnionSlot,
  link: LinkType,
): UnionChild {
  return slot === 'A' ? { ...child, linkA: link } : { ...child, linkB: link };
}

export function linkOfPartner(
  union: Union,
  personId: Id,
  child: UnionChild,
): LinkType | null {
  const slot = slotOfPartner(union, personId);
  return slot ? linkInSlot(child, slot) : null;
}

/** Nature de la branche union → enfant : le lien le plus fort des deux slots. */
export function dominantLink(child: UnionChild): LinkType {
  const links = [child.linkA, child.linkB].filter(isFiliationLink);
  if (links.includes('biological')) return 'biological';
  if (links.includes('adoptive')) return 'adoptive';
  if (links.includes('legal')) return 'legal';
  return 'unknown';
}
