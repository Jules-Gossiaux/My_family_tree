import { db, newId } from './db';
import type { PlaceRow } from '../shared/types';

/**
 * Les lieux de la base : une ligne par nom, pas par orthographe.
 *
 * Un lieu ne se saisit jamais à part — on l'écrit sur le fait qui l'a vu. C'est le nom seul qui le
 * désigne, et « Roubaix » écrit trois fois ne doit pas faire trois lignes : la même enseigne serait
 * trois lieux dans une liste et trois moitiés d'arbre géographique.
 */
export class PlaceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlaceError';
  }
}

type Row = Record<string, any>;

const SELECT = `
  SELECT p.id, p.name,
         (SELECT COUNT(*) FROM event e WHERE e.place_id = p.id) AS event_count,
         (SELECT COUNT(*) FROM media m WHERE m.place_id = p.id) AS media_count
    FROM place p`;

function mapPlace(row: Row): PlaceRow {
  return {
    id: row.id,
    name: row.name,
    eventCount: Number(row.event_count),
    mediaCount: Number(row.media_count),
  };
}

function placeById(id: string): PlaceRow {
  const row = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Row | undefined;
  if (!row) throw new PlaceError(404, 'Ce lieu n’existe pas dans la base.');
  return mapPlace(row);
}

/** Un lieu se nomme, et le nom se défait de ses espaces de trop avant de chercher un jumeau. */
export function checkedName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new PlaceError(400, 'Un lieu se nomme : une ville, un hameau, un pays.');
  return trimmed;
}

function sameName(name: string): { id: string; name: string } | null {
  const row = db.prepare('SELECT id, name FROM place WHERE name = ? COLLATE NOCASE').get(name) as
    | Row
    | undefined;
  return row ? { id: row.id, name: row.name } : null;
}

export function listPlaces(): PlaceRow[] {
  const rows = db.prepare(`${SELECT} ORDER BY p.name COLLATE NOCASE`).all() as Row[];
  return rows.map(mapPlace);
}

/** Trouvé ou créé : c'est le seul chemin par lequel un lieu entre dans la base. */
export function findOrCreatePlace(name: string): { place: PlaceRow; created: boolean } {
  const clean = checkedName(name);
  const found = sameName(clean);
  if (found) return { place: placeById(found.id), created: false };
  const id = newId();
  db.prepare('INSERT INTO place (id, name) VALUES (?, ?)').run(id, clean);
  return { place: placeById(id), created: true };
}

/** Renommer ne déplace aucun fait : les lignes qui pointaient ici suivent le nouveau nom. */
export function renamePlace(id: string, name: string): PlaceRow {
  const current = db.prepare('SELECT id FROM place WHERE id = ?').get(id) as Row | undefined;
  if (!current) throw new PlaceError(404, 'Ce lieu n’existe pas dans la base.');

  const clean = checkedName(name);
  const clash = sameName(clean);
  if (clash && clash.id !== id) {
    throw new PlaceError(409, `Un lieu porte déjà ce nom : ${clash.name}.`);
  }
  db.prepare('UPDATE place SET name = ? WHERE id = ?').run(clean, id);
  return placeById(id);
}

/**
 * Effacer un lieu ne touche ni les faits ni les fichiers : leurs colonnes `place_id` sont en
 * `ON DELETE SET NULL`. Le compte rendu dit ce qui reste, parce que c'est ce que l'on veut savoir
 * avant de supprimer — un lieu mal orthographié se corrige, il ne s'efface pas.
 */
export function deletePlace(id: string): { events: number; media: number } {
  const current = db.prepare('SELECT id FROM place WHERE id = ?').get(id) as Row | undefined;
  if (!current) throw new PlaceError(404, 'Ce lieu n’existe pas dans la base.');

  const usage = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM event WHERE place_id = ?) AS events,
              (SELECT COUNT(*) FROM media WHERE place_id = ?) AS media`,
    )
    .get(id, id) as Row;
  db.prepare('DELETE FROM place WHERE id = ?').run(id);
  return { events: Number(usage.events), media: Number(usage.media) };
}
