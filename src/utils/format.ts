import { fuzzyDateShort } from '../domain/dates';
import { isDeceased, personLabel, type Gender, type Person } from '../domain/types';

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'Homme',
  female: 'Femme',
  other: 'Autre',
  unspecified: 'Non renseigné',
};

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function initials(person: Person): string {
  const first = person.firstName.trim().charAt(0);
  const last = person.lastName.trim().charAt(0);
  const value = `${first}${last}`.toUpperCase();
  return value || '?';
}

export function formatDates(person: Person): string {
  const birth = fuzzyDateShort(person.birthDate);
  const death = fuzzyDateShort(person.deathDate);
  const deceased = isDeceased(person);
  if (birth && death) return `${birth} – ${death}`;
  if (birth && deceased) return `° ${birth} – †`;
  if (birth) return `° ${birth}`;
  if (death) return `† ${death}`;
  if (deceased) return '† date inconnue';
  return 'Dates non renseignées';
}

export function displayName(person: Person): string {
  return personLabel(person);
}
