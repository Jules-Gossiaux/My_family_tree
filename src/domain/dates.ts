/**
 * Dates en texte libre, décomposées en QUATRE COLONNES :
 *   qualificatif | jour | mois | année
 *
 * Le texte saisi reste la source de vérité (il accepte « vers 1890 »,
 * « avant 1914 », « 12 mars 1890 », « ~1900 », une date ISO…). Les quatre
 * colonnes sont une lecture structurée de ce texte, jamais une contrainte :
 * on peut aussi les modifier une par une, ce qui recompose le texte.
 *
 * Rien n'est stocké dans un type Date : les dates généalogiques sont souvent
 * incertaines, partielles ou contradictoires, et une conversion en date
 * exacte inventrait une précision qui n'existe pas. Les qualificatifs
 * (« vers », « avant », « après ») sont conservés tels quels.
 */

export interface FuzzyDate {
  raw: string;
  qualifier: string;
  day: string;
  month: string;
  year: string;
}

export const EMPTY_FUZZY_DATE: FuzzyDate = {
  raw: '',
  qualifier: '',
  day: '',
  month: '',
  year: '',
};

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

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTH_NUMBERS: Record<string, number> = Object.fromEntries(
  MONTHS.map((month, index) => [normalize(month), index + 1]),
);

/** Extrait le qualificatif en tête de chaîne, sous toutes ses orthographes. */
function readQualifier(text: string): { qualifier: string; rest: string } {
  const patterns: Array<[RegExp, string]> = [
    [/^vers\b/i, 'vers'],
    [/^(?:environ|env\.?|approx\.?|aprox\.?|ca\.?|circa|~)\s*/i, 'vers'],
    [/^avant\b/i, 'avant'],
    [/^apres\b|^après\b/i, 'après'],
    [/^entre\b/i, 'entre'],
    [/^jusqu(?:'|\u2019)?au\b/i, "jusqu'au"],
    [/^depuis\b/i, 'depuis'],
    [/^apres\s+l'an\b/i, 'après'],
  ];
  for (const [pattern, qualifier] of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        qualifier,
        rest: text.slice(match[0].length).trim(),
      };
    }
  }
  return { qualifier: '', rest: text };
}

/**
 * Analyse une date libre. Les entrées déjà présentes dans l'arbre (ISO
 * `1890-05-04`) sont comprises aussi, ce qui évite de casser les données
 * enregistrées avant ce changement.
 */
export function parseFuzzyDate(raw?: string): FuzzyDate {
  const text = (raw ?? '').trim();
  if (!text) return { ...EMPTY_FUZZY_DATE };

  let qualifier = '';
  let rest = text;
  const parsedQualifier = readQualifier(rest);

  // ISO : 1890-05-04 / 1890/05/04 / 04-05-1890
  const iso = rest.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    return {
      raw: text,
      qualifier: '',
      day: iso[3],
      month: iso[2],
      year: iso[1],
    };
  }
  const frenchNumeric = rest.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (frenchNumeric) {
    return {
      raw: text,
      qualifier: '',
      day: frenchNumeric[1],
      month: frenchNumeric[2],
      year: frenchNumeric[3],
    };
  }

  if (parsedQualifier.qualifier) {
    qualifier = parsedQualifier.qualifier;
    rest = parsedQualifier.rest;
  }

  let day = '';
  let month = '';
  let year = '';

  // Année (ou intervalle « 1890 et 1895 » / « 1890-1895 »).
  const years = rest.match(/\d{4}/g);
  if (years?.length) {
    year = years.length > 1 ? years.join('–') : years[0];
  }

  // Jour isolé : 1 ou 2 chiffres, séparés du reste.
  const dayMatch = rest.match(/\b(\d{1,2})\b(?!\s*\/\s*\d{4})/);
  if (dayMatch && Number(dayMatch[1]) >= 1 && Number(dayMatch[1]) <= 31) {
    const value = Number(dayMatch[1]);
    // Un nombre à 2 chiffres peut être un jour ou un mois ; on le garde
    // comme jour seulement s'il n'est pas déjà utilisé comme mois.
    if (!month || Number(month) !== value) day = String(value);
  }

  // Mois en toutes lettres (français, accentué ou non).
  const flat = normalize(rest);
  const monthIndex = MONTHS.findIndex((name) => {
    const flatName = normalize(name);
    return (
      flat === flatName ||
      flat.startsWith(`${flatName} `) ||
      flat.includes(` ${flatName} `) ||
      flat.endsWith(` ${flatName}`)
    );
  });
  if (monthIndex >= 0) {
    month = MONTHS[monthIndex];
    if (day && year) {
      // « 12 mars 1890 » : le « 12 » trouvé plus haut est bien le jour.
    }
  } else {
    // Mois numérique : « 12/03/1890 » ou « 3 1890 ».
    const monthMatch = rest.match(/\b(\d{1,2})\s*(?:\/|\s)\s*(?:\d{4}|\D|$)/);
    if (monthMatch) {
      const value = Number(monthMatch[1]);
      if (value >= 1 && value <= 12) {
        month = String(value).padStart(2, '0');
        if (day && Number(day) === value) day = '';
      }
    }
  }

  // Si le texte ne contenait qu'un nombre à 4 chiffres, tout est bon.
  // S'il restait un day="3" pour « 3 1890 », on le traite comme mois.
  if (day && !month && year && new RegExp(`^\\s*${day}\\s+${year}`).test(rest)) {
    if (Number(day) <= 12) {
      month = day.padStart(2, '0');
      day = '';
    }
  }

  return { raw: text, qualifier, day, month, year };
}

/** Recompose le texte libre à partir des quatre colonnes. */
export function composeFuzzyDate(parts: {
  qualifier: string;
  day: string;
  month: string;
  year: string;
}): string {
  const qualifier = parts.qualifier.trim();
  const day = parts.day.trim();
  const month = parts.month.trim();
  const year = parts.year.trim();

  if (day && /^\d+$/.test(month) && year) {
    return [qualifier, `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`]
      .filter(Boolean)
      .join(' ');
  }
  return [qualifier, day, month, year].filter(Boolean).join(' ');
}

/**
 * Forme courte pour une carte de l'arbre : on garde le qualificatif et
 * l'année, qui sont ce qui se lit d'un coup d'œil.
 */
export function fuzzyDateShort(raw?: string): string {
  if (!raw?.trim()) return '';
  const { qualifier, year } = parseFuzzyDate(raw);
  if (year) return [qualifier, year].filter(Boolean).join(' ');
  return raw;
}

/**
 * Clé numérique de tri : année, puis mois, puis jour. Les dates partielles
 * passent avant les dates complètes de la même année ; les dates sans année
 * n'ont pas de clé et sont renvoyées en fin de liste.
 */
export function fuzzyDateSortKey(raw?: string): number | undefined {
  const text = raw?.trim();
  if (!text) return undefined;

  const { year, month, day } = parseFuzzyDate(text);
  const yearMatch = year.match(/\d{4}/);
  if (!yearMatch) return undefined;

  const monthNumber = /^\d{1,2}$/.test(month)
    ? Number(month)
    : (MONTH_NUMBERS[normalize(month)] ?? 0);
  const dayNumber = /^\d{1,2}$/.test(day) ? Number(day) : 0;
  return Number(yearMatch[0]) * 10000 + monthNumber * 100 + dayNumber;
}

/** Compare deux dates floues du plus ancien au plus récent. */
export function compareFuzzyDates(a?: string, b?: string): number {
  const keyA = fuzzyDateSortKey(a);
  const keyB = fuzzyDateSortKey(b);
  if (keyA === undefined && keyB === undefined) return 0;
  if (keyA === undefined) return 1;
  if (keyB === undefined) return -1;
  return keyA - keyB;
}

export function normalizeSearch(value: string): string {
  return normalize(value);
}
