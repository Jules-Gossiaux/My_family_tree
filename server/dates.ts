import type { GDate } from '../shared/types';

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function pad(value: string): string {
  return value.padStart(2, '0');
}

function make(
  min: string | null,
  max: string | null,
  qualifier: GDate['qualifier'],
  text: string,
): GDate {
  return { min, max, qualifier, text };
}

/**
 * Analyse une date écrite librement.
 *
 * Accepte : 1920 · 03/1920 · 14/03/1920 · 1920-03-14 · vers 1920 · avant 1920
 *           après 1920 · entre 1920 et 1925 · 1920-1925 · 1920..1925
 *
 * Ne rejette jamais : ce qui n'est pas reconnu devient une date « inconnue » qui conserve
 * le texte d'origine. Une date incomprise ne doit jamais faire perdre l'information.
 */
export function parseGenealogyDate(input: string | null | undefined): GDate | null {
  if (input === null || input === undefined) return null;
  const text = input.trim();
  if (!text) return null;

  const s = stripAccents(text).toLowerCase().replace(/\s+/g, ' ').trim();

  const between = s.match(/^(?:entre|de)\s+(\d{4})\s+(?:et|a|-|\.\.)\s+(\d{4})$/);
  if (between) {
    const a = between[1];
    const b = between[2];
    return make(a <= b ? a : b, a <= b ? b : a, 'between', text);
  }

  const range = s.match(/^(\d{4})\s*(?:-|\.\.|a)\s*(\d{4})$/);
  if (range) {
    const a = range[1];
    const b = range[2];
    return make(a <= b ? a : b, a <= b ? b : a, 'between', text);
  }

  const before = s.match(/^(?:avant|before|<)\s*(\d{4})$/);
  if (before) return make(null, before[1], 'before', text);

  const after = s.match(/^(?:apres|after|>)\s*(\d{4})$/);
  if (after) return make(after[1], null, 'after', text);

  const about = s.match(/^(?:vers|ca|c\.|circa|environ|~|≈)\s*(\d{4})$/);
  if (about) return make(about[1], about[1], 'about', text);

  const full = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (full) {
    const iso = `${full[3]}-${pad(full[2])}-${pad(full[1])}`;
    return make(iso, iso, 'exact', text);
  }

  const isoFull = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoFull) {
    const iso = `${isoFull[1]}-${pad(isoFull[2])}-${pad(isoFull[3])}`;
    return make(iso, iso, 'exact', text);
  }

  const monthYear = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (monthYear) {
    const iso = `${monthYear[2]}-${pad(monthYear[1])}`;
    return make(iso, iso, 'exact', text);
  }

  const isoMonth = s.match(/^(\d{4})-(\d{1,2})$/);
  if (isoMonth) {
    const iso = `${isoMonth[1]}-${pad(isoMonth[2])}`;
    return make(iso, iso, 'exact', text);
  }

  const year = s.match(/^(\d{4})$/);
  if (year) return make(year[1], year[1], 'exact', text);

  return make(null, null, 'unknown', text);
}
