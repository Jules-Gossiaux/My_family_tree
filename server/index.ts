import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { db, now, newId } from './db';
import { DATA_DIR } from './config';
import { parseGenealogyDate } from './dates';
import type {
  Couple,
  CreatePersonInput,
  GDate,
  GraphData,
  ParentChild,
  Person,
  PersonDetail,
} from '../shared/types';

const app = express();
app.use(express.json({ limit: '4mb' }));

const PORT = Number(process.env.PORT ?? 4321);
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

interface AppConfig {
  rootPersonId: string | null;
}

function readConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<AppConfig>;
      return { rootPersonId: parsed.rootPersonId ?? null };
    }
  } catch {
    /* configuration illisible : on repart de zéro */
  }
  return { rootPersonId: null };
}

function writeConfig(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

type Row = Record<string, any>;

function toDate(row: Row, prefix: string): GDate | null {
  const min = row[`${prefix}_min`] ?? null;
  const max = row[`${prefix}_max`] ?? null;
  const qualifier = row[`${prefix}_qualifier`] ?? null;
  const text = row[`${prefix}_text`] ?? null;
  if (!min && !max && !text) return null;
  return { min, max, qualifier: qualifier ?? 'unknown', text };
}

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

function findCouple(a: string, b: string | null): Row | undefined {
  if (!b) {
    return db
      .prepare('SELECT * FROM couple WHERE partner_b IS NULL AND partner_a = ?')
      .get(a) as Row | undefined;
  }
  return db
    .prepare(
      `SELECT * FROM couple
        WHERE (partner_a = ? AND partner_b = ?) OR (partner_a = ? AND partner_b = ?)`,
    )
    .get(a, b, b, a) as Row | undefined;
}

function createCouple(a: string, b: string | null): Row {
  const existing = findCouple(a, b);
  if (existing) return existing;
  const id = newId();
  db.prepare(
    'INSERT INTO couple (id, partner_a, partner_b, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, a, b, now());
  return db.prepare('SELECT * FROM couple WHERE id = ?').get(id) as Row;
}

function linkParentChild(parentId: string, childId: string, coupleId: string | null): void {
  const existing = db
    .prepare('SELECT id FROM parent_child WHERE parent_id = ? AND child_id = ?')
    .get(parentId, childId) as Row | undefined;
  if (existing) {
    if (coupleId) {
      db.prepare('UPDATE parent_child SET couple_id = ? WHERE id = ?').run(coupleId, existing.id);
    }
    return;
  }
  db.prepare(
    'INSERT INTO parent_child (id, parent_id, child_id, couple_id) VALUES (?, ?, ?, ?)',
  ).run(newId(), parentId, childId, coupleId);
}

function setLifeEvent(personId: string, type: 'naissance' | 'deces', text?: string | null): void {
  const existing = db
    .prepare('SELECT id FROM event WHERE person_id = ? AND type = ?')
    .get(personId, type) as Row | undefined;

  if (!text || !text.trim()) {
    if (existing) db.prepare('DELETE FROM event WHERE id = ?').run(existing.id);
    return;
  }

  const date = parseGenealogyDate(text);
  if (!date) return;

  if (existing) {
    db.prepare(
      'UPDATE event SET date_min = ?, date_max = ?, date_qualifier = ?, date_text = ? WHERE id = ?',
    ).run(date.min, date.max, date.qualifier, date.text, existing.id);
  } else {
    db.prepare(
      `INSERT INTO event (id, person_id, type, date_min, date_max, date_qualifier, date_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), personId, type, date.min, date.max, date.qualifier, date.text, now());
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dataDir: DATA_DIR });
});

app.get('/api/state', (_req, res) => {
  const persons = db.prepare('SELECT COUNT(*) AS n FROM person').get() as { n: number };
  const couples = db.prepare('SELECT COUNT(*) AS n FROM couple').get() as { n: number };
  const media = db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number };
  const config = readConfig();
  res.json({
    dataDir: DATA_DIR,
    rootPersonId: config.rootPersonId,
    counts: { persons: persons.n, couples: couples.n, media: media.n },
  });
});

app.get('/api/graph', (_req, res) => {
  const persons = loadPersons();
  attachLifeDates(persons);
  const graph: GraphData = {
    persons,
    couples: loadCouples(),
    parentChild: loadParentChild(),
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

  const events = (
    db
      .prepare(
        `SELECT e.*, p.name AS place_name
           FROM event e
           LEFT JOIN place p ON p.id = e.place_id
          WHERE e.person_id = ?
          ORDER BY COALESCE(e.date_min, e.date_max, '9999')`,
      )
      .all(person.id) as Row[]
  ).map((e) => ({
    id: e.id,
    type: e.type,
    date: toDate(e, 'date'),
    place: e.place_name ?? null,
    description: e.description ?? null,
  }));

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

    setLifeEvent(id, 'naissance', body.birthText);
    setLifeEvent(id, 'deces', body.deathText);

    const relation = body.relation;
    if (relation?.ofPersonId) {
      const anchor = relation.ofPersonId;

      if (relation.type === 'child') {
        let coupleId: string | null = null;
        if (relation.otherParentId) {
          coupleId = createCouple(anchor, relation.otherParentId).id as string;
        } else {
          const existing = db
            .prepare('SELECT id FROM couple WHERE partner_a = ? OR partner_b = ?')
            .all(anchor, anchor) as Row[];
          if (existing.length === 1) coupleId = existing[0].id;
        }
        linkParentChild(anchor, id, coupleId);
        if (relation.otherParentId) linkParentChild(relation.otherParentId, id, coupleId);
      }

      if (relation.type === 'partner') {
        createCouple(anchor, id);
      }

      if (relation.type === 'parent') {
        const existingParents = db
          .prepare('SELECT parent_id FROM parent_child WHERE child_id = ?')
          .all(anchor) as Row[];
        if (existingParents.length === 1) {
          const other = existingParents[0].parent_id as string;
          const couple = createCouple(id, other);
          db.prepare('UPDATE parent_child SET couple_id = ? WHERE child_id = ? AND parent_id = ?').run(
            couple.id,
            anchor,
            other,
          );
          linkParentChild(id, anchor, couple.id);
        } else {
          linkParentChild(id, anchor, null);
        }
      }
    }

    const config = readConfig();
    if (!config.rootPersonId) {
      writeConfig({ rootPersonId: id });
    }
  });

  create();
  res.status(201).json({ id });
});

app.patch('/api/persons/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM person WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!row) {
    res.status(404).json({ error: 'Personne introuvable' });
    return;
  }

  const body = req.body as Partial<CreatePersonInput> & { nickname?: string | null };

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

    if (body.birthText !== undefined) setLifeEvent(req.params.id, 'naissance', body.birthText);
    if (body.deathText !== undefined) {
      setLifeEvent(req.params.id, 'deces', body.deathText);
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
        db.prepare(
          'INSERT INTO name_variant (id, person_id, name, type) VALUES (?, ?, ?, ?)',
        ).run(newId(), req.params.id, nick, 'surnom');
      }
    }
  });

  update();
  res.json({ ok: true });
});

app.delete('/api/persons/:id', (req, res) => {
  db.prepare('DELETE FROM person WHERE id = ?').run(req.params.id);
  const config = readConfig();
  if (config.rootPersonId === req.params.id) {
    const next = db.prepare('SELECT id FROM person LIMIT 1').get() as Row | undefined;
    writeConfig({ rootPersonId: next?.id ?? null });
  }
  res.json({ ok: true });
});

app.put('/api/config', (req, res) => {
  const body = req.body as Partial<AppConfig>;
  const config = readConfig();
  writeConfig({ rootPersonId: body.rootPersonId ?? config.rootPersonId });
  res.json({ ok: true });
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

app.listen(PORT, () => {
  console.log(`Arbre de famille — http://localhost:${PORT}`);
  console.log(`Données : ${DATA_DIR}`);
});
