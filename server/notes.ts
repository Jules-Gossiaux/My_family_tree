import { db, newId, now } from './db';
import type { NoteInput, NoteRow } from '../shared/types';

/**
 * Les notes de la base : ce que l'on sait, ce que l'on suppose, ce qu'un cousin a raconté.
 *
 * Une note n'est pas un fait — ni date certaine, ni type — et ce n'est pas une source, qui se cite et
 * se prouve. Elle porte le commentaire que l'on accroche à quelqu'un, et il n'y a pas de frontière
 * entre la note d'une vie et celle d'un acte : c'est la même marge, posée sur une ligne de la base.
 * D'où `target_type` et `target_id` plutôt qu'une colonne par objet.
 */
export class NoteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NoteError';
  }
}

type Row = Record<string, any>;

/**
 * Cinq choses savent porter une note, et le nom de leur table est fixé ici : `note` n'a pas de clé
 * étrangère — un `target_id` ne peut pas désigner une table à la fois — donc la base ne refuse seule
 * une cible inventée.
 */
const TARGETS: Record<string, string> = {
  person: 'person',
  couple: 'couple',
  event: 'event',
  media: 'media',
  place: 'place',
};

const LABELS: Record<string, string> = {
  person: 'cette personne',
  couple: 'cette union',
  event: 'ce fait',
  media: 'ce fichier',
  place: 'ce lieu',
};

function mapNote(row: Row): NoteRow {
  return {
    id: row.id as string,
    body: row.body as string,
    targetType: row.target_type as string,
    targetId: row.target_id as string,
    createdAt: row.created_at as string,
  };
}

function noteById(id: string): NoteRow {
  const row = db.prepare('SELECT * FROM note WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new NoteError(404, 'Cette note n’existe pas dans la base.');
  return mapNote(row);
}

/** La cible se nomme par son type et son identifiant : l'un manquant, la note ne s'afficherait nulle part. */
function checkedTarget(input: NoteInput): { type: string; targetId: string } {
  const type = (input.targetType ?? '').trim().toLowerCase();
  const table = TARGETS[type];
  if (!table) {
    throw new NoteError(400, `Une note se pose sur : ${Object.keys(TARGETS).join(', ')}.`);
  }
  const targetId = (input.targetId ?? '').trim();
  if (!targetId || !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(targetId)) {
    throw new NoteError(404, `On ne note pas ${LABELS[type]} : la ligne n’existe pas dans la base.`);
  }
  return { type, targetId };
}

/** Le corps fait une note : vide, elle ne dirait rien et encombrerait la fiche. */
function checkedBody(body: string | null | undefined): string {
  const trimmed = (body ?? '').trim();
  if (!trimmed) {
    throw new NoteError(400, 'Une note s’écrit : ce que l’on sait, ce que l’on suppose, ce qu’un cousin raconte.');
  }
  return trimmed;
}

/** Dans l'ordre où elles ont été écrites : une note se relit comme la suite d'une marge. */
export function notesOf(targetType: string, targetId: string): NoteRow[] {
  const rows = db
    .prepare('SELECT * FROM note WHERE target_type = ? AND target_id = ? ORDER BY created_at, id')
    .all(targetType, targetId) as Row[];
  return rows.map(mapNote);
}

export function createNote(input: NoteInput): NoteRow {
  const { type, targetId } = checkedTarget(input);
  const body = checkedBody(input.body);

  const id = newId();
  db.prepare('INSERT INTO note (id, body, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    body,
    type,
    targetId,
    now(),
  );
  return noteById(id);
}

/**
 * Corriger une note garde sa date d'écriture : `note` n'a pas de colonne pour la seconde, et une
 * migration pour un horodatage ne vaut pas un changement de schéma. L'écran dit donc « écrite le »,
 * pas « dernière correction le ».
 */
export function updateNote(id: string, body: string): NoteRow {
  const clean = checkedBody(body);
  noteById(id);
  db.prepare('UPDATE note SET body = ? WHERE id = ?').run(clean, id);
  return noteById(id);
}

export function deleteNote(id: string): void {
  noteById(id);
  db.prepare('DELETE FROM note WHERE id = ?').run(id);
}

/**
 * Ce que l'on efface emporte ses notes : personne supprimée, commentaire orphelin. Rien ne peut les
 * suivre tout seul, parce que `target_id` désigne cinq tables selon la ligne et ne peut porter de clé
 * étrangère. La suppression d'une personne appelle donc ceci, dans sa propre transaction.
 */
export function dropNotesFor(targetType: string, targetId: string): void {
  const type = (targetType ?? '').trim().toLowerCase();
  if (!TARGETS[type]) return;
  db.prepare('DELETE FROM note WHERE target_type = ? AND target_id = ?').run(type, targetId);
}
