import type { GDate, Qualifier } from '../shared/types';

/**
 * Une date généalogique est écrite à la main, en français, souvent à partir d'un acte.
 * La règle qui commande tout ce fichier : ce qui n'est pas sûr devient du texte conservé,
 * jamais une date inventée. « 13/13/1920 » ne doit surtout pas être enregistré comme une
 * date certaine — une fausse date dans une base est pire qu'une case vide.
 */

const MONTHS: Array<[string, number]> = [
  ['janvier', 1],
  ['janv', 1],
  ['jan', 1],
  ['fevrier', 2],
  ['fevr', 2],
  ['fev', 2],
  ['mars', 3],
  ['mar', 3],
  ['avril', 4],
  ['avr', 4],
  ['av', 4],
  ['mai', 5],
  ['juin', 6],
  ['jun', 6],
  ['juillet', 7],
  ['juil', 7],
  ['jui', 7],
  ['aout', 8],
  ['septembre', 9],
  ['sept', 9],
  ['sep', 9],
  ['octobre', 10],
  ['oct', 10],
  ['novembre', 11],
  ['nov', 11],
  ['decembre', 12],
  ['dec', 12],
];

// Le plus long d'abord : « janvier » doit être tenté avant « jan ».
const MONTH_ALTERNATION = [...MONTHS]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([name]) => name)
  .join('|');

const MONTH_VALUES = new Map(MONTHS);

function pad(value: string | number): string {
  return String(value).padStart(2, '0');
}

function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[–—−‒]/g, '-')
    .replace(/\.{2,}/g, '-') // « 1920 .. 1925 » est un intervalle
    .replace(/(\d)\s*\.(?=\s*\d)/g, '$1/')
    .replace(/[.,;:!?"']/g, ' ')
    .replace(/(\d)\s*(?:er|ere|eme|e)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

interface Atom {
  min: string;
  max: string;
}

/** Une date complète, au jour, au mois ou à l'année — mais jamais fausse. */
function makeAtom(year: string, month?: string, day?: string): Atom | null {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1 || y > 9999) return null;
  if (month === undefined) return { min: year, max: year };

  const m = Number(month);
  if (m < 1 || m > 12) return null;
  if (day === undefined) return { min: `${year}-${pad(m)}`, max: `${year}-${pad(m)}` };

  const d = Number(day);
  if (d < 1 || d > daysInMonth(y, m)) return null;
  const full = `${year}-${pad(m)}-${pad(d)}`;
  return { min: full, max: full };
}

function parseAtom(input: string): Atom | null {
  const s = input.trim();
  if (!s) return null;

  // L'année devant : 1920 · 1920-03 · 1920-03-14 · 1920/03/14.
  const yearFirst = s.match(/^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?$/);
  if (yearFirst) return makeAtom(yearFirst[1], yearFirst[2], yearFirst[3]);

  // Le jour devant, comme en France : 14/03/1920 (les points ont été unifiés plus haut).
  const dayFirst = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dayFirst) return makeAtom(dayFirst[3], dayFirst[2], dayFirst[1]);

  // Le mois et l'année seuls : 3/1920.
  const monthFirst = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (monthFirst) return makeAtom(monthFirst[2], monthFirst[1]);

  // « 14 mars 1920 » · « mars 1920 » — la formulation des actes d'état civil.
  const textual = new RegExp(`^(?:(\\d{1,2})\\s+)?(${MONTH_ALTERNATION})\\s+(\\d{4})$`);
  const t = s.match(textual);
  if (t) {
    const month = MONTH_VALUES.get(t[2]);
    if (month) return makeAtom(t[3], String(month), t[1]);
  }

  return null;
}

/** Deux dates séparées par un tiret, « .. », « et », « à », « au ». */
function parseRange(input: string): Atom | null {
  const parts = input
    .trim()
    .split(/\s*(?:\.\.|-{1,2}|->|\bet\b|\ba\b|\bau\b|\bto\b|jusqu a|jusque)\s*/)
    .filter(Boolean);
  if (parts.length !== 2) return null;

  const a = parseAtom(parts[0]);
  const b = parseAtom(parts[1]);
  if (!a || !b) return null;
  return {
    min: a.min <= b.min ? a.min : b.min,
    max: a.max >= b.max ? a.max : b.max,
  };
}

interface QualifierRule {
  pattern: RegExp;
  qualifier: Qualifier;
  /** Quelle borne la base doit-elle garder : celle de devant, celle de derrière, ou les deux. */
  side: 'min' | 'max' | 'both' | 'range';
}

const QUALIFIER_RULES: QualifierRule[] = [
  { pattern: /^(?:avant|av)\s+(.+)$/, qualifier: 'before', side: 'max' },
  { pattern: /^(?:apres|post)\s+(.+)$/, qualifier: 'after', side: 'min' },
  { pattern: /^(?:vers|environ|circa)\s+(.+)$/, qualifier: 'about', side: 'both' },
  { pattern: /^[~≈]\s*(.+)$/, qualifier: 'about', side: 'both' },
  { pattern: /^entre\s+(.+)$/, qualifier: 'between', side: 'range' },
];

function make(min: string | null, max: string | null, qualifier: Qualifier, text: string): GDate {
  return { min, max, qualifier, text };
}

/**
 * Analyse une date écrite librement : 1920 · 14/03/1920 · 1920-03-14 · 14 mars 1920 ·
 * vers 1920 · avant le 14/03/1920 · entre 1920 et 1925 · 1920-1925.
 *
 * Ne rejette jamais : ce qui n'est pas compris ressort en « unknown » avec le texte
 * d'origine intact. Une date incomprise ne doit jamais faire perdre l'information.
 */
export function parseGenealogyDate(input: string | null | undefined): GDate | null {
  if (input === null || input === undefined) return null;
  const text = input.trim();
  if (!text) return null;

  const s = normalize(text);

  for (const rule of QUALIFIER_RULES) {
    const found = s.match(rule.pattern);
    if (!found) continue;
    // « avant le 14/03/1920 » : l'article ne porte aucune information de date.
    const tail = found[1].replace(/^(?:le|la|l an)\s+/, '');
    const atom = rule.side === 'range' ? parseRange(tail) : parseAtom(tail) ?? parseRange(tail);
    if (!atom) continue;
    if (rule.side === 'max') return make(null, atom.max, rule.qualifier, text);
    if (rule.side === 'min') return make(atom.min, null, rule.qualifier, text);
    return make(atom.min, atom.max, rule.qualifier, text);
  }

  const single = parseAtom(s);
  if (single) return make(single.min, single.max, 'exact', text);

  const range = parseRange(s);
  if (range) return make(range.min, range.max, 'between', text);

  return make(null, null, 'unknown', text);
}
