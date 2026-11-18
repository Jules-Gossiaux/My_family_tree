import { now } from './id';
import { eventsOfPerson } from './lifeEvents';
import {
  createMedia,
  createPlace,
  createSource,
  mediaKey,
  touch,
  type FamilyData,
  type Id,
  type Media,
  type MediaInput,
  type PlaceInput,
  type PortraitCrop,
  type Source,
  type SourceInput,
  type SourceCitation,
} from './types';

/**
 * Répertoires partagés. Toute référence est un identifiant : renommer ne casse
 * rien, supprimer est refusé tant qu'une citation existe. Aucune fusion ni
 * suppression automatique d'un doublon.
 */

export interface Usage {
  kind: string;
  label: string;
}

function placeLabelOf(data: FamilyData, id: Id | undefined): string {
  if (!id) return '';
  const place = data.places.find((candidate) => candidate.id === id);
  if (!place) return '';
  const parent = place.parentId ? placeLabelOf(data, place.parentId) : '';
  return parent ? `${place.name}, ${parent}` : place.name;
}

export { placeLabelOf };

export function placeUsage(data: FamilyData, placeId: Id): Usage[] {
  const usage: Usage[] = [];
  for (const event of data.events) {
    if (event.placeId === placeId) {
      usage.push({
        kind: 'Fait de vie',
        label: event.title || event.type || 'Sans titre',
      });
    }
  }
  for (const person of data.persons) {
    if (person.cemeteryPlaceId === placeId) {
      usage.push({ kind: 'Sépulture', label: `${person.firstName} ${person.lastName}`.trim() });
    }
  }
  for (const place of data.places) {
    if (place.parentId === placeId) {
      usage.push({ kind: 'Lieu parent', label: place.name });
    }
  }
  return usage;
}

export function sourceUsage(data: FamilyData, sourceId: Id): Usage[] {
  const usage: Usage[] = [];
  const cited = (citations: SourceCitation[]) =>
    citations.some((citation) => citation.sourceId === sourceId);
  for (const event of data.events) {
    if (cited(event.citations)) {
      usage.push({
        kind: 'Fait de vie',
        label: event.title || event.type || 'Sans titre',
      });
    }
  }
  for (const medium of data.media) {
    if (cited(medium.citations)) {
      usage.push({ kind: 'Média', label: medium.title || medium.fileName });
    }
  }
  return usage;
}

function isDescendantPlace(data: FamilyData, candidate: Id, ancestor: Id): boolean {
  let current: Id | undefined = candidate;
  const seen = new Set<Id>();
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = data.places.find((place) => place.id === current)?.parentId;
  }
  return false;
}

export function addPlace(data: FamilyData, input: PlaceInput): FamilyData {
  const name = input.name.trim();
  if (!name) return data;
  const place = createPlace(data.familyId, {
    ...input,
    name,
    parentId: input.parentId && data.places.some((p) => p.id === input.parentId)
      ? input.parentId
      : undefined,
  });
  return touch({ ...data, places: [...data.places, place] });
}

export function renamePlace(
  data: FamilyData,
  placeId: Id,
  patch: Partial<PlaceInput>,
): FamilyData {
  if (patch.parentId && isDescendantPlace(data, patch.parentId, placeId)) return data;
  return touch({
    ...data,
    places: data.places.map((place) =>
      place.id === placeId
        ? {
            ...place,
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
            ...(patch.parentId !== undefined ? { parentId: patch.parentId || undefined } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes.trim() || undefined } : {}),
            updatedAt: now(),
          }
        : place,
    ),
  });
}

export function deletePlace(data: FamilyData, placeId: Id): FamilyData {
  if (placeUsage(data, placeId).length > 0) return data;
  return touch({ ...data, places: data.places.filter((place) => place.id !== placeId) });
}

export function normalizedReference(reference: string): string {
  return reference.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function duplicateSource(
  data: FamilyData,
  reference: string,
  exceptId?: Id,
): Source | undefined {
  const key = normalizedReference(reference);
  if (!key) return undefined;
  return data.sources.find(
    (source) => source.id !== exceptId && normalizedReference(source.reference) === key,
  );
}

export function addSource(data: FamilyData, input: SourceInput): FamilyData {
  if (!input.reference.trim() || duplicateSource(data, input.reference)) return data;
  const source = createSource(data.familyId, input);
  return touch({ ...data, sources: [...data.sources, source] });
}

export function renameSource(
  data: FamilyData,
  sourceId: Id,
  patch: Partial<SourceInput>,
): FamilyData {
  if (patch.reference && duplicateSource(data, patch.reference, sourceId)) return data;
  return touch({
    ...data,
    sources: data.sources.map((source) =>
      source.id === sourceId
        ? {
            ...source,
            ...(patch.reference !== undefined ? { reference: patch.reference.trim() } : {}),
            ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
            ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
            ...(patch.url !== undefined ? { url: patch.url.trim() || undefined } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes.trim() || undefined } : {}),
            updatedAt: now(),
          }
        : source,
    ),
  });
}

export function deleteSource(data: FamilyData, sourceId: Id): FamilyData {
  if (sourceUsage(data, sourceId).length > 0) return data;
  return touch({ ...data, sources: data.sources.filter((source) => source.id !== sourceId) });
}

// ---------------------------------------------------------------------------
// Médias partagés
// ---------------------------------------------------------------------------

export function mediaOfPerson(data: FamilyData, personId: Id): Media[] {
  return data.media.filter((medium) => medium.personIds.includes(personId));
}

export function addMedia(data: FamilyData, input: MediaInput): Media {
  // L'appelant crée l'objet pour connaître son id : la clé de stockage en dépend.
  const prepared = createMedia(data.familyId, {
    ...input,
    key: mediaKey(data.familyId, 'pending'),
  });
  return { ...prepared, key: mediaKey(data.familyId, prepared.id) };
}

export function insertMedia(data: FamilyData, medium: Media): FamilyData {
  if (data.media.some((candidate) => candidate.id === medium.id)) return data;
  return touch({ ...data, media: [...data.media, medium] });
}

export function updateMedia(
  data: FamilyData,
  mediaId: Id,
  patch: Partial<Pick<Media, 'title' | 'date' | 'citations' | 'personIds'>>,
): FamilyData {
  return touch({
    ...data,
    media: data.media.map((medium) =>
      medium.id === mediaId
        ? {
            ...medium,
            ...(patch.title !== undefined ? { title: patch.title.trim() || undefined } : {}),
            ...(patch.date !== undefined ? { date: patch.date.trim() || undefined } : {}),
            ...(patch.citations !== undefined ? { citations: patch.citations } : {}),
            ...(patch.personIds !== undefined ? { personIds: patch.personIds } : {}),
            updatedAt: now(),
          }
        : medium,
    ),
  });
}

export function linkMedia(data: FamilyData, mediaId: Id, personId: Id): FamilyData {
  return touch({
    ...data,
    media: data.media.map((medium) =>
      medium.id === mediaId && !medium.personIds.includes(personId)
        ? { ...medium, personIds: [...medium.personIds, personId], updatedAt: now() }
        : medium,
    ),
  });
}

export function unlinkMedia(data: FamilyData, mediaId: Id, personId: Id): FamilyData {
  const media = data.media.map((medium) =>
    medium.id === mediaId
      ? {
          ...medium,
          personIds: medium.personIds.filter((id) => id !== personId),
          updatedAt: now(),
        }
      : medium,
  );
  const persons = data.persons.map((person) =>
    person.portraitMediaId === mediaId
      ? { ...person, portraitMediaId: undefined, updatedAt: now() }
      : person,
  );
  return touch({ ...data, media, persons });
}

export function deleteMedia(data: FamilyData, mediaId: Id): FamilyData {
  const media = data.media.filter((medium) => medium.id !== mediaId);
  const events = data.events.map((event) =>
    event.mediaIds.includes(mediaId)
      ? {
          ...event,
          mediaIds: event.mediaIds.filter((id) => id !== mediaId),
          updatedAt: now(),
        }
      : event,
  );
  const persons = data.persons.map((person) =>
    person.portraitMediaId === mediaId
      ? { ...person, portraitMediaId: undefined, updatedAt: now() }
      : person,
  );
  return touch({ ...data, media, events, persons });
}

export function setPortrait(data: FamilyData, personId: Id, mediaId: Id): FamilyData {
  const medium = data.media.find((candidate) => candidate.id === mediaId);
  if (!medium || !medium.personIds.includes(personId)) return data;
  return touch({
    ...data,
    persons: data.persons.map((person) =>
      person.id === personId ? { ...person, portraitMediaId: mediaId, updatedAt: now() } : person,
    ),
  });
}

export function setPortraitCrop(
  data: FamilyData,
  personId: Id,
  crop: PortraitCrop,
): FamilyData {
  return touch({
    ...data,
    persons: data.persons.map((person) =>
      person.id === personId ? { ...person, portraitCrop: crop, updatedAt: now() } : person,
    ),
  });
}

export function mediaUsageLabel(data: FamilyData, medium: Media): string {
  const names = medium.personIds
    .map((id) => data.persons.find((person) => person.id === id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person))
    .map((person) => `${person.firstName} ${person.lastName}`.trim());
  return names.length > 0 ? names.join(', ') : 'Aucune personne';
}

export function eventsOfMedia(data: FamilyData, mediaId: Id) {
  return data.events.filter((event) => event.mediaIds.includes(mediaId));
}

export function eventsUsingPlace(data: FamilyData, placeId: Id) {
  return data.events.filter((event) => event.placeId === placeId);
}

export function eventsUsingSource(data: FamilyData, sourceId: Id) {
  const cited = (citations: SourceCitation[]) =>
    citations.some((citation) => citation.sourceId === sourceId);
  return [...data.events.filter((event) => cited(event.citations)),
    ...data.media.filter((medium) => cited(medium.citations))];
}

/** Utilisé par les tests et l'UI : une personne supprimée ne doit plus apparaître. */
export function danglingPersonRefs(data: FamilyData): string[] {
  const valid = new Set(data.persons.map((person) => person.id));
  const problems: string[] = [];
  for (const event of data.events) {
    for (const participant of event.participants) {
      if (!valid.has(participant.personId)) problems.push(`event:${event.id}`);
    }
  }
  for (const medium of data.media) {
    for (const id of medium.personIds) {
      if (!valid.has(id)) problems.push(`media:${medium.id}`);
    }
  }
  for (const person of data.persons) {
    if (person.portraitMediaId && !data.media.some((m) => m.id === person.portraitMediaId)) {
      problems.push(`portrait:${person.id}`);
    }
    for (const event of eventsOfPerson(data, person.id)) {
      if (event.id === person.defaultBirthEventId || event.id === person.defaultDeathEventId) {
        continue;
      }
    }
  }
  return problems;
}
