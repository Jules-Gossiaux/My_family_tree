import type { GDate, Person } from '../shared/types';

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

function formatPartial(value: string): string {
  const parts = value.split('-');
  if (parts.length === 1) return parts[0];
  const monthIndex = Number(parts[1]) - 1;
  const month = MONTHS[monthIndex] ?? '';
  if (parts.length === 2) return `${month} ${parts[0]}`.trim();
  return `${Number(parts[2])} ${month} ${parts[0]}`.trim();
}

export function formatDate(date: GDate | null | undefined): string {
  if (!date) return '';
  const { min, max, qualifier, text } = date;

  if (qualifier === 'unknown') return text ?? '';
  const single = min && max && min === max ? min : null;

  if (qualifier === 'about' && single) return `vers ${formatPartial(single)}`;
  if (qualifier === 'before' && max) return `avant ${formatPartial(max)}`;
  if (qualifier === 'after' && min) return `après ${formatPartial(min)}`;
  if (min && max && min !== max) return `${formatPartial(min)} – ${formatPartial(max)}`;
  if (single) return formatPartial(single);
  if (min) return `après ${formatPartial(min)}`;
  if (max) return `avant ${formatPartial(max)}`;
  return text ?? '';
}

function yearOf(date: GDate | null): string | null {
  if (!date) return null;
  const value = date.min ?? date.max;
  if (!value) return null;
  const year = value.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

export function lifeSpan(person: Person): string {
  const birth = yearOf(person.birth);
  const death = yearOf(person.death);
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return person.living ? birth : `${birth} – ?`;
  if (death) return `† ${death}`;
  return '';
}

export function fullName(person: Person): string {
  return [person.givenNames, person.familyName].filter(Boolean).join(' ').trim() || 'Sans nom';
}

export function shortName(person: Person): string {
  const first = person.givenNames.split(' ')[0] ?? '';
  const name = `${first} ${person.familyName}`.trim();
  return name || 'Sans nom';
}

export function initials(person: Person): string {
  const given = person.givenNames.trim().charAt(0);
  const family = person.familyName.trim().charAt(0);
  return `${given}${family}`.toUpperCase() || '?';
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
