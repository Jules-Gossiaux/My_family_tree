import { normalizedReference } from './directories';
import { blobToDataUrl, dataUrlToBlob, mediaStore } from './mediaStore';
import { syncDefaultLifeEvents } from './lifeEvents';
import { newId, now } from './id';
import {
  emptyFamily,
  pruneGhostUnions,
  touch,
  type FamilyData,
  type Gender,
  type Id,
  type LifeEvent,
  type LinkType,
  type Media,
  type Person,
  type Place,
  type PortraitCrop,
  type Source,
  type Union,
  type UnionChild,
  type UnionStatus,
} from './types';

const STORAGE_KEY = 'simple-family-tree:v3';
/** Anciens emplacements : conservés tels quels, lus une seule fois pour migrer. */
const LEGACY_KEYS = ['simple-family-tree:v2', 'simple-family-tree:v1'];

/**
 * Contrat unique de persistance. L'implémentation locale est asynchrone pour
 * pouvoir être remplacée par SupabaseFamilyRepository sans toucher l'UI.
 */
export interface FamilyRepository {
  load(): Promise<FamilyData>;
  save(data: FamilyData): Promise<void>;
  clear(): Promise<void>;
}

export class LocalFamilyRepository implements FamilyRepository {
  async load(): Promise<FamilyData> {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return validateFamilyData(JSON.parse(raw));

      for (const legacyKey of LEGACY_KEYS) {
        const legacy = window.localStorage.getItem(legacyKey);
        if (!legacy) continue;
        const migrated = validateFamilyData(JSON.parse(legacy));
        // On écrit tout de suite en v3 sans effacer l'ancienne clé : elle
        // reste intacte et sert de sauvegarde.
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return emptyFamily();
    } catch (error) {
      console.warn('Impossible de lire les données locales, arbre vide.', error);
      return emptyFamily();
    }
  }

  async save(data: FamilyData): Promise<void> {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(touch(data)));
    } catch (error) {
      console.warn('Impossible de sauvegarder les données locales.', error);
    }
  }

  async clear(): Promise<void> {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
      await mediaStore.clear();
    } catch (error) {
      console.warn('Impossible de réinitialiser le stockage local.', error);
    }
  }
}

/** JSON nu, sans fichiers : conservé pour les outils et les tests. */
export function serialize(data: FamilyData): string {
  return JSON.stringify(touch(data), null, 2);
}

/** Export complet : document v3 + octets des médias, réimportable tel quel. */
export async function exportFamilyBundle(data: FamilyData): Promise<Blob> {
  const mediaFiles: Array<{ key: string; dataUrl: string }> = [];
  for (const medium of data.media) {
    try {
      const blob = await mediaStore.get(medium.key);
      if (blob) mediaFiles.push({ key: medium.key, dataUrl: await blobToDataUrl(blob) });
    } catch (error) {
      console.warn('Média omitted de l’export :', medium.key, error);
    }
  }
  return new Blob(
    [
      JSON.stringify(
        {
          format: 'simple-family-tree',
          exportedAt: now(),
          document: touch(data),
          mediaFiles,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
}

export interface ParseResult {
  data: FamilyData;
  migratedFrom?: 1 | 2;
  mediaRestored: number;
}

/** Accepte un export complet, un document v3, ou un ancien export v1/v2. */
export async function parseFamilyDocument(raw: string): Promise<ParseResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Le fichier n’est pas un JSON valide.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Le fichier ne contient pas un arbre généalogique.');
  }
  const wrapper = parsed as Record<string, unknown>;
  const source = wrapper.document ?? parsed;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Le document est illisible.');
  }
  const obj = source as Record<string, unknown>;
  if (obj.version !== 1 && obj.version !== 2 && obj.version !== 3) {
    throw new Error('Version de fichier non prise en charge (attendu : 1, 2 ou 3).');
  }
  if (!Array.isArray(obj.persons) || !Array.isArray(obj.unions)) {
    throw new Error('Les champs « persons » et « unions » sont requis.');
  }

  let mediaRestored = 0;
  const files = Array.isArray(wrapper.mediaFiles) ? wrapper.mediaFiles : [];
  for (const entry of files) {
    if (!entry || typeof entry !== 'object') continue;
    const file = entry as Record<string, unknown>;
    if (typeof file.key !== 'string' || typeof file.dataUrl !== 'string') continue;
    try {
      await mediaStore.put(file.key, dataUrlToBlob(file.dataUrl));
      mediaRestored += 1;
    } catch (error) {
      console.warn('Impossible de restaurer un média :', file.key, error);
    }
  }

  return {
    data: validateFamilyData(source),
    migratedFrom: obj.version === 1 ? 1 : obj.version === 2 ? 2 : undefined,
    mediaRestored,
  };
}

/**
 * Nettoie un document (import, localStorage corrompu, migration). Les anciennes
 * formes d'union sont acceptées ; les références pendantes sont écartées, mais
 * aucune information valide n'est perdue. C'est aussi ce qui répare un arbre
 * enregistré avant un correctif : au prochain chargement, les nœuds morts
 * disparaissent.
 */
export function validateFamilyData(value: unknown): FamilyData {
  if (!value || typeof value !== 'object') return emptyFamily();
  const obj = value as Record<string, unknown>;
  const familyId =
    typeof obj.familyId === 'string' && obj.familyId.length > 0
      ? obj.familyId
      : newId();

  const seenPersons = new Set<string>();
  const persons: Person[] = [];
  const rawPersons = Array.isArray(obj.persons) ? obj.persons : [];
  for (const entry of rawPersons) {
    if (!entry || typeof entry !== 'object') continue;
    const p = entry as Record<string, unknown>;
    const id = typeof p.id === 'string' && p.id ? p.id : newId();
    if (seenPersons.has(id)) continue;
    seenPersons.add(id);
    const timestamp = asString(p.createdAt, now());
    persons.push({
      id,
      familyId,
      firstName: asString(p.firstName),
      lastName: asString(p.lastName),
      gender: asGender(p.gender),
      birthDate: asOptionalString(p.birthDate),
      deathDate: asOptionalString(p.deathDate),
      address: asOptionalString(p.address),
      phone: asOptionalString(p.phone),
      email: asOptionalString(p.email),
      cemetery: asOptionalString(p.cemetery),
      photoUrl: asOptionalString(p.photoUrl),
      bio: asOptionalString(p.bio),
      notes: asOptionalString(p.notes),
      portraitMediaId: typeof p.portraitMediaId === 'string' ? p.portraitMediaId : undefined,
      portraitCrop: readPortraitCrop(p.portraitCrop),
      cemeteryPlaceId: typeof p.cemeteryPlaceId === 'string' ? p.cemeteryPlaceId : undefined,
      defaultBirthEventId:
        typeof p.defaultBirthEventId === 'string' ? p.defaultBirthEventId : undefined,
      defaultDeathEventId:
        typeof p.defaultDeathEventId === 'string' ? p.defaultDeathEventId : undefined,
      createdAt: timestamp,
      updatedAt: asString(p.updatedAt, timestamp),
    });
  }

  const personIds = new Set(persons.map((person) => person.id));
  const seenUnions = new Set<string>();
  const unions: Union[] = [];
  const rawUnions = Array.isArray(obj.unions) ? obj.unions : [];
  for (const entry of rawUnions) {
    const union = readUnion(entry, familyId, personIds);
    if (!union || seenUnions.has(union.id)) continue;
    seenUnions.add(union.id);
    unions.push(union);
  }

  const places = readPlaces(obj.places, familyId);
  const sources = readSources(obj.sources, familyId);
  const media = readMedia(obj.media, familyId, personIds, persons);
  const mediaIds = new Set(media.map((medium) => medium.id));
  const placeIds = new Set(places.map((place) => place.id));
  const sourceIds = new Set(sources.map((source) => source.id));
  const unionIds = new Set(unions.map((union) => union.id));

  const events = readEvents(obj.events, familyId).filter((event) => {
    const participants = event.participants.filter((p) => personIds.has(p.personId));
    if (participants.length === 0) return false;
    event.participants = participants;
    if (event.placeId && !placeIds.has(event.placeId)) event.placeId = undefined;
    event.citations = event.citations.filter((c) => sourceIds.has(c.sourceId));
    event.mediaIds = event.mediaIds.filter((id) => mediaIds.has(id));
    if (event.unionId && !unionIds.has(event.unionId)) event.unionId = undefined;
    return true;
  });

  // Un portrait orphelin ou rattaché à une autre personne est écarté ; la
  // personne et le média sont conservés.
  const normalizedPersons = persons.map((person) => {
    const patch: Partial<Person> = {};
    if (person.portraitMediaId && !mediaIds.has(person.portraitMediaId)) {
      patch.portraitMediaId = undefined;
    }
    if (person.cemeteryPlaceId && !placeIds.has(person.cemeteryPlaceId)) {
      patch.cemeteryPlaceId = undefined;
    }
    if (person.defaultBirthEventId && !events.some((e) => e.id === person.defaultBirthEventId)) {
      patch.defaultBirthEventId = undefined;
    }
    if (person.defaultDeathEventId && !events.some((e) => e.id === person.defaultDeathEventId)) {
      patch.defaultDeathEventId = undefined;
    }
    return Object.keys(patch).length > 0 ? { ...person, ...patch } : person;
  });

  const withDefaults = syncDefaultLifeEvents({
    version: 3,
    familyId,
    persons: normalizedPersons,
    unions,
    places,
    sources,
    events,
    media,
    updatedAt: asString(obj.updatedAt, now()),
  });

  return pruneGhostUnions(withDefaults);
}

function readPortraitCrop(value: unknown): PortraitCrop | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const crop = value as Record<string, unknown>;
  if (
    typeof crop.x !== 'number' ||
    typeof crop.y !== 'number' ||
    typeof crop.zoom !== 'number'
  ) {
    return undefined;
  }
  return {
    x: Math.min(1, Math.max(0, crop.x)),
    y: Math.min(1, Math.max(0, crop.y)),
    zoom: Math.max(1, crop.zoom),
  };
}

function readUnion(
  entry: unknown,
  familyId: string,
  personIds: Set<string>,
): Union | null {
  if (!entry || typeof entry !== 'object') return null;
  const u = entry as Record<string, unknown>;
  const id = typeof u.id === 'string' && u.id ? u.id : newId();
  const timestamp = asString(u.createdAt, now());

  // Partenaires : deux slots explicites en v2+, tableau en v1.
  const legacyPartners = Array.isArray(u.partnerIds)
    ? uniqueIds(u.partnerIds, personIds).slice(0, 2)
    : null;
  let partnerAId: string | null = legacyPartners
    ? (legacyPartners[0] ?? null)
    : validId(u.partnerAId, personIds);
  let partnerBId: string | null = legacyPartners
    ? (legacyPartners[1] ?? null)
    : validId(u.partnerBId, personIds);
  if (partnerAId && partnerAId === partnerBId) partnerBId = null;

  const rawChildren: unknown[] = Array.isArray(u.children)
    ? u.children
    : Array.isArray(u.childIds)
      ? u.childIds
      : [];
  const children: UnionChild[] = [];
  const seenChildren = new Set<string>();
  for (const raw of rawChildren) {
    const childId =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object'
          ? (raw as Record<string, unknown>).childId
          : undefined;
    if (typeof childId !== 'string' || !personIds.has(childId)) continue;
    if (seenChildren.has(childId)) continue;
    if (childId === partnerAId || childId === partnerBId) continue;
    seenChildren.add(childId);

    if (typeof raw === 'string') {
      children.push({ childId, linkA: 'biological', linkB: 'biological' });
    } else {
      const c = raw as Record<string, unknown>;
      children.push({
        childId,
        linkA: asLinkType(c.linkA, 'unknown'),
        linkB: asLinkType(c.linkB, 'unknown'),
      });
    }
  }

  if (!partnerAId && !partnerBId && children.length === 0) return null;

  const status = asStatus(u.status, partnerAId && partnerBId ? 2 : 1);
  return {
    id,
    familyId,
    partnerAId,
    partnerBId,
    children,
    status,
    startDate: asOptionalString(u.startDate),
    endDate: asOptionalString(u.endDate),
    isCurrent:
      typeof u.isCurrent === 'boolean'
        ? u.isCurrent
        : !['separated', 'divorced', 'widowed'].includes(status),
    createdAt: timestamp,
    updatedAt: asString(u.updatedAt, timestamp),
  };
}

function readPlaces(value: unknown, familyId: string): Place[] {
  if (!Array.isArray(value)) return [];
  const places: Place[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const p = entry as Record<string, unknown>;
    const id = typeof p.id === 'string' && p.id ? p.id : newId();
    const name = asString(p.name).trim();
    if (!name || seen.has(id)) continue;
    seen.add(id);
    const timestamp = asString(p.createdAt, now());
    places.push({
      id,
      familyId,
      name,
      kind: asPlaceKind(p.kind),
      parentId: typeof p.parentId === 'string' ? p.parentId : undefined,
      notes: asOptionalString(p.notes),
      createdAt: timestamp,
      updatedAt: asString(p.updatedAt, timestamp),
    });
  }
  const ids = new Set(places.map((place) => place.id));
  return places.map((place) => ({
    ...place,
    parentId: place.parentId && ids.has(place.parentId) && place.parentId !== place.id
      ? place.parentId
      : undefined,
  }));
}

function readSources(value: unknown, familyId: string): Source[] {
  if (!Array.isArray(value)) return [];
  const sources: Source[] = [];
  const seen = new Set<string>();
  const references = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const id = typeof s.id === 'string' && s.id ? s.id : newId();
    const reference = asString(s.reference).trim();
    const key = normalizedReference(reference);
    if (!reference || seen.has(id) || references.has(key)) continue;
    seen.add(id);
    references.add(key);
    const timestamp = asString(s.createdAt, now());
    sources.push({
      id,
      familyId,
      reference,
      title: asString(s.title).trim() || reference,
      kind: asSourceKind(s.kind),
      url: asOptionalString(s.url),
      notes: asOptionalString(s.notes),
      createdAt: timestamp,
      updatedAt: asString(s.updatedAt, timestamp),
    });
  }
  return sources;
}

function readMedia(
  value: unknown,
  familyId: string,
  personIds: Set<string>,
  persons: Person[],
): Media[] {
  const media: Media[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const m = entry as Record<string, unknown>;
      const id = typeof m.id === 'string' && m.id ? m.id : newId();
      if (seen.has(id)) continue;
      seen.add(id);
      const timestamp = asString(m.createdAt, now());
      media.push({
        id,
        familyId,
        kind: m.kind === 'document' ? 'document' : 'photo',
        key: asString(m.key) || `${familyId}/${id}`,
        fileName: asString(m.fileName) || 'fichier',
        mimeType: asString(m.mimeType) || 'application/octet-stream',
        title: asOptionalString(m.title),
        date: asOptionalString(m.date),
        personIds: uniqueIds(
          Array.isArray(m.personIds) ? m.personIds : [],
          personIds,
        ),
        citations: readCitations(m.citations),
        createdAt: timestamp,
        updatedAt: asString(m.updatedAt, timestamp),
      });
    }
  }

  // Migration v2 : un photoUrl devient un média partagé, désigné comme portrait.
  for (const person of persons) {
    if (!person.photoUrl) continue;
    const id = newId();
    const timestamp = now();
    media.push({
      id,
      familyId,
      kind: 'photo',
      key: person.photoUrl,
      fileName: 'photo importée',
      mimeType: 'image/*',
      title: `Portrait de ${person.firstName} ${person.lastName}`.trim(),
      personIds: [person.id],
      citations: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    person.portraitMediaId = id;
    // Le champ v2 est épuisé : le conserver recréerait un média à chaque
    // chargement du document v3.
    person.photoUrl = undefined;
  }
  return media;
}

function readEvents(value: unknown, familyId: string): LifeEvent[] {
  if (!Array.isArray(value)) return [];
  const events: LifeEvent[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' && e.id ? e.id : newId();
    if (seen.has(id)) continue;
    seen.add(id);
    const timestamp = asString(e.createdAt, now());
    const participants = Array.isArray(e.participants)
      ? e.participants
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map((p) => ({
            personId: asString(p.personId),
            role: asString(p.role, 'principal'),
          }))
          .filter((p) => !!p.personId)
      : [];
    events.push({
      id,
      familyId,
      type: asEventType(e.type),
      title: asOptionalString(e.title),
      date: asOptionalString(e.date),
      placeId: typeof e.placeId === 'string' ? e.placeId : undefined,
      notes: asOptionalString(e.notes),
      participants,
      citations: readCitations(e.citations),
      mediaIds: Array.isArray(e.mediaIds)
        ? e.mediaIds.filter((id): id is string => typeof id === 'string')
        : [],
      unionId: typeof e.unionId === 'string' ? e.unionId : undefined,
      createdAt: timestamp,
      updatedAt: asString(e.updatedAt, timestamp),
    });
  }
  return events;
}

function readCitations(value: unknown): Array<{ sourceId: Id; detail?: string }> {
  if (!Array.isArray(value)) return [];
  const result: Array<{ sourceId: Id; detail?: string }> = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const sourceId = typeof c.sourceId === 'string' ? c.sourceId : '';
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    result.push({ sourceId, detail: asOptionalString(c.detail) });
  }
  return result;
}

function uniqueIds(values: unknown[], valid: Set<string>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value === 'string' && valid.has(value) && !result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

function validId(value: unknown, valid: Set<string>): string | null {
  return typeof value === 'string' && valid.has(value) ? value : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

const GENDERS: Gender[] = ['male', 'female', 'other', 'unspecified'];

function asGender(value: unknown): Gender {
  return GENDERS.includes(value as Gender) ? (value as Gender) : 'unspecified';
}

const STATUSES: UnionStatus[] = [
  'married',
  'partnered',
  'separated',
  'divorced',
  'widowed',
  'unknown',
];

function asStatus(value: unknown, partnerCount: number): UnionStatus {
  if (STATUSES.includes(value as UnionStatus)) return value as UnionStatus;
  return partnerCount === 2 ? 'partnered' : 'unknown';
}

const LINKS: LinkType[] = [
  'biological',
  'adoptive',
  'legal',
  'step',
  'unknown',
];

function asLinkType(value: unknown, fallback: LinkType): LinkType {
  return LINKS.includes(value as LinkType) ? (value as LinkType) : fallback;
}

const EVENT_TYPES: LifeEvent['type'][] = [
  'birth',
  'death',
  'marriage',
  'divorce',
  'baptism',
  'burial',
  'census',
  'residence',
  'occupation',
  'military',
  'education',
  'other',
];

function asEventType(value: unknown): LifeEvent['type'] {
  return EVENT_TYPES.includes(value as LifeEvent['type'])
    ? (value as LifeEvent['type'])
    : 'other';
}

const PLACE_KINDS: Place['kind'][] = [
  'city',
  'address',
  'hospital',
  'church',
  'cemetery',
  'region',
  'country',
  'other',
];

function asPlaceKind(value: unknown): Place['kind'] {
  return PLACE_KINDS.includes(value as Place['kind'])
    ? (value as Place['kind'])
    : 'other';
}

const SOURCE_KINDS: Source['kind'][] = [
  'civil',
  'census',
  'parish',
  'archive',
  'book',
  'web',
  'oral',
  'family',
  'other',
];

function asSourceKind(value: unknown): Source['kind'] {
  return SOURCE_KINDS.includes(value as Source['kind'])
    ? (value as Source['kind'])
    : 'other';
}
