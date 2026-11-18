import { db, newId } from './db';
import type { SourceInput, SourceRow } from '../shared/types';

/**
 * Les sources que cite un fait : l'acte, le livre, la conversation.
 *
 * Une source ne se date pas et ne se lie pas : elle se cite. Sa référence — une cote, un nom d'acte,
 * une adresse — est ce qui la désigne, parce que deux lignes « acte de naissance » sans cote ne se
 * distinguent pas à l'écran et ne se démêlent pas après coup. Et elle ne s'efface pas pendant qu'on la
 * cite encore : `event.source_id` n'a pas de clé étrangère, donc supprimer une source citée laisserait
 * des faits pointant dans le vide, avec une source affichée absente alors qu'elle a été effacée.
 */
export class SourceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

type Row = Record<string, any>;

/**
 * Les cinq genres que l'écran sait nommer : le genre se stocke sans accent, son libellé s'affiche
 * en français — « témoignage » ne se range pas sous une clé introuvable pour la base.
 */
const KINDS = ['acte', 'photo', 'temoignage', 'web', 'livre'] as const;
const LABELS: Record<string, string> = {
  acte: 'Acte',
  photo: 'Photo',
  temoignage: 'Témoignage',
  web: 'Site web',
  livre: 'Livre',
};

const RELIABILITIES = ['certain', 'probable', 'douteux'] as const;

const SELECT = `
  SELECT s.id, s.kind, s.reference, s.reliability,
         (SELECT COUNT(*) FROM event e WHERE e.source_id = s.id) AS event_count,
         (SELECT COUNT(*) FROM media m WHERE m.source_id = s.id) AS media_count
    FROM source s`;

function mapSource(row: Row): SourceRow {
  return {
    id: row.id as string,
    kind: row.kind as string,
    label: LABELS[row.kind as string] ?? (row.kind as string),
    reference: (row.reference as string) ?? null,
    reliability: row.reliability as string,
    eventCount: Number(row.event_count),
    mediaCount: Number(row.media_count),
  };
}

function sourceById(id: string): SourceRow {
  const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as Row | undefined;
  if (!row) throw new SourceError(404, 'Cette source n’existe pas dans la base.');
  return mapSource(row);
}

export function knownSource(id: string): boolean {
  return Boolean(db.prepare('SELECT id FROM source WHERE id = ?').get(id));
}

function checkedKind(kind: string): string {
  const value = kind.trim().toLowerCase();
  if (!(KINDS as readonly string[]).includes(value)) {
    throw new SourceError(400, `Une source se classe parmi : ${(KINDS as readonly string[]).join(', ')}.`);
  }
  return value;
}

function checkedReliability(reliability: string): string {
  const value = reliability.trim().toLowerCase();
  if (!(RELIABILITIES as readonly string[]).includes(value)) {
    throw new SourceError(400, `La fiabilité se dit : ${(RELIABILITIES as readonly string[]).join(', ')}.`);
  }
  return value;
}

/** La référence est le nom de la source : sans elle, rien ne la distingue de sa voisine. */
function checkedReference(reference: string | null | undefined): string {
  const trimmed = (reference ?? '').trim();
  if (!trimmed) {
    throw new SourceError(400, 'Une source se cite : une cote, un nom d’acte, une adresse, un titre.');
  }
  return trimmed;
}

/** Une même référence ne se déclare pas deux fois : le choix d'un fait deviendrait indiscernable. */
function sameReference(reference: string): { id: string; kind: string } | null {
  const row = db
    .prepare('SELECT id, kind FROM source WHERE reference = ? COLLATE NOCASE')
    .get(reference) as Row | undefined;
  return row ? { id: row.id as string, kind: row.kind as string } : null;
}

export function listSources(): SourceRow[] {
  const rows = db
    .prepare(`${SELECT} ORDER BY s.kind COLLATE NOCASE, s.reference COLLATE NOCASE`)
    .all() as Row[];
  return rows.map(mapSource);
}

export function createSource(input: SourceInput): SourceRow {
  if (!input.kind) throw new SourceError(400, 'Une source se classe : acte, photo, témoignage, web, livre.');
  const kind = checkedKind(input.kind);
  const reference = checkedReference(input.reference);
  const clash = sameReference(reference);
  if (clash) {
    throw new SourceError(409, `Cette référence est déjà celle d’un ${LABELS[clash.kind] ?? clash.kind}.`);
  }
  const reliability = checkedReliability(input.reliability ?? 'probable');

  const id = newId();
  db.prepare('INSERT INTO source (id, kind, reference, reliability) VALUES (?, ?, ?, ?)').run(
    id,
    kind,
    reference,
    reliability,
  );
  return sourceById(id);
}

/** Corriger une référence ne déplace aucune citation : les lignes qui pointent ici suivent le texte. */
export function updateSource(id: string, input: SourceInput): SourceRow {
  const current = db.prepare('SELECT * FROM source WHERE id = ?').get(id) as Row | undefined;
  if (!current) throw new SourceError(404, 'Cette source n’existe pas dans la base.');

  const kind = input.kind === undefined ? (current.kind as string) : checkedKind(input.kind);
  const reference =
    input.reference === undefined
      ? ((current.reference as string) ?? '')
      : checkedReference(input.reference);
  const reliability =
    input.reliability === undefined ? (current.reliability as string) : checkedReliability(input.reliability);

  const clash = sameReference(reference);
  if (clash && clash.id !== id) {
    throw new SourceError(409, `Cette référence est déjà celle d’un ${LABELS[clash.kind] ?? clash.kind}.`);
  }

  db.prepare('UPDATE source SET kind = ?, reference = ?, reliability = ? WHERE id = ?').run(
    kind,
    reference,
    reliability,
    id,
  );
  return sourceById(id);
}

/**
 * Effacer une source se refuse tant qu'on la cite : `event.source_id` et `media.source_id` n'ont pas
 * de clé étrangère, donc l'effacer quand même laisserait des faits pointant une ligne qui n'existe
 * plus — à l'écran, une source absente là où elle avait été choisie. Le refus compte les citations,
 * parce que c'est le nombre de gestes à faire avant.
 */
export function deleteSource(id: string): void {
  if (!knownSource(id)) throw new SourceError(404, 'Cette source n’existe pas dans la base.');

  const cited = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM event WHERE source_id = ?) AS events,
              (SELECT COUNT(*) FROM media WHERE source_id = ?) AS media`,
    )
    .get(id, id) as Row;
  const events = Number(cited.events);
  const media = Number(cited.media);
  if (events || media) {
    const parts = [
      events > 0 ? `${events} fait${events > 1 ? 's' : ''}` : '',
      media > 0 ? `${media} fichier${media > 1 ? 's' : ''}` : '',
    ].filter(Boolean);
    throw new SourceError(
      409,
      `Cette source est encore citée par ${parts.join(' et ')} : retirez la citation avant de l’effacer.`,
    );
  }
  db.prepare('DELETE FROM source WHERE id = ?').run(id);
}
