import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express, { type Request, type Response } from 'express';
import { db, now, newId } from './db';
import { DATA_DIR } from './config';
import { readDateRow as toDate } from './dates';
import { RelationError, attachRelation, pruneEmptyCouples } from './relations';
import {
  BranchError,
  assignDescendants,
  createBranch,
  deleteBranch,
  getBranch,
  listBranches,
  setPersonBranch,
  updateBranch,
} from './branches';
import {
  LifeEventError,
  createEvent,
  deleteEvent,
  eventsOfPerson,
  setPersonDateEvent,
  updateEvent,
} from './life-events';
import { PlaceError, deletePlace, listPlaces, renamePlace } from './places';
import {
  backupFile,
  forceBackup,
  lastBackup,
  listBackups,
  scheduleAutoBackup,
} from './backup';
import { buildExport, exportFileName } from './export';
import { listNotices } from './notices';
import {
  ConfigError,
  patchConfig,
  readConfig,
  repairConfigAfterDelete,
  type AppConfig,
} from './app-config';
import {
  MAX_BYTES,
  MediaError,
  attachPersons,
  deleteMedia,
  detachPerson,
  getMedia,
  listMedia,
  mediaFile,
  setPortrait,
  storeMedia,
  storeThumbnail,
  updateMedia,
} from './media';
import type {
  BranchInput,
  Couple,
  CreatePersonInput,
  EventInput,
  GraphData,
  MediaKind,
  ParentChild,
  Person,
  PersonDetail,
  RelationInput,
} from '../shared/types';

const app = express();
app.use(express.json({ limit: '4mb' }));

const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 4321;

/** Le dossier de données se choisit dans ce fichier à la racine du projet, jamais versionné. */
const LOCAL_CONFIG_PATH = path.resolve(process.cwd(), 'config.local.json');

/** Le fichier est écrit entier : un réglage déjà présent reste, seul le dossier change. */
function writeLocalConfig(dataDir: string): void {
  let merged: Record<string, unknown> = {};
  try {
    if (fs.existsSync(LOCAL_CONFIG_PATH)) {
      merged = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8')) as Record<string, unknown>;
    }
  } catch {
    // Un fichier que l'on ne peut pas lire serait de toute façon ignoré au démarrage : on le remplace.
    console.error(`[réglages] ${LOCAL_CONFIG_PATH} est illisible, il sera réécrit.`);
  }
  merged.dataDir = dataDir;
  fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
}

/** Ce que le nouvel emplacement ne peut pas être. Le message se montre tel quel à l'écran. */
function rejectDataDir(resolved: string): string | null {
  const fold = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const project = fold(path.resolve(process.cwd()));
  const target = fold(resolved);

  // Le dépôt est destiné à GitHub : une base rangée là finirait par être versionnée.
  if (target === project || target.startsWith(project + path.sep)) {
    return (
      'Vos données ne peuvent pas vivre dans le dossier du programme : le dépôt est fait pour être ' +
      'partagé, et une famille y serait un jour versionnée. Choisissez un dossier hors du projet, ' +
      'par exemple D:\\Genealogie.'
    );
  }
  if (target === fold(path.parse(resolved).root)) {
    return 'Choisissez un dossier dans le disque, pas le disque lui-même : D:\\Genealogie plutôt que D:\\.';
  }
  return null;
}

type Row = Record<string, any>;

function mapPerson(row: Row): Person {
  return {
    id: row.id,
    givenNames: row.given_names,
    familyName: row.family_name,
    birthName: row.birth_name,
    sex: row.sex,
    living: row.living === 1,
    summary: row.summary,
    branchId: row.branch_id,
    portraitMediaId: row.portrait_media_id ?? null,
    birth: null,
    death: null,
  };
}

function loadPersons(): Person[] {
  const rows = db
    .prepare('SELECT * FROM person ORDER BY family_name COLLATE NOCASE, given_names COLLATE NOCASE')
    .all() as Row[];
  return rows.map(mapPerson);
}

function attachLifeDates(persons: Person[]): void {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const rows = db
    .prepare(
      `SELECT person_id, type, date_min, date_max, date_qualifier, date_text
         FROM event
        WHERE person_id IS NOT NULL AND type IN ('naissance', 'deces')`,
    )
    .all() as Row[];
  for (const row of rows) {
    const person = byId.get(row.person_id);
    if (!person) continue;
    const date = toDate(row, 'date');
    if (row.type === 'naissance') person.birth = date;
    else person.death = date;
  }
}

function loadCouples(): Couple[] {
  return (db.prepare('SELECT * FROM couple').all() as Row[]).map((row) => ({
    id: row.id,
    partnerA: row.partner_a,
    partnerB: row.partner_b,
    type: row.type,
    status: row.status,
    start: toDate(row, 'start_date'),
  }));
}

function loadParentChild(): ParentChild[] {
  return (db.prepare('SELECT * FROM parent_child').all() as Row[]).map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    childId: row.child_id,
    coupleId: row.couple_id,
    nature: row.nature,
  }));
}

/** Un refus de relation se montre tel quel : la personne doit comprendre ce qu'elle peut corriger. */
function sendRelationError(res: Response, error: unknown): void {
  if (error instanceof RelationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error('[relation]', error);
  res.status(500).json({ error: 'La liaison n’a pas pu être enregistrée' });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dataDir: DATA_DIR });
});

app.get('/api/state', (_req, res) => {
  const persons = db.prepare('SELECT COUNT(*) AS n FROM person').get() as { n: number };
  const couples = db.prepare('SELECT COUNT(*) AS n FROM couple').get() as { n: number };
  const media = db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number };
  const unattached = db
    .prepare('SELECT COUNT(*) AS n FROM media WHERE id NOT IN (SELECT media_id FROM media_person)')
    .get() as { n: number };
  const config = readConfig();
  res.json({
    dataDir: DATA_DIR,
    dataDirFromEnv: Boolean(process.env.FAMILY_DATA_DIR?.trim()),
    rootPersonId: config.rootPersonId,
    mePersonId: config.mePersonId,
    counts: { persons: persons.n, couples: couples.n, media: media.n, mediaUnattached: unattached.n },
    backup: lastBackup(),
    warnings: listNotices(),
  });
});

app.get('/api/backups', (_req, res) => {
  res.json({ backups: listBackups() });
});

/**
 * Une archive déjà écrite, livrée octet pour octet : c'est le « sauvegarder vers… » de la spec, la
 * seule copie qui protège vraiment parce qu'elle quitte le disque. Le nom est validé côté serveur
 * avant l'ouverture du fichier.
 */
app.get('/api/backups/file', (req, res) => {
  const name = String(req.query.name ?? '');
  const file = backupFile(name);
  if (!file) {
    res.status(404).json({ error: 'Archive introuvable dans le dossier de sauvegardes' });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  const stream = fs.createReadStream(file.path);
  stream.on('error', () => {
    // L'entête est déjà partie : la réponse s'arrête là, le client verra un fichier incomplet.
    res.destroy();
  });
  stream.pipe(res);
});

/** Tout l'arbre en un fichier JSON que n'importe quel éditeur ouvre, sans l'application. */
app.get('/api/export/json', (_req, res) => {
  const exportDocument = buildExport(readConfig().rootPersonId);
  const name = exportFileName();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(JSON.stringify(exportDocument, null, 2));
});

app.post('/api/backup', async (_req, res) => {
  try {
    const info = await forceBackup('manuel');
    res.json(info);
  } catch (error) {
    console.error('[sauvegarde]', error);
    res.status(500).json({ error: 'La sauvegarde a échoué' });
  }
});

app.get('/api/graph', (_req, res) => {
  const persons = loadPersons();
  attachLifeDates(persons);
  const graph: GraphData = {
    persons,
    couples: loadCouples(),
    parentChild: loadParentChild(),
    branches: listBranches(),
    rootId: readConfig().rootPersonId,
    dataDir: DATA_DIR,
  };
  res.json(graph);
});

app.get('/api/persons/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM person WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!row) {
    res.status(404).json({ error: 'Personne introuvable' });
    return;
  }

  const person = mapPerson(row);
  attachLifeDates([person]);

  const nicknames = (
    db.prepare('SELECT name FROM name_variant WHERE person_id = ?').all(person.id) as Row[]
  ).map((r) => r.name);

  const events = eventsOfPerson(person.id);

  const fetchPersons = (ids: string[]): Person[] => {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM person WHERE id IN (${marks})`).all(...ids) as Row[];
    const list = rows.map(mapPerson);
    attachLifeDates(list);
    return list;
  };

  const parentRows = db
    .prepare('SELECT parent_id FROM parent_child WHERE child_id = ?')
    .all(person.id) as Row[];
  const parents = fetchPersons(parentRows.map((r) => r.parent_id));

  const siblingRows = db
    .prepare(
      `SELECT DISTINCT p.id
         FROM person p
         JOIN parent_child pc ON pc.child_id = p.id
        WHERE pc.parent_id IN (SELECT parent_id FROM parent_child WHERE child_id = ?)
          AND p.id <> ?`,
    )
    .all(person.id, person.id) as Row[];
  const siblings = fetchPersons(siblingRows.map((r) => r.id));

  const partnerRows = db
    .prepare(
      `SELECT CASE WHEN partner_a = ? THEN partner_b ELSE partner_a END AS pid
         FROM couple
        WHERE partner_a = ? OR partner_b = ?`,
    )
    .all(person.id, person.id, person.id) as Row[];
  const partners = fetchPersons(
    partnerRows.map((r) => r.pid).filter((id): id is string => Boolean(id)),
  );

  const childRows = db
    .prepare('SELECT child_id FROM parent_child WHERE parent_id = ?')
    .all(person.id) as Row[];
  const children = fetchPersons(childRows.map((r) => r.child_id));

  const detail: PersonDetail = {
    ...person,
    nicknames,
    events,
    parents,
    siblings,
    partners,
    children,
    media: listMedia({ personId: person.id }),
  };
  res.json(detail);
});

app.post('/api/persons', (req, res) => {
  const body = req.body as CreatePersonInput;
  const givenNames = (body.givenNames ?? '').trim();
  if (!givenNames) {
    res.status(400).json({ error: 'Le prénom est obligatoire' });
    return;
  }

  const id = newId();
  const timestamp = now();
  const isLiving = body.deathText && body.deathText.trim() ? 0 : body.living === false ? 0 : 1;

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO person (id, given_names, family_name, birth_name, sex, living, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      givenNames,
      (body.familyName ?? '').trim(),
      body.birthName ?? null,
      body.sex ?? '?',
      isLiving,
      timestamp,
      timestamp,
    );

    setPersonDateEvent(id, 'naissance', body.birthText);
    setPersonDateEvent(id, 'deces', body.deathText);

    const relation = body.relation;
    if (relation?.ofPersonId) attachRelation(id, relation);

    // Le premier visage de l'arbre devient son point de départ : « moi » reste un choix explicite.
    if (!readConfig().rootPersonId) patchConfig({ rootPersonId: id });
  });

  try {
    create();
  } catch (error) {
    sendRelationError(res, error);
    return;
  }
  res.status(201).json({ id });
});

/** Rattache deux personnes que la base connaît déjà : un enfant, un parent, un conjoint. */
app.post('/api/persons/:id/relations', (req, res) => {
  try {
    attachRelation(req.params.id, req.body as RelationInput);
  } catch (error) {
    sendRelationError(res, error);
    return;
  }
  res.status(201).json({ ok: true });
});

app.patch('/api/persons/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM person WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!row) {
    res.status(404).json({ error: 'Personne introuvable' });
    return;
  }

  const body = req.body as Partial<CreatePersonInput> & {
    nickname?: string | null;
    portraitMediaId?: string | null;
    branchId?: string | null;
  };

  const update = db.transaction(() => {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.givenNames !== undefined) {
      fields.push('given_names = ?');
      values.push(body.givenNames.trim());
    }
    if (body.familyName !== undefined) {
      fields.push('family_name = ?');
      values.push(body.familyName.trim());
    }
    if (body.birthName !== undefined) {
      fields.push('birth_name = ?');
      values.push(body.birthName);
    }
    if (body.sex !== undefined) {
      fields.push('sex = ?');
      values.push(body.sex);
    }
    if (body.living !== undefined) {
      fields.push('living = ?');
      values.push(body.living ? 1 : 0);
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(now(), req.params.id);
      db.prepare(`UPDATE person SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    if (body.birthText !== undefined) setPersonDateEvent(req.params.id, 'naissance', body.birthText);
    if (body.deathText !== undefined) {
      setPersonDateEvent(req.params.id, 'deces', body.deathText);
      if (body.deathText && body.deathText.trim()) {
        db.prepare('UPDATE person SET living = 0 WHERE id = ?').run(req.params.id);
      }
    }

    if (body.nickname !== undefined) {
      db.prepare("DELETE FROM name_variant WHERE person_id = ? AND type = 'surnom'").run(
        req.params.id,
      );
      const nick = (body.nickname ?? '').trim();
      if (nick) {
        db.prepare('INSERT INTO name_variant (id, person_id, name, type) VALUES (?, ?, ?, ?)').run(
          newId(),
          req.params.id,
          nick,
          'surnom',
        );
      }
    }

    if (body.portraitMediaId !== undefined) {
      setPortrait(req.params.id, body.portraitMediaId);
    }

    if (body.branchId !== undefined) {
      setPersonBranch(req.params.id, body.branchId);
    }
  });

  try {
    update();
  } catch (error) {
    sendWriteError(res, error);
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/persons/:id', (req, res) => {
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM person WHERE id = ?').run(req.params.id);
    pruneEmptyCouples();
    repairConfigAfterDelete(req.params.id);
  });
  remove();
  res.json({ ok: true });
});

/**
 * Les faits d'une vie se saisissent ici : un type, une date écrite en français, un lieu, une source,
 * un degré de confiance. Le serveur analyse la date et garde le texte tel quel quand il ne la lit
 * pas — rien n'est jamais rangé comme une année inventée.
 */
app.post('/api/events', (req, res) => {
  try {
    res.status(201).json({ event: createEvent(req.body as EventInput) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

app.patch('/api/events/:id', (req, res) => {
  try {
    res.json({ event: updateEvent(req.params.id, req.body as EventInput) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

app.delete('/api/events/:id', (req, res) => {
  try {
    deleteEvent(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/**
 * Les lieux ne se créent pas à part : un fait qui dit « Roubaix » trouve la ligne ou la pose. On
 * vient ici les chercher pour les corriger — renommer suit les faits qui pointaient déjà ici,
 * effacer les rend à un lieu inconnu sans rien leur enlever d'autre.
 */
app.get('/api/places', (_req, res) => {
  res.json({ places: listPlaces() });
});

app.patch('/api/places/:id', (req, res) => {
  const body = req.body as { name?: string };
  try {
    res.json({ place: renamePlace(req.params.id, body.name ?? '') });
  } catch (error) {
    sendWriteError(res, error);
  }
});

app.delete('/api/places/:id', (req, res) => {
  try {
    res.json({ ok: true, ...deletePlace(req.params.id) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/**
 * Une branche est un nom et une couleur posés sur une ligne de l'arbre. Rien n'est deviné : créer
 * une branche sans dire de qui elle part ne range personne.
 */
app.post('/api/branches', (req, res) => {
  const body = req.body as BranchInput & { includeDescendants?: boolean };
  try {
    res.status(201).json({ branch: createBranch(body) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

app.patch('/api/branches/:id', (req, res) => {
  const body = req.body as BranchInput;
  try {
    res.json({ branch: updateBranch(req.params.id, body) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/**
 * Range la descendance d'une personne sous une branche : c'est le geste que personne ne veut faire
 * case par case, et le seul qui remplisse vraiment une branche. Une personne déjà rangée ailleurs
 * n'est pas déplacée.
 */
app.post('/api/branches/:id/descendants', (req, res) => {
  const body = req.body as { rootPersonId?: string };
  try {
    const root = body.rootPersonId ?? getBranch(req.params.id).rootPersonId;
    if (!root) {
      throw new BranchError(
        400,
        'Cette branche n’a encore personne dont partir : choisissez d’abord sa tête, puis rangez.',
      );
    }
    res.json({ assigned: assignDescendants(req.params.id, root) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/** Effacer une branche rend ses personnes au hors-classe ; aucune personne ne se perd en route. */
app.delete('/api/branches/:id', (req, res) => {
  try {
    deleteBranch(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/**
 * Les médias entrent par leurs octets, pas par du JSON : une photo n'a rien à faire encodée en
 * base64 dans une chaîne. Le plafond est celui du module, plus une marge pour les entêtes.
 */
const rawBytes = express.raw({
  type: () => true,
  limit: `${Math.ceil(MAX_BYTES / 1024 / 1024) + 4}mb`,
});

/**
 * Un refus d'écriture se montre tel quel : ces erreurs-là portent déjà un message français qui dit ce
 * qu'il faut corriger. Le reste est une panne, et une panne ne s'habille pas des mots d'un refus.
 */
function sendWriteError(res: Response, error: unknown): void {
  if (
    error instanceof MediaError ||
    error instanceof RelationError ||
    error instanceof BranchError ||
    error instanceof ConfigError ||
    error instanceof LifeEventError ||
    error instanceof PlaceError
  ) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error('[enregistrement]', error);
  res.status(500).json({ error: 'L’enregistrement n’a pas abouti.' });
}

app.post('/api/media', rawBytes, (req, res) => {
  const buffer = req.body as unknown as Buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    res.status(400).json({ error: 'Aucun octet n’est arrivé : le fichier est resté vide.' });
    return;
  }
  try {
    const { media, deduped } = storeMedia({
      kind: (String(req.query.kind ?? 'photo') as MediaKind) ?? 'photo',
      mime: String(req.query.mime ?? req.headers['content-type'] ?? '').split(';')[0].trim(),
      buffer,
      taken: req.query.taken ? String(req.query.taken) : null,
      caption: req.query.caption ? String(req.query.caption) : null,
      documentType: req.query.documentType ? String(req.query.documentType) : null,
      width: Number.parseInt(String(req.query.width ?? ''), 10) || null,
      height: Number.parseInt(String(req.query.height ?? ''), 10) || null,
    });
    res.status(deduped ? 200 : 201).json({ media, deduped });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/** La vignette se dessine dans le navigateur : le serveur la range, il ne décode rien. */
app.put('/api/media/:id/thumbnail', rawBytes, (req, res) => {
  const buffer = req.body as unknown as Buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    res.status(400).json({ error: 'Aucune vignette n’est arrivée.' });
    return;
  }
  try {
    res.json({ media: storeThumbnail(req.params.id, buffer) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/** `?state=a-relier` donne le bac d'entrée : ce qui est dans le dossier sans savoir à qui parler. */
app.get('/api/media', (req, res) => {
  const unattached = String(req.query.state ?? '') === 'a-relier';
  res.json({ media: listMedia(unattached ? { unattached: true } : {}) });
});

function sendMediaPart(res: Response, id: string, part: 'original' | 'thumb'): void {
  try {
    const { file, mime } = mediaFile(id, part);
    res.setHeader('Content-Type', mime ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (error) {
    sendWriteError(res, error);
  }
}

app.get('/api/media/:id/original', (req, res) => sendMediaPart(res, req.params.id, 'original'));
app.get('/api/media/:id/thumbnail', (req, res) => sendMediaPart(res, req.params.id, 'thumb'));

app.patch('/api/media/:id', (req, res) => {
  const body = req.body as {
    caption?: string | null;
    kind?: MediaKind;
    documentType?: string | null;
    dateText?: string | null;
  };
  try {
    res.json({ media: updateMedia(req.params.id, body) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/** Seul endroit de l'application qui efface des fichiers du disque — d'où la confirmation à l'écran. */
app.delete('/api/media/:id', (req, res) => {
  try {
    deleteMedia(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/** Rattachement, seul ou par lot : c'est la table qui rend une photo de groupe utilisable. */
app.post('/api/media/:id/persons', (req, res) => {
  const body = req.body as { personIds?: string[]; role?: string };
  const personIds = (body.personIds ?? []).filter((id) => typeof id === 'string' && id);
  if (!personIds.length) {
    res.status(400).json({ error: 'Choisissez au moins une personne à rattacher.' });
    return;
  }
  try {
    attachPersons(req.params.id, personIds, body.role ?? 'sujet');
    res.json({ media: getMedia(req.params.id) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

app.delete('/api/media/:id/persons/:personId', (req, res) => {
  try {
    detachPerson(req.params.id, req.params.personId);
    res.json({ media: getMedia(req.params.id) });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/**
 * Les deux personnes de référence se règlent ici, séparément : `rootPersonId` d'où part l'arbre,
 * `mePersonId` qui vous êtes dedans. Un champ absent laisse ce qui est déjà écrit, un champ à `null`
 * le rend vide — « moi » se retire aussi bien qu'il se met.
 */
app.put('/api/config', (req, res) => {
  try {
    const next = patchConfig(req.body as Partial<AppConfig>);
    res.json({ ok: true, rootPersonId: next.rootPersonId, mePersonId: next.mePersonId });
  } catch (error) {
    sendWriteError(res, error);
  }
});

/**
 * Changer le dossier de données s'écrit dans `config.local.json` et se dit à ouvrir au prochain
 * démarrage. Le serveur ne rouvre pas la base derrière le dos de l'utilisateur : la base est
 * ouverte, les médias référencés par des chemins relatifs, et un solde de course entre deux
 * dossiers produirait un arbre à moitié écrit. Rien n'est donc simulé — le redémarrage est demandé.
 */
app.put('/api/config/data-dir', (req, res) => {
  const body = req.body as { dataDir?: string };
  const requested = (body.dataDir ?? '').trim().replace(/^["']+|["']+$/g, '');
  if (!requested) {
    res.status(400).json({ error: 'Indiquez le dossier où doivent vivre vos données.' });
    return;
  }

  const resolved = path.resolve(requested);
  const refusal = rejectDataDir(resolved);
  if (refusal) {
    res.status(400).json({ error: refusal });
    return;
  }

  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch (error) {
    res.status(400).json({
      error: `Ce dossier n’est pas utilisable : ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  writeLocalConfig(resolved);
  res.json({
    ok: true,
    dataDir: resolved,
    restartNeeded: resolved !== DATA_DIR,
    note:
      process.env.FAMILY_DATA_DIR?.trim() && resolved !== DATA_DIR
        ? `Enregistré dans config.local.json. La variable FAMILY_DATA_DIR (actuellement ${process.env.FAMILY_DATA_DIR}) prime sur ce fichier : retirez-la pour que ce choix soit utilisé.`
        : resolved !== DATA_DIR
          ? 'Enregistré. Redémarrez l’application pour ouvrir ce dossier.'
          : 'C’est déjà le dossier ouvert : rien ne change.',
  });
});

/**
 * Une photo de 200 Mo est rejetée par le parseur avant d'arriver jusqu'à nos propres gardes. Sans
 * cette traductrice, l'écran afficherait une page HTML d'Express en anglais.
 */
app.use((error: unknown, req: Request, res: Response, next: (e: unknown) => void) => {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'entity.too.large' || code === 'request_entity_too_large') {
    const isUpload = !req.is('json') && !req.is('text/*');
    res.status(413).json({
      error: isUpload
        ? `Ce fichier est trop gros pour entrer ici. Découpez le scan ou importez-le par morceaux — la limite est de ${Math.round(MAX_BYTES / 1024 / 1024)} Mo.`
        : 'Cette demande est trop grosse pour être traitée.',
    });
    return;
  }
  if (res.headersSent || !req.path.startsWith('/api')) {
    next(error);
    return;
  }
  console.error('[requête]', error);
  res.status(500).json({ error: 'La demande n’a pas abouti.' });
});

const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Route inconnue' });
      return;
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

/** Ouvre le navigateur par défaut une fois le serveur réellement à l'écoute. */
function openBrowser(url: string): void {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  });
  child.on('error', () => console.log(`Ouvrez ${url} dans votre navigateur.`));
  child.unref();
}

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Arbre de famille — ${url}`);
  console.log(`Données : ${DATA_DIR}`);
  if (process.env.OPEN_BROWSER && process.platform === 'win32') openBrowser(url);
  scheduleAutoBackup();
});

server.on('error', (error: Error) => {
  if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
  console.error(`\n  Le port ${PORT} est déjà occupé, l'application ne peut pas démarrer.`);
  console.error(`  So elle est déjà ouverte dans une autre fenêtre : retrouvez-la sur http://localhost:${PORT}.`);
  console.error(`  So un autre programme occupe ce port : relancez avec la variable PORT changée.`);
  console.error('      set PORT=4322 && npm start\n');
  process.exit(1);
});
