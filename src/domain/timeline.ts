import { compareFuzzyDates, parseFuzzyDate } from './dates';
import { eventLabelFor, personLabel, type FamilyData, type Id, type LifeEvent } from './types';

export interface TimelineEntry {
  key: string;
  year?: number;
  yearLabel: string;
  title: string;
  detail: string;
  type: LifeEvent['type'] | 'union';
  eventId?: Id;
}

/** Année de tri : premier millésime d'une date floue ou d'un intervalle. */
export function timelineYear(date?: string): number | undefined {
  if (!date?.trim()) return undefined;
  const { year } = parseFuzzyDate(date);
  const match = year.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

/**
 * Frise d'une personne : faits de vie + unions où elle figure. Les éléments
 * sans année sont regroupés en fin, sans inventer de date.
 */
export function buildTimeline(data: FamilyData, personId: Id): TimelineEntry[] {
  const person = data.persons.find((candidate) => candidate.id === personId);
  if (!person) return [];

  const entries: TimelineEntry[] = [];
  for (const event of data.events) {
    if (!event.participants.some((participant) => participant.personId === personId)) {
      continue;
    }
    const others = event.participants
      .filter((participant) => participant.personId !== personId)
      .map((participant) =>
        data.persons.find((candidate) => candidate.id === participant.personId),
      )
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .map(personLabel);
    const place = data.places.find((candidate) => candidate.id === event.placeId);
    entries.push({
      key: `event:${event.id}`,
      year: timelineYear(event.date),
      yearLabel: event.date?.trim() || '',
      title: event.title || eventLabelFor(event.type),
      detail: [others.join(', '), place?.name].filter(Boolean).join(' · '),
      type: event.type,
      eventId: event.id,
    });
  }

  for (const union of data.unions) {
    if (
      union.partnerAId !== personId &&
      union.partnerBId !== personId &&
      !union.children.some((child) => child.childId === personId)
    ) {
      continue;
    }
    const partnerId = union.partnerAId === personId ? union.partnerBId : union.partnerAId;
    const partner = partnerId ? data.persons.find((candidate) => candidate.id === partnerId) : undefined;
    const children = union.children
      .map((child) => data.persons.find((candidate) => candidate.id === child.childId))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .map(personLabel);
    const date = union.startDate || union.endDate;
    entries.push({
      key: `union:${union.id}`,
      year: timelineYear(date),
      yearLabel: date?.trim() || '',
      title: partner ? `Union avec ${personLabel(partner)}` : 'Union',
      detail: children.length ? `Enfants : ${children.join(', ')}` : '',
      type: 'union',
    });
  }

  return entries.sort((a, b) => compareFuzzyDates(a.yearLabel, b.yearLabel));
}
