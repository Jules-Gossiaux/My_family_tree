import { db, newId, now } from './db';
import { parseGenealogyDate, readDateRow } from './dates';
import { findOrCreatePlace } from './places';
import type { EventInput, EventRow, GDate } from '../shared/types';

/**
 * Les événements de la vie d'une personne — et ceux d'une union.
 *
 * Une date généalogique ne se devine pas : le texte tapé est analysé, et ce que l'analyseur ne
 * comprend pas est gardé comme texte en « unknown » plutôt qu'inventé en date — la chronologie le
 * range alors à la fin de la vie. La confiance et la source s'attachent au fait, jamais à la
 * personne : un même individu a un acte de naissance certain et une profession rapportée par un neveu.
 * Le lieu, lui, s'écrit par son nom : « Roubaix » posé deux fois ne fait qu'une ligne, et un nom
 * jamais vu en ouvre une nouvelle (`places.ts`) — demander à l'utilisateur de choisir d'abord son
 * lieu dans une liste vide, c'est lui faire faire le travail de la base.
 */
export class LifeEventError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LifeEventError';
  }
}

/** Les sept types que la fiche sait nommer, tels que la spec §7.2 les écrit. */
const TYPES = ['naissance', 'bapteme', 'deces', 'inhumation', 'profession', 'residence', 'autre'] as const;
const LABELS: Record<string, string> = {
  naissance: 'Naissance',
  bapteme: 'Baptême',
  deces: 'Décès',
  inhumation: 'Inhumation',
  profession: 'Profession',
  residence: 'Résidence',
  autre: 'Autre',
};

const CONFIDENCES = ['certain', 'probable', 'douteux'] as const;

/** Une naissance et un décès ne se déclarent qu'une fois par personne. */
const UNIQUE_PER_PERSON = new Set<string>(['naissance', 'deces']);

type Row = Record<string, any>;

function knownPerson(id: string): boolean {
  return Boolean(db.prepare('SELECT id FROM person WHERE id = ?').get(id));
}

function knownCouple(id: string): boolean {
  return Boolean(db.prepare('SELECT id FROM couple WHERE id = ?').get(id));
}

function knownPlace(id: string): boolean {
  return Boolean(db.prepare('SELECT id FROM place WHERE id = ?').get(id));
}

function knownSource(id: string): boolean {
  return Boolean(db.prepare('SELECT id FROM source WHERE id = ?').get(id));
}

function checkedType(type: string): string {
  const value = type.trim().toLowerCase();
  if (!(TYPES as readonly string[]).includes(value)) {
    throw new LifeEventError(400, `Un événement se nomme parmi : ${TYPES.join(', ')}.`);
  }
  return value;
}

function checkedConfidence(confidence: string): string {
  const value = confidence.trim().toLowerCase();
  if (!(CONFIDENCES as readonly string[]).includes(value)) {
    throw new LifeEventError(400, `La confiance se dit : ${CONFIDENCES.join(', ')}.`);
  }
  return value;
}

/**
 * Le texte est gardé tel quel, la date analysée à côté : « vers 1912 » ne devient jamais « 1912 ».
 * Une date que l'analyseur ne comprend pas ressort en « unknown » avec son texte intact — le
 * refuser ferait perdre une information, et le range à la fin de la vie plutôt que de l'inventer.
 */
function checkedDate(text: string | null | undefined): GDate | null {
  const trimmed = (text ?? '').trim();
  return trimmed ? parseGenealogyDate(trimmed) : null;
}

/**
 * Un événement porte une personne ou une union, jamais les deux ni aucune : sans sujet, il
 * n'apparaît sur aucun écran et devient une ligne perdue dans la base.
 */
function checkedOwner(input: EventInput, current?: Row): { personId: string | null; coupleId: string | null } {
  const personId = input.personId === undefined ? (current?.person_id ?? null) : input.personId || null;
  const coupleId = input.coupleId === undefined ? (current?.couple_id ?? null) : input.coupleId || null;

  if (!personId && !coupleId) {
    throw new LifeEventError(400, 'Un événement se rattache à une personne ou à une union : dites lequel.');
  }
  if (personId && coupleId) {
    throw new LifeEventError(400, 'Un événement porte une personne ou une union, pas les deux à la fois.');
  }
  if (personId && !knownPerson(personId)) {
    throw new LifeEventError(404, 'Cette personne n’existe pas dans la base.');
  }
  if (coupleId && !knownCouple(coupleId)) {
    throw new LifeEventError(404, 'Cette union n’existe pas dans la base.');
  }
  return { personId, coupleId };
}

/**
 * Le lieu tel qu'un écrit l'a dit : soit une ligne que la base connaît déjà, soit le nom que l'on
 * tape — et alors la base le trouve ou le crée. Les deux à la fois serait deux réponses pour une place.
 */
type PlaceChoice = { placeId: string | null; createFrom: string | null };

function checkedPlace(input: EventInput, current?: Row): PlaceChoice {
  const hasId = input.placeId !== undefined;
  const hasName = input.placeName !== undefined;
  if (hasId && hasName) {
    throw new LifeEventError(400, 'Un lieu se dit par son nom ou par son identifiant, pas les deux.');
  }
  if (hasName) {
    const name = (input.placeName ?? '').trim();
    return { placeId: null, createFrom: name || null };
  }
  const placeId = hasId ? (input.placeId || null) : (current?.place_id ?? null);
  if (placeId && !knownPlace(placeId)) throw new LifeEventError(404, 'Ce lieu n’existe pas dans la base.');
  return { placeId, createFrom: null };
}

/**
 * Le nom ne devient une ligne qu'une fois tout le reste validé : un refus pour une seconde naissance
 * ne doit pas laisser un lieu orphelin dans la liste.
 */
function resolvePlace(place: PlaceChoice): string | null {
  return place.createFrom ? findOrCreatePlace(place.createFrom).place.id : place.placeId;
}

function checkedSource(input: EventInput, current?: Row): string | null {
  const sourceId = input.sourceId === undefined ? (current?.source_id ?? null) : input.sourceId || null;
  if (sourceId && !knownSource(sourceId)) throw new LifeEventError(404, 'Cette source n’existe pas dans la base.');
  return sourceId;
}

/** Une date dite « à la place d'une autre » ne laisse pas deux naissances derrière elle. */
function uniqueGuard(personId: string | null, type: string, exceptId?: string): void {
  if (!personId || !UNIQUE_PER_PERSON.has(type)) return;
  const clash = db
    .prepare('SELECT id FROM event WHERE person_id = ? AND type = ? AND id IS NOT ?')
    .get(personId, type, exceptId) as Row | undefined;
  if (clash) {
    throw new LifeEventError(
      409,
      `Cette personne a déjà un événement « ${LABELS[type]} » : modifiez-le au lieu d’en écrire un second.`,
    );
  }
}

function mapEvent(row: Row): EventRow {
  return {
    id: row.id,
    personId: row.person_id ?? null,
    coupleId: row.couple_id ?? null,
    type: row.type,
    label: LABELS[row.type] ?? LABELS.autre,
    date: readDateRow(row, 'date'),
    place: row.place_name ?? null,
    placeId: row.place_id ?? null,
    description: row.description ?? null,
    confidence: row.confidence,
    sourceId: row.source_id ?? null,
    source: row.source_reference ?? null,
    sourceKind: row.source_kind ?? null,
    mediaCount: Number(row.media_count ?? 0),
  };
}

const SELECT = `
  SELECT e.*, p.name AS place_name, s.reference AS source_reference, s.kind AS source_kind,
         (SELECT COUNT(*) FROM media_event me WHERE me.event_id = e.id) AS media_count
    FROM event e
    LEFT JOIN place p ON p.id = e.place_id
    LEFT JOIN source s ON s.id = e.source_id`;

/** Dans l'ordre où la vie s'est déroulée : une date inconnue se range à la fin. */
export function eventsOfPerson(personId: string): EventRow[] {
  const rows = db
    .prepare(
      `${SELECT}
        WHERE e.person_id = ?
        ORDER BY COALESCE(e.date_min, e.date_max, '9999'), e.created_at`,
    )
    .all(personId) as Row[];
  return rows.map(mapEvent);
}

export function eventsOfCouple(coupleId: string): EventRow[] {
  const rows = db
    .prepare(
      `${SELECT}
        WHERE e.couple_id = ?
        ORDER BY COALESCE(e.date_min, e.date_max, '9999'), e.created_at`,
    )
    .all(coupleId) as Row[];
  return rows.map(mapEvent);
}

export function getEvent(id: string): EventRow {
  const row = db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as Row | undefined;
  if (!row) throw new LifeEventError(404, 'Cet événement n’existe pas dans la base.');
  return mapEvent(row);
}

export function createEvent(input: EventInput): EventRow {
  if (!input.type) throw new LifeEventError(400, 'Un événement se nomme : naissance, baptême, décès…');
  const type = checkedType(input.type);
  const owner = checkedOwner(input);
  uniqueGuard(owner.personId, type);
  const date = checkedDate(input.dateText);
  const place = checkedPlace(input);
  const sourceId = checkedSource(input);
  const confidence = checkedConfidence(input.confidence ?? 'probable');
  const description = (input.description ?? '').trim() || null;

  const id = newId();
  // Le lieu se crée dans la même écriture que le fait : un échec ici ne laisse aucune ligne orpheline.
  db.transaction(() => {
    db.prepare(
      `INSERT INTO event (id, person_id, couple_id, type, date_min, date_max, date_qualifier, date_text,
                          place_id, description, source_id, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      owner.personId,
      owner.coupleId,
      type,
      date?.min ?? null,
      date?.max ?? null,
      date?.qualifier ?? 'unknown',
      date?.text ?? null,
      resolvePlace(place),
      description,
      sourceId,
      confidence,
      now(),
    );
  })();
  return getEvent(id);
}

export function updateEvent(id: string, input: EventInput): EventRow {
  const current = db.prepare('SELECT * FROM event WHERE id = ?').get(id) as Row | undefined;
  if (!current) throw new LifeEventError(404, 'Cet événement n’existe pas dans la base.');

  const type = input.type === undefined ? current.type : checkedType(input.type);
  const owner = checkedOwner(input, current);
  uniqueGuard(owner.personId, type, id);
  const dateTouched = input.dateText !== undefined;
  const date = dateTouched ? checkedDate(input.dateText) : null;
  const place = checkedPlace(input, current);
  const sourceId = checkedSource(input, current);
  const confidence = input.confidence === undefined ? current.confidence : checkedConfidence(input.confidence);
  const description =
    input.description === undefined ? current.description : (input.description ?? '').trim() || null;

  db.transaction(() => {
    db.prepare(
      `UPDATE event
          SET person_id = ?, couple_id = ?, type = ?, date_min = ?, date_max = ?, date_qualifier = ?,
              date_text = ?, place_id = ?, description = ?, source_id = ?, confidence = ?
        WHERE id = ?`,
    ).run(
      owner.personId,
      owner.coupleId,
      type,
      dateTouched ? (date?.min ?? null) : current.date_min,
      dateTouched ? (date?.max ?? null) : current.date_max,
      dateTouched ? (date?.qualifier ?? 'unknown') : current.date_qualifier,
      dateTouched ? (date?.text ?? null) : current.date_text,
      resolvePlace(place),
      description,
      sourceId,
      confidence,
      id,
    );
  })();
  return getEvent(id);
}

export function deleteEvent(id: string): void {
  const current = db.prepare('SELECT id FROM event WHERE id = ?').get(id) as Row | undefined;
  if (!current) throw new LifeEventError(404, 'Cet événement n’existe pas dans la base.');
  db.prepare('DELETE FROM event WHERE id = ?').run(id);
}

/**
 * La date de naissance ou de décès tapée sur la fiche est l'événement du même nom : un seul endroit
 * les écrit, sinon la saisie rapide et l'éditeur de vie produiraient deux lignes pour un fait.
 * Un texte vide rend l'événement — la date redevient inconnue, rien d'autre ne bouge.
 */
export function setPersonDateEvent(
  personId: string,
  type: 'naissance' | 'deces',
  text?: string | null,
): void {
  const existing = db
    .prepare('SELECT id FROM event WHERE person_id = ? AND type = ?')
    .get(personId, type) as Row | undefined;

  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    if (existing) db.prepare('DELETE FROM event WHERE id = ?').run(existing.id);
    return;
  }

  const date = parseGenealogyDate(trimmed);
  if (existing) {
    db.prepare(
      'UPDATE event SET date_min = ?, date_max = ?, date_qualifier = ?, date_text = ? WHERE id = ?',
    ).run(
      date?.min ?? null,
      date?.max ?? null,
      date?.qualifier ?? 'unknown',
      date?.text ?? trimmed,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO event (id, person_id, type, date_min, date_max, date_qualifier, date_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(),
      personId,
      type,
      date?.min ?? null,
      date?.max ?? null,
      date?.qualifier ?? 'unknown',
      date?.text ?? trimmed,
      now(),
    );
  }
}
