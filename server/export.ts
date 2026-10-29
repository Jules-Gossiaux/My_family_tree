import { db } from './db';
import { readDateRow } from './dates';

type Row = Record<string, any>;

/**
 * Export JSON lisible sans l'application (SPEC §6.3, niveau 3) : si un jour SQLite ou ce code
 * vient à manquer, le fichier reste ouvert avec un éditeur de texte et se relit avec n'importe
 * quel langage.
 *
 * Il épouse les tables de la base, sans inventer de vue : les personnes, les unions, les liens
 * de parenté, les actes, les lieux, les médias et les notes. Une date garde ses quatre colonnes
 * réunies en un objet — une date floue ne se réduit pas à un jour.
 *
 * Les dates de naissance et de décès ne sont pas dupliquées : elles vivent dans `events` de type
 * `naissance` et `deces`, comme dans la base.
 */
export const EXPORT_FORMAT = 'arbre-genealogique';
export const EXPORT_VERSION = 1;

function rows(sql: string, ...params: unknown[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function exportPersons() {
  const nicknames = new Map<string, { name: string; type: string }[]>();
  for (const row of rows('SELECT person_id, name, type FROM name_variant ORDER BY name')) {
    const list = nicknames.get(row.person_id as string) ?? [];
    list.push({ name: row.name as string, type: row.type as string });
    nicknames.set(row.person_id as string, list);
  }

  const mediaByPerson = new Map<string, string[]>();
  for (const row of rows('SELECT media_id, person_id, role FROM media_person')) {
    const list = mediaByPerson.get(row.person_id as string) ?? [];
    list.push(row.media_id as string);
    mediaByPerson.set(row.person_id as string, list);
  }

  return rows('SELECT * FROM person ORDER BY family_name, given_names').map((row) => ({
    id: row.id as string,
    givenNames: row.given_names as string,
    familyName: row.family_name as string,
    birthName: text(row.birth_name),
    sex: row.sex as string,
    living: Boolean(row.living),
    summary: text(row.summary),
    branchId: text(row.branch_id),
    portraitMediaId: text(row.portrait_media_id),
    nameVariants: nicknames.get(row.id as string) ?? [],
    mediaIds: mediaByPerson.get(row.id as string) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

function exportEvents() {
  return rows('SELECT * FROM event ORDER BY COALESCE(date_min, date_max, id)').map((row) => ({
    id: row.id as string,
    personId: text(row.person_id),
    coupleId: text(row.couple_id),
    type: row.type as string,
    date: readDateRow(row, 'date'),
    placeId: text(row.place_id),
    description: text(row.description),
    sourceId: text(row.source_id),
    confidence: row.confidence as string,
    createdAt: row.created_at as string,
  }));
}

function exportCouples() {
  return rows('SELECT * FROM couple ORDER BY created_at').map((row) => ({
    id: row.id as string,
    // Un membre peut être parti de la base sans emporter l'union : le lien des enfants reste lu.
    partnerA: text(row.partner_a),
    partnerB: text(row.partner_b),
    type: row.type as string,
    status: row.status as string,
    start: readDateRow(row, 'start_date'),
    end: readDateRow(row, 'end_date'),
    placeId: text(row.place_id),
    createdAt: row.created_at as string,
  }));
}

function exportParentChild() {
  return rows('SELECT * FROM parent_child ORDER BY child_id, parent_id').map((row) => ({
    id: row.id as string,
    parentId: row.parent_id as string,
    childId: row.child_id as string,
    /** NULL tant que l'union n'a pas été déclarée : rien n'est deviné. */
    coupleId: text(row.couple_id),
    nature: row.nature as string,
    certainty: row.certainty as string,
  }));
}

function exportPlaces() {
  return rows('SELECT * FROM place ORDER BY name').map((row) => ({
    id: row.id as string,
    name: row.name as string,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
    parentPlaceId: text(row.parent_place_id),
  }));
}

function exportMedia() {
  const links = new Map<string, { personId: string; role: string }[]>();
  for (const row of rows('SELECT media_id, person_id, role FROM media_person')) {
    const list = links.get(row.media_id as string) ?? [];
    list.push({ personId: row.person_id as string, role: row.role as string });
    links.set(row.media_id as string, list);
  }

  return rows('SELECT * FROM media ORDER BY created_at').map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    /** Chemin relatif au dossier de données, reprise telle quelle dans l'archive ZIP. */
    originalPath: row.original_path as string,
    thumbPath: text(row.thumb_path),
    sha256: text(row.sha256),
    mime: text(row.mime),
    width: row.width ?? null,
    height: row.height ?? null,
    date: readDateRow(row, 'date'),
    caption: text(row.caption),
    placeId: text(row.place_id),
    sourceId: text(row.source_id),
    documentType: text(row.document_type),
    persons: links.get(row.id as string) ?? [],
    createdAt: row.created_at as string,
  }));
}

function exportNotes() {
  return rows('SELECT * FROM note ORDER BY created_at').map((row) => ({
    id: row.id as string,
    body: row.body as string,
    targetType: row.target_type as string,
    targetId: row.target_id as string,
    createdAt: row.created_at as string,
  }));
}

function exportSources() {
  return rows('SELECT * FROM source').map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    reference: text(row.reference),
    reliability: row.reliability as string,
  }));
}

function exportBranches() {
  return rows('SELECT * FROM branch ORDER BY name').map((row) => ({
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    rootPersonId: text(row.root_person_id),
    createdAt: row.created_at as string,
  }));
}

export interface ExportDocument {
  format: string;
  version: number;
  note: string;
  exportedAt: string;
  rootPersonId: string | null;
  counts: Record<string, number>;
  persons: ReturnType<typeof exportPersons>;
  branches: ReturnType<typeof exportBranches>;
  couples: ReturnType<typeof exportCouples>;
  parentChild: ReturnType<typeof exportParentChild>;
  events: ReturnType<typeof exportEvents>;
  places: ReturnType<typeof exportPlaces>;
  media: ReturnType<typeof exportMedia>;
  notes: ReturnType<typeof exportNotes>;
  sources: ReturnType<typeof exportSources>;
}

/** Le document complet, en un seul objet : les gens ouvrent un fichier, pas une archive de tables. */
export function buildExport(rootPersonId: string | null): ExportDocument {
  const persons = exportPersons();
  const couples = exportCouples();
  const parentChild = exportParentChild();
  const events = exportEvents();
  const places = exportPlaces();
  const media = exportMedia();
  const notes = exportNotes();
  const sources = exportSources();
  const branches = exportBranches();

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    note:
      "Export de l'arbre généalogique, lisible sans l'application. Les dates sont approximatives " +
      'par nature : chaque date garde son texte d’origine (date.text) et son incertitude ' +
      '(date.qualifier = exact, about, before, after, between, unknown). Les personnes sont ' +
      'reliées par parentChild (parent -> enfant) et par couples (deux partenaires) ; l’union ' +
      'dont vient un enfant est dans parentChild.coupleId, laissée vide tant que l’union n’est ' +
      'pas déclarée.',
    exportedAt: new Date().toISOString(),
    rootPersonId,
    counts: {
      persons: persons.length,
      couples: couples.length,
      parentChild: parentChild.length,
      events: events.length,
      places: places.length,
      media: media.length,
      notes: notes.length,
      sources: sources.length,
      branches: branches.length,
    },
    persons,
    branches,
    couples,
    parentChild,
    events,
    places,
    media,
    notes,
    sources,
  };
}

/** Format du nom de fichier proposé au moment de l'enregistrement. */
export function exportFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `arbre-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}.json`
  );
}
