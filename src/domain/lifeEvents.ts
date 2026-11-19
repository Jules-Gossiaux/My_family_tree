import { now } from './id';
import {
  createLifeEvent,
  touch,
  type FamilyData,
  type Id,
  type LifeEvent,
  type LifeEventInput,
  type Person,
} from './types';

/**
 * Les champs naissance/décès de la fiche restent la source de vérité affichée
 * sur l'arbre, mais ils créent aussi un événement par défaut. Un événement
 * enrichi (note, source, lieu, témoin…) n'est JAMAIS écrasé ni fusionné : si
 * la date de la fiche change, seul le `date` de l'événement par défaut suit.
 */

type DefaultKind = 'birth' | 'death';

interface SyncState {
  events: LifeEvent[];
  persons: Person[];
  changed: boolean;
}

function isBareEvent(event: LifeEvent): boolean {
  return (
    event.participants.length === 1 &&
    event.participants[0].role === 'principal' &&
    !event.title &&
    !event.placeId &&
    !event.notes &&
    !event.citations.length &&
    !event.mediaIds.length &&
    !event.unionId
  );
}

function syncOne(
  familyId: Id,
  person: Person,
  kind: DefaultKind,
  date: string | undefined,
  field: 'defaultBirthEventId' | 'defaultDeathEventId',
  state: SyncState,
): SyncState {
  let { events, persons, changed } = state;
  const linkedId = person[field];
  const linked = linkedId ? events.find((event) => event.id === linkedId) : undefined;
  const nextDate = date?.trim() || undefined;

  if (!nextDate) {
    if (linked) {
      if (isBareEvent(linked)) {
        events = events.filter((event) => event.id !== linked.id);
        persons = persons.map((candidate) =>
          candidate.id === person.id ? { ...candidate, [field]: undefined } : candidate,
        );
        changed = true;
      } else if (linked.date) {
        // Événement enrichi : on garde la notice, on efface seulement la date.
        events = events.map((event) =>
          event.id === linked.id
            ? { ...event, date: undefined, updatedAt: now() }
            : event,
        );
        persons = persons.map((candidate) =>
          candidate.id === person.id ? { ...candidate, [field]: undefined } : candidate,
        );
        changed = true;
      } else if (linkedId) {
        persons = persons.map((candidate) =>
          candidate.id === person.id ? { ...candidate, [field]: undefined } : candidate,
        );
        changed = true;
      }
    }
    return { events, persons, changed };
  }

  if (linked) {
    if (linked.date !== nextDate) {
      events = events.map((event) =>
        event.id === linked.id
          ? { ...event, date: nextDate, updatedAt: now() }
          : event,
      );
      changed = true;
    }
    return { events, persons, changed };
  }

  const event = createLifeEvent(familyId, {
    type: kind,
    date: nextDate,
    participants: [{ personId: person.id, role: 'principal' }],
  });
  events = [...events, event];
  persons = persons.map((candidate) =>
    candidate.id === person.id ? { ...candidate, [field]: event.id } : candidate,
  );
  changed = true;
  return { events, persons, changed };
}

/** À appeler après chaque mutation de personne ou au chargement d'un document. */
export function syncDefaultLifeEvents(data: FamilyData): FamilyData {
  let state: SyncState = {
    events: data.events,
    persons: data.persons,
    changed: false,
  };
  for (const person of data.persons) {
    state = syncOne(
      data.familyId,
      person,
      'birth',
      person.birthDate,
      'defaultBirthEventId',
      state,
    );
    state = syncOne(
      data.familyId,
      person,
      'death',
      person.deathDate,
      'defaultDeathEventId',
      state,
    );
  }
  if (!state.changed) return data;
  return touch({ ...data, persons: state.persons, events: state.events });
}

export function eventsOfPerson(data: FamilyData, personId: Id): LifeEvent[] {
  return data.events.filter((event) =>
    event.participants.some((participant) => participant.personId === personId),
  );
}

export function findDefaultField(data: FamilyData, eventId: Id):
  | { personId: Id; field: 'defaultBirthEventId' | 'defaultDeathEventId' }
  | undefined {
  for (const person of data.persons) {
    if (person.defaultBirthEventId === eventId) {
      return { personId: person.id, field: 'defaultBirthEventId' };
    }
    if (person.defaultDeathEventId === eventId) {
      return { personId: person.id, field: 'defaultDeathEventId' };
    }
  }
  return undefined;
}

export function addEvent(data: FamilyData, input: LifeEventInput): FamilyData {
  return touch({
    ...data,
    events: [...data.events, createLifeEvent(data.familyId, input)],
  });
}

export function updateEvent(
  data: FamilyData,
  eventId: Id,
  patch: Partial<LifeEventInput>,
): FamilyData {
  const target = data.events.find((event) => event.id === eventId);
  if (!target) return data;

  const events = data.events.map((event) =>
    event.id === eventId
      ? {
          ...event,
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.title !== undefined
            ? { title: patch.title.trim() || undefined }
            : {}),
          ...(patch.date !== undefined
            ? { date: patch.date.trim() || undefined }
            : {}),
          ...(patch.placeId !== undefined ? { placeId: patch.placeId } : {}),
          ...(patch.notes !== undefined
            ? { notes: patch.notes.trim() || undefined }
            : {}),
          ...(patch.participants !== undefined
            ? { participants: patch.participants }
            : {}),
          ...(patch.citations !== undefined ? { citations: patch.citations } : {}),
          ...(patch.mediaIds !== undefined ? { mediaIds: patch.mediaIds } : {}),
          ...(patch.unionId !== undefined ? { unionId: patch.unionId } : {}),
          updatedAt: now(),
        }
      : event,
  );

  // Un événement par défaut répercute sa date sur la fiche, et inversement.
  let persons = data.persons;
  if (patch.date !== undefined) {
    const link = findDefaultField(data, eventId);
    if (link) {
      const field =
        link.field === 'defaultBirthEventId' ? 'birthDate' : 'deathDate';
      const next = patch.date.trim() || undefined;
      persons = persons.map((person) =>
        person.id === link.personId
          ? { ...person, [field]: next, updatedAt: now() }
          : person,
      );
    }
  }
  return touch({ ...data, events, persons });
}

export function deleteEvent(data: FamilyData, eventId: Id): FamilyData {
  const link = findDefaultField(data, eventId);
  const persons = link
    ? data.persons.map((person) =>
        person.id === link.personId
          ? { ...person, [link.field]: undefined, updatedAt: now() }
          : person,
      )
    : data.persons;
  // Supprimer l'événement par défaut ne récrée pas automatiquement la date :
  // c'est un choix explicite de l'utilisateur, on efface donc les deux.
  return touch({ ...data, persons, events: data.events.filter((e) => e.id !== eventId) });
}

export interface DeletionImpact {
  orphanEvents: LifeEvent[];
  defaultEvents: LifeEvent[];
}

export function personDeletionImpact(
  data: FamilyData,
  personId: Id,
): DeletionImpact {
  const linked = eventsOfPerson(data, personId);
  return {
    defaultEvents: linked.filter((event) => findDefaultField(data, event.id)?.personId === personId),
    orphanEvents: linked.filter(
      (event) =>
        !findDefaultField(data, event.id) &&
        event.participants.filter((p) => p.personId !== personId).length === 0,
    ),
  };
}

/** Nettoie toutes les références à une personne supprimée, sans toucher aux autres. */
export function cleanupPersonReferences(
  data: FamilyData,
  personId: Id,
): FamilyData {
  const impact = personDeletionImpact(data, personId);
  const removed = new Set<string>([
    ...impact.defaultEvents.map((event) => event.id),
    ...impact.orphanEvents.map((event) => event.id),
  ]);
  const events = data.events
    .filter((event) => !removed.has(event.id))
    .map((event) =>
      event.participants.some((p) => p.personId === personId)
        ? {
            ...event,
            participants: event.participants.filter((p) => p.personId !== personId),
            updatedAt: now(),
          }
        : event,
    );
  const media = data.media.map((medium) =>
    medium.personIds.includes(personId)
      ? {
          ...medium,
          personIds: medium.personIds.filter((id) => id !== personId),
          updatedAt: now(),
        }
      : medium,
  );
  return { ...data, events, media };
}
