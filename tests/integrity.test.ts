import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-integrite-'));

const { db, newId, now } = await import('../server/db');
const { attachRelation, pruneEmptyCouples } = await import('../server/relations');

type Row = Record<string, any>;

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

/** Comme la route de suppression : la personne s'en va, le ménage autour se discute. */
function removePerson(id: string): void {
  const run = db.transaction(() => {
    db.prepare('DELETE FROM person WHERE id = ?').run(id);
    pruneEmptyCouples();
  });
  run();
}

function coupleOf(a: string, b: string): Row | undefined {
  return db
    .prepare(
      `SELECT * FROM couple
        WHERE (partner_a = ? AND partner_b = ?) OR (partner_a = ? AND partner_b = ?)`,
    )
    .get(a, b, b, a) as Row | undefined;
}

function coupleById(id: string): Row | undefined {
  return db.prepare('SELECT * FROM couple WHERE id = ?').get(id) as Row | undefined;
}

function link(parentId: string, childId: string): Row | undefined {
  return db
    .prepare('SELECT * FROM parent_child WHERE parent_id = ? AND child_id = ?')
    .get(parentId, childId) as Row | undefined;
}

function addUnionAct(coupleId: string): string {
  const id = newId();
  db.prepare(
    'INSERT INTO event (id, person_id, couple_id, type, created_at) VALUES (?, NULL, ?, ?, ?)',
  ).run(id, coupleId, 'mariage', now());
  return id;
}

function countAct(id: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM event WHERE id = ?').get(id) as Row).n as number;
}

describe('une suppression ne détruit pas plus qu’elle-même', () => {
  it('laisse l’union en place quand un des deux parents disparaît', () => {
    const alice = addPerson('Alice');
    const bruno = addPerson('Bruno');
    const chloe = addPerson('Chloé');
    attachRelation(chloe, { type: 'child', ofPersonId: alice, otherParentId: bruno });

    const couple = coupleOf(alice, bruno);
    assert.ok(couple, 'l’union déclarée doit exister');
    const act = addUnionAct(couple.id);

    removePerson(alice);

    const kept = coupleById(couple.id);
    assert.ok(kept, 'supprimer un des deux membres ne doit pas supprimer l’union');
    assert.equal(kept.partner_a, null);
    assert.equal(kept.partner_b, bruno);
    assert.equal(
      link(bruno, chloe)?.couple_id,
      couple.id,
      'l’enfant doit rester rattaché à l’union dont il est issu',
    );
    assert.equal(countAct(act), 1, 'l’acte de mariage est la trace d’une union, pas d’une personne');
  });

  it('garde un couple sans plus personne tant qu’un acte le réclame', () => {
    const camille = addPerson('Camille');
    const dimitri = addPerson('Dimitri');
    const elise = addPerson('Elise');
    attachRelation(elise, { type: 'child', ofPersonId: camille, otherParentId: dimitri });
    const coupleId = coupleOf(camille, dimitri)?.id as string;
    const act = addUnionAct(coupleId);

    removePerson(camille);
    removePerson(dimitri);

    assert.ok(coupleById(coupleId), 'l’acte de mariage rattache encore ce couple à quelque chose');

    db.prepare('DELETE FROM event WHERE id = ?').run(act);
    pruneEmptyCouples();

    assert.equal(coupleById(coupleId), undefined, 'désormais plus rien ne justifie ce couple');
  });

  it('ne range pas dans une union nouvelle l’enfant rattaché à un seul parent', () => {
    const bruno = addPerson('Gaspard');
    const first = addPerson('Hugo');
    const second = addPerson('Ines');
    attachRelation(first, { type: 'child', ofPersonId: bruno });
    const spouse = addPerson('Karim');
    attachRelation(spouse, { type: 'partner', ofPersonId: bruno });

    attachRelation(second, { type: 'child', ofPersonId: bruno, otherParentId: spouse });

    const couple = coupleOf(bruno, spouse);
    assert.ok(couple);
    assert.equal(link(bruno, second)?.couple_id, couple.id);
    assert.equal(
      link(bruno, first)?.couple_id,
      null,
      'un enfant que de Gaspard ne doit pas être rangé dans cette union',
    );
  });
});

describe('le schéma porte la version des migrations', () => {
  it('est à jour et ne casse plus les couples à la suppression', () => {
    assert.equal(db.pragma('user_version', { simple: true }), 3);

    const keys = db.prepare('PRAGMA foreign_key_list(couple)').all() as Row[];
    for (const column of ['partner_a', 'partner_b']) {
      const key = keys.find((row) => row.from === column);
      assert.ok(key, `une clé étrangère est attendue sur ${column}`);
      assert.equal(
        key.on_delete,
        'SET NULL',
        'une personne supprimée doit laisser son union debout',
      );
    }
  });

  it('crée une base neuve déjà dans la forme que les migrations visent', () => {
    // `schema.sql` et `migrations.ts` portent les mêmes définitions : une base qui sort du
    // premier n'a rien à subir du second.
    const keys = db.prepare('PRAGMA foreign_key_list(branch)').all() as Row[];
    const head = keys.find((row) => row.from === 'root_person_id');
    assert.ok(head, 'la tête de ligne doit être une vraie référence à une personne');
    assert.equal(head.on_delete, 'SET NULL', 'une branche survit à la personne dont elle partait');
  });
});

after(() => {
  db.close();
  fs.rmSync(process.env.FAMILY_DATA_DIR as string, { recursive: true, force: true });
});
