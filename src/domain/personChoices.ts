import { primaryBirthUnionOf } from './operations';
import {
  personLabel,
  unionPartnerIds,
  type FamilyData,
  type Id,
  type Person,
} from './types';

/**
 * Libellélong d'une personne, utilisé partout où plusieurs personnes peuvent
 * porter le même nom : recherche, sélecteurs, liens de parenté, médias...
 *
 * Ordre des repères : date de naissance, puis parents, puis conjoints, puis
 * enfants. Un identifiant court reste le dernier recours pour les personnes
 * totalement sans contexte, afin que deux options ne soient jamais
 * indistinguables.
 */

function nameCounts(data: FamilyData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const person of data.persons) {
    const key = personLabel(person);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function personById(data: FamilyData, id: Id | null): Person | undefined {
  return id ? data.persons.find((person) => person.id === id) : undefined;
}

function bornLabel(person: Person): string {
  if (!person.birthDate?.trim()) return '';
  const verb = person.gender === 'female' ? 'née' : 'né';
  return `${verb} ${person.birthDate.trim()}`;
}

function contextOf(
  data: FamilyData,
  person: Person,
  counts: Map<string, number>,
  depth: number,
): string {
  const born = bornLabel(person);
  if (born) return born;
  if (depth >= 2) return `sans date · ${person.id.slice(-6)}`;

  const relative = (id: Id | null): string | undefined => {
    const related = personById(data, id);
    if (!related) return undefined;
    const name = personLabel(related);
    if ((counts.get(name) ?? 0) <= 1) return name;
    const detail = contextOf(data, related, counts, depth + 1);
    return detail ? `${name} (${detail})` : `${name} (${related.id.slice(-6)})`;
  };

  const birth = primaryBirthUnionOf(data, person.id);
  const parents = birth
    ? unionPartnerIds(birth)
        .map(relative)
        .filter((value): value is string => Boolean(value))
    : [];
  if (parents.length) return `enfant de ${parents.join(' & ')}`;

  const partners = new Set<Id>();
  const children = new Set<Id>();
  for (const union of data.unions) {
    const members = unionPartnerIds(union);
    if (members.includes(person.id)) {
      for (const id of members) if (id !== person.id) partners.add(id);
      for (const child of union.children) children.add(child.childId);
    }
  }
  if (partners.size) {
    const names = [...partners]
      .map(relative)
      .filter((value): value is string => Boolean(value));
    if (names.length) return `conjoint de ${names.join(', ')}`;
  }
  if (children.size) {
    const names = [...children]
      .map(relative)
      .filter((value): value is string => Boolean(value));
    if (names.length) return `parent de ${names.join(', ')}`;
  }
  return `sans date · ${person.id.slice(-6)}`;
}

/** Repère court, sans le nom : date de naissance puis contexte familial. */
export function personContextLabel(data: FamilyData, person: Person): string {
  return contextOf(data, person, nameCounts(data), 0);
}

/** Exemple : « Jules Gossiaux · enfant de Jules Gossiaux (conjoint de zig) & zig ». */
export function personChoiceLabel(data: FamilyData, person: Person): string {
  const name = personLabel(person);
  if ((nameCounts(data).get(name) ?? 0) <= 1 && !person.birthDate?.trim()) return name;
  const context = personContextLabel(data, person);
  return context ? `${name} · ${context}` : name;
}

/** Applique `personChoiceLabel` à une liste déjà triée. */
export function personChoices(data: FamilyData, persons: Person[]): Array<{ id: Id; label: string }> {
  return persons.map((person) => ({ id: person.id, label: personChoiceLabel(data, person) }));
}
