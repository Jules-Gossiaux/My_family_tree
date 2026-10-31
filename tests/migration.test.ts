import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';

/**
 * Le vrai chemin de reprise : une base déjà remplie, créée avec l'ancien schéma, que la
 * migration doit traverser sans rien perdre. Les autres tests partent d'une base neuve.
 */
const OLD_SCHEMA = `
  CREATE TABLE branch (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    color          TEXT NOT NULL DEFAULT '#C9A961',
    root_person_id TEXT,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE person (
    id                TEXT PRIMARY KEY,
    given_names       TEXT NOT NULL DEFAULT '',
    family_name       TEXT NOT NULL DEFAULT '',
    birth_name        TEXT,
    sex               TEXT NOT NULL DEFAULT '?',
    living            INTEGER NOT NULL DEFAULT 1,
    summary           TEXT,
    portrait_media_id TEXT,
    branch_id         TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE couple (
    id           TEXT PRIMARY KEY,
    partner_a    TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    partner_b    TEXT REFERENCES person(id) ON DELETE CASCADE,
    type         TEXT NOT NULL DEFAULT 'inconnu',
    status       TEXT NOT NULL DEFAULT 'en_cours',
    start_date_min TEXT, start_date_max TEXT, start_date_qualifier TEXT, start_date_text TEXT,
    end_date_min TEXT, end_date_max TEXT, end_date_qualifier TEXT, end_date_text TEXT,
    place_id     TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE parent_child (
    id        TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    child_id  TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    couple_id TEXT REFERENCES couple(id) ON DELETE SET NULL,
    nature    TEXT NOT NULL DEFAULT 'biologique',
    certainty TEXT NOT NULL DEFAULT 'probable',
    UNIQUE (parent_id, child_id)
  );

  CREATE TABLE event (
    id             TEXT PRIMARY KEY,
    person_id      TEXT REFERENCES person(id) ON DELETE CASCADE,
    couple_id      TEXT REFERENCES couple(id) ON DELETE CASCADE,
    type           TEXT NOT NULL,
    date_min TEXT, date_max TEXT, date_qualifier TEXT, date_text TEXT,
    place_id       TEXT,
    description    TEXT,
    source_id      TEXT,
    confidence     TEXT NOT NULL DEFAULT 'probable',
    created_at     TEXT NOT NULL
  );
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-migration-'));
process.env.FAMILY_DATA_DIR = dir;
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });

const dbPath = path.join(dir, 'data', 'famille.db');

const ids = {
  paul: 'aaaaaaaa-0000-4000-8000-000000000001',
  marie: 'aaaaaaaa-0000-4000-8000-000000000002',
  eve: 'aaaaaaaa-0000-4000-8000-000000000003',
  couple: 'aaaaaaaa-0000-4000-8000-0000000000aa',
  act: 'aaaaaaaa-0000-4000-8000-0000000000bb',
  branchePaul: 'aaaaaaaa-0000-4000-8000-0000000000d1',
  brancheVeuve: 'aaaaaaaa-0000-4000-8000-0000000000d2',
  personneEffacee: 'aaaaaaaa-0000-4000-8000-0000000000ff',
};

function writeOldFamily(): void {
  const legacy = new Database(dbPath);
  legacy.pragma('foreign_keys = ON');
  legacy.exec(OLD_SCHEMA);

  const stamp = '2026-01-01T00:00:00.000Z';
  const insertPerson = legacy.prepare(
    'INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
  );
  insertPerson.run(ids.paul, 'Paul', 'Dupont', 'M', stamp, stamp);
  insertPerson.run(ids.marie, 'Marie', 'Rivière', 'F', stamp, stamp);
  insertPerson.run(ids.eve, 'Eve', 'Dupont', 'F', stamp, stamp);

  legacy
    .prepare('INSERT INTO couple (id, partner_a, partner_b, type, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ids.couple, ids.paul, ids.marie, 'mariage', 'en_cours', stamp);
  legacy
    .prepare('INSERT INTO parent_child (id, parent_id, child_id, couple_id) VALUES (?, ?, ?, ?)')
    .run('aaaaaaaa-0000-4000-8000-0000000000c1', ids.paul, ids.eve, ids.couple);
  legacy
    .prepare('INSERT INTO parent_child (id, parent_id, child_id, couple_id) VALUES (?, ?, ?, ?)')
    .run('aaaaaaaa-0000-4000-8000-0000000000c2', ids.marie, ids.eve, ids.couple);
  legacy
    .prepare('INSERT INTO event (id, person_id, couple_id, type, created_at) VALUES (?, NULL, ?, ?, ?)')
    .run(ids.act, ids.couple, 'mariage', stamp);

  // Deux branches d'une base ancienne : l'une partie d'une personne encore là, l'autre d'une
  // personne déjà effacée à l'époque où rien n'interdisait de laisser sa tête en l'air.
  const insertBranch = legacy.prepare(
    'INSERT INTO branch (id, name, color, root_person_id, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  insertBranch.run(ids.branchePaul, 'Descendance Dupont', '#5fb0a7', ids.paul, stamp);
  insertBranch.run(ids.brancheVeuve, 'Ligne orpheline', '#d98a8a', ids.personneEffacee, stamp);
  legacy.prepare('UPDATE person SET branch_id = ? WHERE id = ?').run(ids.branchePaul, ids.eve);

  legacy.close();
}

writeOldFamily();

// Importer la base applique schema.sql (les tables existent déjà, il ne fait rien) puis les
// migrations : c'est exactement le premier démarrage sur un dossier qui a déjà des données.
const { db } = await import('../server/db');
const { pruneEmptyCouples } = await import('../server/relations');
const { runMigrations } = await import('../server/migrations');

type Row = Record<string, any>;

function row(sql: string, ...params: unknown[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

function coupleColumns(): string {
  return (db.prepare("SELECT group_concat(name, ',') AS n FROM pragma_table_info('couple')").get() as Row)
    .n as string;
}

describe('reprise d’une base créée avec l’ancien schéma', () => {
  it('traverse la migration sans rien perdre', () => {
    assert.equal(db.pragma('user_version', { simple: true }), 2);

    const couple = row('SELECT * FROM couple WHERE id = ?', ids.couple);
    assert.ok(couple, 'le couple doit survivre à la mise à jour du schéma');
    assert.equal(couple.partner_a, ids.paul, 'les deux membres doivent être reconstruits à l’identique');
    assert.equal(couple.partner_b, ids.marie);
    assert.equal(couple.type, 'mariage', 'les colonnes de dates et de type ne doivent pas se déplacer');

    const children = db
      .prepare('SELECT parent_id, couple_id FROM parent_child WHERE child_id = ? ORDER BY parent_id')
      .all(ids.eve) as Row[];
    assert.equal(children.length, 2);
    for (const link of children) assert.equal(link.couple_id, ids.couple);

    assert.ok(row('SELECT id FROM event WHERE id = ?', ids.act), 'l’acte de mariage est conservé');
    assert.ok(coupleColumns().includes('start_date_text'));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  it('remet la tête de ligne en règle', () => {
    const dupont = row('SELECT * FROM branch WHERE id = ?', ids.branchePaul);
    assert.ok(dupont, 'la branche doit survivre à la mise à jour du schéma');
    assert.equal(dupont.name, 'Descendance Dupont');
    assert.equal(dupont.color, '#5fb0a7', 'la teinte choisie ne doit pas redevenir la défaut');
    assert.equal(dupont.root_person_id, ids.paul);
    assert.equal(row('SELECT branch_id FROM person WHERE id = ?', ids.eve)?.branch_id, ids.branchePaul);

    const tete = db.prepare('PRAGMA foreign_key_list(branch)').all() as Row[];
    assert.equal(
      tete.find((entry) => entry.from === 'root_person_id')?.on_delete,
      'SET NULL',
      'la tête doit devenir une vraie référence',
    );

    const orpheline = row('SELECT * FROM branch WHERE id = ?', ids.brancheVeuve);
    assert.ok(orpheline, 'la branche se garde');
    assert.equal(
      orpheline.root_person_id,
      null,
      'une tête qui ne désigne plus personne est remise à zéro au lieu de pendre en l’air',
    );
  });

  it('ne casse plus l’union quand un parent est effacé', () => {
    const remove = db.transaction(() => {
      db.prepare('DELETE FROM person WHERE id = ?').run(ids.paul);
      pruneEmptyCouples();
    });
    remove();

    const couple = row('SELECT * FROM couple WHERE id = ?', ids.couple);
    assert.ok(couple, 'effacer Paul ne doit plus effacer son mariage');
    assert.equal(couple.partner_a, null);
    assert.equal(
      row('SELECT couple_id FROM parent_child WHERE child_id = ?', ids.eve)?.couple_id,
      ids.couple,
      'Eve doit rester l’enfant de cette union',
    );
    assert.ok(row('SELECT id FROM event WHERE id = ?', ids.act), 'l’acte de mariage survit');
    assert.equal(
      row('SELECT root_person_id FROM branch WHERE id = ?', ids.branchePaul)?.root_person_id,
      null,
      'la branche survit à sa tête et se cherche une autre tête',
    );
  });

  it('ne rejoue pas la migration au démarrage suivant', () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM couple').get() as Row).n;
    const links = (db.prepare('SELECT COUNT(*) AS n FROM parent_child').get() as Row).n;
    const branchHeads = (db.prepare('SELECT COUNT(*) AS n FROM branch WHERE root_person_id IS NOT NULL').get() as Row).n;

    runMigrations();
    runMigrations();

    assert.equal(db.pragma('user_version', { simple: true }), 2);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM couple').get() as Row).n, before);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM parent_child').get() as Row).n, links);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM branch WHERE root_person_id IS NOT NULL').get() as Row).n,
      branchHeads,
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
