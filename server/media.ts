import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, MEDIA_DIR } from './config';
import { db, newId, now } from './db';
import { parseGenealogyDate, readDateRow } from './dates';
import { dropNotesFor } from './notes';
import type { GDate, Media, MediaKind } from '../shared/types';

/** Un scan de 600 dpi dépasse vite 20 Mo ; au-delà de 60 Mo, ce n'est plus une photo qui arrive. */
export const MAX_BYTES = 60 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

const FOLDERS: Record<MediaKind, string> = { photo: 'photos', document: 'documents' };

interface Row extends Record<string, any> {}

/** Les quatre colonnes d'une date floue, dans l'ordre des requêtes. */
function dateColumns(date: GDate): (string | null)[] {
  return [date.min, date.max, date.qualifier, date.text];
}

function absolute(relative: string): string {
  return path.join(DATA_DIR, ...relative.split('/'));
}

/** Le dossier de l'année, jamais une année inventée : une date illisible rangée à part reste relisible. */
function yearFolder(taken: string | null | undefined): string {
  const match = /^(\d{4})/.exec((taken ?? '').trim());
  if (match) return match[1];
  return new Date().getFullYear().toString();
}

export class MediaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

/**
 * Ce qu'on accepte, et pourquoi. Un type inconnu refusé à l'entrée coûte un message ; un type
 * inconnu stocké coûte une galerie avec un carré vide et aucune façon de deviner ce qui cloche.
 */
export function rejectUpload(kind: string, mime: string, size: number): string | null {
  if (kind !== 'photo' && kind !== 'document') {
    return 'Un média est une photo ou un document.';
  }
  if (!EXTENSIONS[mime]) {
    return `Ce format n'est pas accepté pour l'instant : ${mime || 'type inconnu'}. Les formats reconnus sont JPEG, PNG, WebP, GIF et PDF.`;
  }
  if (!size) return 'Le fichier est vide.';
  if (size > MAX_BYTES) {
    return `Ce fichier dépasse ${Math.round(MAX_BYTES / 1024 / 1024)} Mo. Découpez le scan avant de l'importer.`;
  }
  return null;
}

export interface StoreInput {
  kind: MediaKind;
  mime: string;
  buffer: Buffer;
  taken?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  documentType?: string | null;
}

export interface StoredMedia {
  media: Media;
  /** L'image était déjà dans le dossier : rien n'a été écrit une seconde fois. */
  deduped: boolean;
}

/**
 * L'original est écrit tel quel, jamais retouché, sous `medias/<kind>/<année>/<id>.<ext>`.
 * L'empreinte sha256 est calculée ici et sert de clé de déduplication : la même photo scannée
 * deux fois ne doit pas remplir le dossier ni peupler la boîte de deux cases identiques.
 */
export function storeMedia(input: StoreInput): StoredMedia {
  const refusal = rejectUpload(input.kind, input.mime, input.buffer.length);
  if (refusal) {
    // Un fichier trop gros est un refus à part : le code le dit avant même de lire le message.
    throw new MediaError(refusal, input.buffer.length > MAX_BYTES ? 413 : 400);
  }

  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const known = db.prepare('SELECT id FROM media WHERE sha256 = ?').get(sha256) as { id: string } | undefined;
  if (known) return { media: getMedia(known.id), deduped: true };

  const id = newId();
  const extension = EXTENSIONS[input.mime];
  const relative = `medias/${FOLDERS[input.kind]}/${yearFolder(input.taken)}/${id}.${extension}`;
  const target = absolute(relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // Écriture à côté puis renommage : une coupure laisse rien d'autre qu'un .part orphelin,
  // jamais une moitié d'image que la base croirait entière.
  const partial = `${target}.part`;
  fs.writeFileSync(partial, input.buffer);
  fs.renameSync(partial, target);

  const timestamp = now();
  const date = parseGenealogyDate(input.taken ?? null);
  db.prepare(
    `INSERT INTO media (id, kind, original_path, sha256, mime, width, height,
                        date_min, date_max, date_qualifier, date_text, caption, document_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.kind,
    relative,
    sha256,
    input.mime,
    input.width ?? null,
    input.height ?? null,
    ...(dateColumns(date ?? emptyDate()) as (string | number | null)[]),
    input.caption?.trim() || null,
    input.documentType?.trim() || null,
    timestamp,
  );

  return { media: getMedia(id), deduped: false };
}

/** La vignette vient du navigateur : le serveur ne décode aucune image, donc n'en casse aucune. */
export function storeThumbnail(mediaId: string, buffer: Buffer): Media {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as Row | undefined;
  if (!row) throw new MediaError('Média introuvable.', 404);
  if (!buffer.length) throw new MediaError('La vignette est vide.', 400);
  if (buffer.length > 2 * 1024 * 1024) {
    throw new MediaError('Cette vignette est trop grosse : elle devrait tenir sous 2 Mo.', 400);
  }

  const relative = `medias/vignettes/${yearFolder(row.date_min ?? row.created_at)}/${mediaId}.jpg`;
  const target = absolute(relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;
  fs.writeFileSync(partial, buffer);
  fs.renameSync(partial, target);

  db.prepare('UPDATE media SET thumb_path = ? WHERE id = ?').run(relative, mediaId);
  return getMedia(mediaId);
}

function emptyDate(): GDate {
  return { min: null, max: null, qualifier: 'unknown', text: null };
}

function mapMedia(row: Row): Media {
  const date = readDateRow(row, 'date');

  const persons = (
    db
      .prepare(
        `SELECT mp.person_id AS id, p.given_names, p.family_name, mp.role
           FROM media_person mp JOIN person p ON p.id = mp.person_id
          WHERE mp.media_id = ?
          ORDER BY p.family_name COLLATE NOCASE, p.given_names COLLATE NOCASE`,
      )
      .all(row.id) as Row[]
  ).map((p) => ({
    id: p.id,
    name: `${p.given_names} ${p.family_name}`.trim(),
    role: p.role as string,
  }));

  return {
    id: row.id,
    kind: row.kind as MediaKind,
    mime: row.mime,
    width: row.width,
    height: row.height,
    caption: row.caption,
    documentType: row.document_type,
    date,
    hasThumb: Boolean(row.thumb_path),
    persons,
    createdAt: row.created_at,
  };
}

export function getMedia(id: string): Media {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new MediaError('Média introuvable.', 404);
  return mapMedia(row);
}

/** Le fichier d'un média, validé contre le dossier de données : une ligne abîmée ne doit rien lire dehors. */
export function mediaFile(id: string, part: 'original' | 'thumb'): { file: string; mime: string | null } {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new MediaError('Média introuvable.', 404);

  const relative = part === 'original' ? row.original_path : row.thumb_path;
  if (!relative) throw new MediaError('Ce média n’a pas de vignette.', 404);

  const target = path.resolve(DATA_DIR, relative);
  const root = path.resolve(DATA_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new MediaError('Le chemin de ce média sort du dossier de données.', 400);
  }
  if (!fs.existsSync(target)) {
    throw new MediaError(
      `Le fichier est inscrit dans la base mais absent du dossier : ${relative}. Une restauration partielle ou un déplacement manuel du disque explique le manque.`,
      404,
    );
  }
  return { file: target, mime: part === 'original' ? row.mime : 'image/jpeg' };
}

export function listMedia(filter: { unattached?: boolean; personId?: string } = {}): Media[] {
  if (filter.personId) {
    // Dans un dossier de vie, une existence se lit du plus ancien au plus récent.
    const rows = db
      .prepare(
        `SELECT m.* FROM media m JOIN media_person mp ON mp.media_id = m.id
          WHERE mp.person_id = ? ORDER BY COALESCE(m.date_min, m.created_at) ASC, m.created_at ASC`,
      )
      .all(filter.personId) as Row[];
    return rows.map(mapMedia);
  }
  if (filter.unattached) {
    const rows = db
      .prepare(
        `SELECT * FROM media WHERE id NOT IN (SELECT media_id FROM media_person)
          ORDER BY created_at DESC`,
      )
      .all() as Row[];
    return rows.map(mapMedia);
  }
  return (db.prepare('SELECT * FROM media ORDER BY created_at DESC').all() as Row[]).map(mapMedia);
}

/** Rattacher, c'est dire « cette personne est sur cette photo ». Rien d'autre n'est déviné. */
export function attachPersons(mediaId: string, personIds: string[], role = 'sujet'): number {
  const media = db.prepare('SELECT id FROM media WHERE id = ?').get(mediaId) as Row | undefined;
  if (!media) throw new MediaError('Média introuvable.', 404);

  const missing = personIds.filter((id) => !db.prepare('SELECT id FROM person WHERE id = ?').get(id));
  if (missing.length) {
    throw new MediaError(
      'L’une des personnes à rattacher n’est plus dans l’arbre. Rechargez la page et recommencez.',
      400,
    );
  }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO media_person (media_id, person_id, role) VALUES (?, ?, ?)',
  );
  const run = db.transaction(() => {
    for (const personId of personIds) insert.run(mediaId, personId, role);
  });
  run();
  return personIds.length;
}

export function detachPerson(mediaId: string, personId: string): void {
  db.prepare('DELETE FROM media_person WHERE media_id = ? AND person_id = ?').run(mediaId, personId);
  // Un portrait qui ne montre plus la personne n'est plus un portrait.
  db.prepare(
    'UPDATE person SET portrait_media_id = NULL WHERE id = ? AND portrait_media_id = ?',
  ).run(personId, mediaId);
}

export function updateMedia(
  id: string,
  patch: { caption?: string | null; kind?: MediaKind; documentType?: string | null; dateText?: string | null },
): Media {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new MediaError('Média introuvable.', 404);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (patch.caption !== undefined) {
    fields.push('caption = ?');
    values.push(patch.caption?.trim() || null);
  }
  if (patch.documentType !== undefined) {
    fields.push('document_type = ?');
    values.push(patch.documentType?.trim() || null);
  }
  if (patch.kind !== undefined) {
    if (patch.kind !== 'photo' && patch.kind !== 'document') {
      throw new MediaError('Un média est une photo ou un document.', 400);
    }
    fields.push('kind = ?');
    values.push(patch.kind);
  }
  if (patch.dateText !== undefined) {
    const date = parseGenealogyDate(patch.dateText);
    const columns = dateColumns(date ?? emptyDate());
    fields.push('date_min = ?', 'date_max = ?', 'date_qualifier = ?', 'date_text = ?');
    values.push(...columns);
  }

  if (fields.length) db.prepare(`UPDATE media SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return getMedia(id);
}

/**
 * Supprimer un média efface ses fichiers. C'est le seul endroit de l'application où la demande
 * détruit autre chose qu'une ligne : elle ne se commande qu'après confirmation à l'écran.
 */
export function deleteMedia(id: string): void {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as Row | undefined;
  if (!row) return;

  db.transaction(() => {
    dropNotesFor('media', id);
    db.prepare('DELETE FROM media WHERE id = ?').run(id);
  })();
  for (const relative of [row.original_path, row.thumb_path]) {
    if (!relative) continue;
    const target = absolute(relative as string);
    const root = path.resolve(MEDIA_DIR);
    const inside = target === root || target.startsWith(root + path.sep);
    if (inside) fs.rmSync(target, { force: true });
  }
}

export function setPortrait(personId: string, mediaId: string | null): void {
  if (mediaId) {
    const attached = db
      .prepare('SELECT 1 FROM media_person WHERE media_id = ? AND person_id = ?')
      .get(mediaId, personId);
    if (!attached) throw new MediaError('Choisissez d’abord la personne sur cette photo.', 400);
  }
  db.prepare('UPDATE person SET portrait_media_id = ? WHERE id = ?').run(mediaId ?? null, personId);
}
