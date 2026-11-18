import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-test-'));

const { db, newId, now } = await import('../server/db');
const { attachRelation, RelationError } = await import('../server/relations');

type Row = Record<string, any>;

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

function link(parentId: string, childId: string): Row | undefined {
  return db
    .prepare('SELECT * FROM parent_child WHERE parent_id = ? AND child_id = ?')
    .get(parentId, childId) as Row | undefined;
}

function union(a: string, b: string): Row | undefined {
  return db
    .prepare(
      `SELECT * FROM couple
        WHERE (partner_a = ? AND partner_b = ?) OR (partner_a = ? AND partner_b = ?)`,
    )
    .get(a, b, b, a) as Row | undefined;
}

function count(table: 'couple' | 'parent_child'): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Row).n as number;
}

function expectRefusal(action: () => void): RelationError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof RelationError, `attendu un refus, reçu : ${String(error)}`);
    return error;
  }
  return assert.fail('la liaison aurait dû être refusée');
}

describe('rattacher des personnes déjà connues', () => {
  let jean: string;
  let marie: string;
  let nina: string;
  let sacha: string;

  before(() => {
    jean = addPerson('Jean');
    marie = addPerson('Marie');
    nina = addPerson('Nina');
  });

  it('attache un enfant sans inventer d’union', () => {
    attachRelation(nina, { type: 'child', ofPersonId: jean });

    const row = link(jean, nina);
    assert.ok(row, 'Jean doit apparaître comme parent de Nina');
    assert.equal(row.couple_id, null, 'un parent seul ne doit créer aucune union');
    assert.equal(count('couple'), 0);
  });

  it('crée l’union quand le second parent est explicitement déclaré', () => {
    attachRelation(nina, { type: 'child', ofPersonId: marie, otherParentId: jean });

    const couple = union(jean, marie);
    assert.ok(couple, 'l’union déclarée doit exister');
    assert.equal(link(jean, nina)?.couple_id, couple.id);
    assert.equal(link(marie, nina)?.couple_id, couple.id);
    assert.equal(count('couple'), 1);
  });

  it('laisse un enfant hors union quand on ne déclare que Jean', () => {
    sacha = addPerson('Sacha');
    attachRelation(sacha, { type: 'child', ofPersonId: jean });

    assert.equal(
      link(jean, sacha)?.couple_id,
      null,
      'Jean a pourtant une union : elle ne doit pas être reprise sans qu’on la nomme',
    );
    assert.equal(count('couple'), 1);
  });

  it('rend l’union déclarée aux enfants que la base connaît déjà des deux', () => {
    const elsa = addPerson('Elsa');
    attachRelation(elsa, { type: 'child', ofPersonId: jean });
    attachRelation(elsa, { type: 'child', ofPersonId: marie });
    assert.equal(link(jean, elsa)?.couple_id, null, 'avant de déclarer l’union');

    attachRelation(jean, { type: 'partner', ofPersonId: marie });

    const couple = union(jean, marie);
    assert.ok(couple);
    assert.equal(link(jean, elsa)?.couple_id, couple.id);
    assert.equal(link(marie, elsa)?.couple_id, couple.id);
    assert.equal(
      link(jean, sacha)?.couple_id,
      null,
      'un enfant que d’un seul des deux ne doit pas être rangé dans cette union',
    );
  });

  it('est répétible sans écrire de doublon', () => {
    const linkId = link(jean, nina)?.id;
    const couples = count('couple');
    attachRelation(nina, { type: 'child', ofPersonId: jean });

    assert.equal(link(jean, nina)?.id, linkId, 'le lien déjà présent doit rester le même');
    assert.equal(count('couple'), couples);
  });

  it('refuse un troisième parent sans rien écrire', () => {
    const gaston = addPerson('Gaston');
    const parents = count('parent_child');
    const refusal = expectRefusal(() => attachRelation(nina, { type: 'child', ofPersonId: gaston }));

    assert.equal(refusal.status, 409);
    assert.equal(link(gaston, nina), undefined);
    assert.equal(count('parent_child'), parents);
  });

  it('refuse une boucle de parenté', () => {
    const luc = addPerson('Luc');
    attachRelation(luc, { type: 'child', ofPersonId: nina });
    const refusal = expectRefusal(() => attachRelation(nina, { type: 'child', ofPersonId: luc }));

    assert.match(refusal.message, /boucle/);
    assert.equal(link(luc, nina), undefined);
  });

  it('relie deux conjoints et ne touche pas à la parenté', () => {
    const paul = addPerson('Paul');
    const lea = addPerson('Lea');
    const parents = count('parent_child');
    const couples = count('couple');

    attachRelation(lea, { type: 'partner', ofPersonId: paul });
    attachRelation(lea, { type: 'partner', ofPersonId: paul });

    assert.ok(union(paul, lea), 'l’union doit exister');
    assert.equal(count('couple'), couples + 1, 'une union déclarée deux fois ne doit pas dédoubler');
    assert.equal(count('parent_child'), parents);
  });

  it('refuse une personne qui n’est pas dans la base', () => {
    const refusal = expectRefusal(() =>
      attachRelation(nina, { type: 'child', ofPersonId: 'inconnue' }),
    );
    assert.equal(refusal.status, 404);
  });
});

after(() => {
  db.close();
  fs.rmSync(process.env.FAMILY_DATA_DIR as string, { recursive: true, force: true });
});
