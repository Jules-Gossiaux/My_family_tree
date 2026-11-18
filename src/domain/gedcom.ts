import { parseFuzzyDate } from './dates';
import {
  personLabel,
  unionPartnerIds,
  type FamilyData,
  type Id,
  type LinkType,
  type Person,
} from './types';

/** Convertit une date floue en DATE GEDCOM 5.5.1, sans inventer de précision. */
export function gedcomDate(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const { qualifier, day, month, year } = parseFuzzyDate(raw);
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];
  const firstYear = year.match(/\d{4}/)?.[0];
  if (!firstYear) return undefined;
  const numericMonth = /^\d+$/.test(month) ? Number(month) : months.indexOf(month.slice(0, 3).toUpperCase()) + 1;
  const core = day && numericMonth
    ? `${day.padStart(2, '0')} ${months[numericMonth - 1]} ${firstYear}`
    : numericMonth
      ? `${months[numericMonth - 1]} ${firstYear}`
      : firstYear;
  switch (qualifier) {
    case 'vers':
      return `ABT ${core}`;
    case 'avant':
      return `BEF ${core}`;
    case 'après':
      return `AFT ${core}`;
    case 'entre':
      return core;
    default:
      return core;
  }
}

function escapeGedcom(value: string): string {
  // GEDCOM 5.5.1 utilise ASCII ; on translittère les accents pour rester lisible.
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/@/g, '')
    .trim();
}

function nameOf(person: Person): { given: string; surname: string } {
  const given = escapeGedcom(
    [person.firstName, person.additionalGivenNames].filter(Boolean).join(' '),
  );
  const surname = escapeGedcom(person.usageSurname || person.lastName);
  return { given, surname };
}

const GEDCOM_SEX: Record<Person['gender'], string> = {
  male: 'M',
  female: 'F',
  other: 'U',
  unspecified: 'U',
};

const GEDCOM_LINK: Record<LinkType, string> = {
  biological: 'birth',
  adoptive: 'adoption',
  legal: 'foster',
  step: 'step',
  unknown: 'unknown',
};

/**
 * Export GEDCOM 5.5.1. Les liens typés sont conservés comme sous-type de
 * relations FAMC / HUSB / WIFE : l'essentiel est de ne pas perdre la filiation.
 */
export function exportGedcom(data: FamilyData): string {
  const lines: string[] = [
    '0 HEAD',
    '1 SOUR SimpleFamilyTree',
    '2 NAME Arbre genealogique',
    '2 VERS 3.0',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR ANSI',
    '1 LANG French',
    '0 TRLR',
  ];
  const tail: string[] = [];

  const individualId = new Map<Id, string>();
  data.persons.forEach((person, index) => {
    individualId.set(person.id, `I${index + 1}`);
  });
  const unionId = new Map<Id, string>();
  data.unions.forEach((union, index) => {
    unionId.set(union.id, `F${index + 1}`);
  });

  const birthUnionOf = new Map<Id, Id>();
  for (const union of data.unions) {
    for (const child of union.children) {
      if (!birthUnionOf.has(child.childId)) birthUnionOf.set(child.childId, union.id);
    }
  }

  const insertBeforeTrailer = (...entries: string[]) => {
    tail.push(...entries);
  };

  for (const person of data.persons) {
    const id = individualId.get(person.id)!;
    const { given, surname } = nameOf(person);
    insertBeforeTrailer(`0 @${id}@ INDI`);
    insertBeforeTrailer(`1 NAME ${given} /${surname}/`);
    insertBeforeTrailer(`1 SEX ${GEDCOM_SEX[person.gender]}`);
    const birth = gedcomDate(person.birthDate);
    if (birth) insertBeforeTrailer('1 BIRT', `2 DATE ${birth}`);
    const death = gedcomDate(person.deathDate);
    if (death) insertBeforeTrailer('1 DEAT', `2 DATE ${death}`);
    if (person.birthSurname) {
      insertBeforeTrailer(`1 NAME ${escapeGedcom(person.birthSurname)} /${surname}/`, '2 TYPE birth');
    }
    if (person.notes?.trim()) {
      for (const line of person.notes.split(/\r?\n/).filter(Boolean).slice(0, 20)) {
        insertBeforeTrailer(`1 NOTE ${escapeGedcom(line)}`);
      }
    }
    const birthUnion = birthUnionOf.get(person.id);
    const familyRef = birthUnion ? unionId.get(birthUnion) : undefined;
    if (familyRef) insertBeforeTrailer(`1 FAMC @${familyRef}@`);
    for (const union of data.unions) {
      if (unionPartnerIds(union).includes(person.id)) {
        insertBeforeTrailer(`1 FAMS @${unionId.get(union.id)}@`);
      }
    }
  }

  for (const union of data.unions) {
    const id = unionId.get(union.id)!;
    insertBeforeTrailer(`0 @${id}@ FAM`);
    for (const [slot, label] of [
      ['partnerAId', 'HUSB'],
      ['partnerBId', 'WIFE'],
    ] as const) {
      const partnerId = union[slot];
      if (partnerId && individualId.has(partnerId)) {
        insertBeforeTrailer(`1 ${label} @${individualId.get(partnerId)}@`);
      }
    }
    for (const child of union.children) {
      if (!individualId.has(child.childId)) continue;
      insertBeforeTrailer(`1 CHIL @${individualId.get(child.childId)}@`);
      const link = child.linkA !== 'unknown' ? child.linkA : child.linkB;
      if (link !== 'biological' && link !== 'unknown') {
        insertBeforeTrailer(`2 NOTE Relation: ${GEDCOM_LINK[link]}`);
      }
    }
    const marriageDate = gedcomDate(union.startDate);
    if (marriageDate) insertBeforeTrailer('1 MARR', `2 DATE ${marriageDate}`);
    if (union.endDate) {
      const endDate = gedcomDate(union.endDate);
      if (endDate) insertBeforeTrailer('1 DIV', `2 DATE ${endDate}`);
    }
  }

  return [...lines.slice(0, -1), ...tail, lines[lines.length - 1]].join('\r\n') + '\r\n';
}

export function downloadGedcom(data: FamilyData): void {
  const blob = new Blob([exportGedcom(data)], {
    type: 'text/plain;charset=ansi',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `arbre-genealogique-${new Date().toISOString().slice(0, 10)}.ged`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function personDisplayName(person: Person): string {
  return personLabel(person);
}
