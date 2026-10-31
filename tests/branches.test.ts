import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-branches-'));

const { db, newId, now } = await import('../server/db');
const branches = await import('../server/branches');
const { BranchError } = branches;

type Row = Record<string, any>;

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

function link(parentId: string, childId: string): void {
  db.prepare('INSERT INTO parent_child (id, parent_id, child_id) VALUES (?, ?, ?)').run(
    newId(),
    parentId,
    childId,
  );
}

function branchOf(personId: string): string | null {
  return (db.prepare('SELECT branch_id FROM person WHERE id = ?').get(personId) as Row).branch_id as
    | string
    | null;
}

function expectRefusal(action: () => unknown): BranchError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof BranchError, `attendu un refus, reçu : ${String(error)}`);
    return error;
  }
  return assert.fail('l’écriture aurait dû être refusée');
}

describe('rangées par branche', () => {
  let louise: string;
  let pierre: string;
  let anna: string;
  let bo: string;
  let cara: string;

  before(() => {
    // louise -> pierre -> anna, et bo -> cara -> bo : une boucle volontaire pour la descendre.
    louise = addPerson('Louise');
    pierre = addPerson('Pierre');
    anna = addPerson('Anna');
    bo = addPerson('Bo');
    cara = addPerson('Cara');
    link(louise, pierre);
    link(pierre, anna);
    link(bo, cara);
    link(cara, bo);
  });

  it('range la descendance depuis la racine donnée', () => {
    const branch = branches.createBranch({ name: 'Descendance de Louise', rootPersonId: louise });

    assert.equal(branch.personCount, 3, 'Louise, Pierre et Anna doivent être rangées');
    assert.equal(branch.rootPersonId, louise);
    assert.equal(branchOf(louise), branch.id);
    assert.equal(branchOf(pierre), branch.id);
    assert.equal(branchOf(anna), branch.id);
    assert.equal(branchOf(bo), null, 'une autre ligne reste hors classe');
  });

  it('ne tourne pas en rond dans une boucle de famille', () => {
    const branch = branches.createBranch({ name: 'Ligne de Bo', rootPersonId: bo });

    assert.equal(branch.personCount, 2, 'Bo et Cara, une fois chacune');
    assert.equal(branchOf(bo), branch.id);
    assert.equal(branchOf(cara), branch.id);
  });

  it('donne à chaque branche neuve une teinte que personne ne porte', () => {
    const a = branches.createBranch({ name: 'Teinte A' });
    const b = branches.createBranch({ name: 'Teinte B' });
    const c = branches.createBranch({ name: 'Teinte C', rootPersonId: null });

    assert.notEqual(a.color, b.color);
    assert.notEqual(a.color, c.color);
    assert.notEqual(b.color, c.color);
    assert.match(a.color, /^#[0-9a-f]{6}$/);
  });

  it('accepte une couleur choisie et rend la teinte telle qu’elle a été écrite', () => {
    const branch = branches.createBranch({ name: 'Ligne choisie', color: '#DDEEFF' });

    assert.equal(branch.color, '#ddeeff');
  });

  it('refuse un nom vide, un nom déjà pris et une couleur qui n’est pas un hexadécimal', () => {
    const avant = (db.prepare('SELECT COUNT(*) AS n FROM branch').get() as Row).n;

    assert.equal(expectRefusal(() => branches.createBranch({ name: '   ' })).status, 400);
    assert.equal(expectRefusal(() => branches.createBranch({ name: 'ligne de bo' })).status, 409);

    const refusal = expectRefusal(() => branches.createBranch({ name: 'Couleur fausse', color: 'rouge' }));
    assert.equal(refusal.status, 400);
    assert.match(refusal.message, /hexadécimal/);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM branch').get() as Row).n,
      avant,
      'un refus ne laisse pas de branche à moitié écrite',
    );
  });

  it('refuse une teinte qu’une autre branche porte déjà', () => {
    const prise = branches.listBranches()[0];

    const r = expectRefusal(() => branches.createBranch({ name: 'Même teinte', color: prise.color.toUpperCase() }));
    assert.equal(r.status, 409);
    assert.match(r.message, new RegExp(prise.name));
    assert.equal(
      expectRefusal(() => branches.updateBranch(branches.listBranches()[1].id, { color: prise.color })).status,
      409,
    );
    assert.equal(
      branches.updateBranch(prise.id, { color: prise.color }).color,
      prise.color.toLowerCase(),
      'se garder la même teinte à soi-même n’est pas un changement',
    );
  });

  it('ne vole pas une personne déjà rangée ailleurs', () => {
    const caroline = addPerson('Caroline');
    const daniel = addPerson('Daniel');
    link(anna, caroline);
    link(caroline, daniel);

    const vol = branches.createBranch({ name: 'Ligne de Caroline', rootPersonId: caroline });

    assert.equal(vol.personCount, 2, 'seules les deux non classées rejoignent la nouvelle branche');
    assert.equal(branchOf(daniel), vol.id);
    assert.equal(branchOf(caroline), vol.id);

    const renaissante = branches.assignDescendants(vol.id, anna);
    assert.equal(renaissante, 0, 'remonter la ligne ne déplace personne de déjà rangé');
    assert.equal(branchOf(anna), (db.prepare('SELECT id FROM branch WHERE name = ?').get('Descendance de Louise') as Row).id);
  });

  it('range et dérange une personne à la main', () => {
    const horsClasse = addPerson('Hors classe');
    const branche = branches.createBranch({ name: 'Ligne à la main' });

    branches.setPersonBranch(horsClasse, branche.id);
    assert.equal(branchOf(horsClasse), branche.id);
    assert.equal(branches.listBranches().find((b) => b.id === branche.id)?.personCount, 1);

    branches.setPersonBranch(horsClasse, null);
    assert.equal(branchOf(horsClasse), null, 'rendre sa liberté à une personne se fait');
  });

  it('renomme, recolorise et change de tête sans déplacer les personnes', () => {
    const branche = db.prepare('SELECT id FROM branch WHERE name = ?').get('Ligne à la main') as Row;
    const rangee = addPerson('Rangée');
    branches.setPersonBranch(rangee, branche.id);

    const avant = branchOf(rangee);
    const apr = branches.updateBranch(branche.id, { name: 'Ligne renommée', color: '#123456', rootPersonId: pierre });
    const apres = branchOf(rangee);

    assert.equal(avant, branche.id);
    assert.equal(apres, branche.id, 'changer la tête d’une branche ne rerange personne');
    assert.equal(apr.name, 'Ligne renommée');
    assert.equal(apr.color, '#123456');
    assert.equal(apr.rootPersonId, pierre);
    assert.equal(branches.updateBranch(branche.id, { rootPersonId: null }).rootPersonId, null);
  });

  it('rend les personnes quand la branche disparaît', () => {
    const elise = addPerson('Elise');
    const branche = branches.createBranch({ name: 'Ligne supprimée' });
    branches.setPersonBranch(elise, branche.id);
    assert.equal(branchOf(elise), branche.id);

    branches.deleteBranch(branche.id);

    assert.equal(branchOf(elise), null, 'effacer une branche rend ses gens au hors-classe');
    assert.ok(
      db.prepare('SELECT id FROM person WHERE id = ?').get(elise),
      'les personnes survivent à leur branche',
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  it('refuse d’écrire sur une branche ou une personne qui n’existe plus', () => {
    assert.equal(expectRefusal(() => branches.updateBranch('inexistante', { name: 'Rien' })).status, 404);
    assert.equal(expectRefusal(() => branches.deleteBranch('inexistante')).status, 404);
    assert.equal(expectRefusal(() => branches.assignDescendants('inexistante', louise)).status, 404);
    assert.equal(expectRefusal(() => branches.createBranch({ name: 'Sans personne', rootPersonId: 'x' })).status, 404);
    assert.equal(expectRefusal(() => branches.setPersonBranch('inexistante', null)).status, 404);
  });

  it('laisse la branche debout quand sa tête est effacée', () => {
    const branche = branches.createBranch({ name: 'Ligne sans tête', rootPersonId: bo });

    db.prepare('DELETE FROM person WHERE id = ?').run(bo);

    const reste = branches.listBranches().find((b) => b.id === branche.id);
    assert.ok(reste, 'la branche survit à sa tête de ligne');
    assert.equal(reste.rootPersonId, null, 'et se cherche une autre tête');
    assert.equal(expectRefusal(() => branches.assignDescendants(branche.id, 'personne effacée')).status, 404);
  });
});

after(() => {
  db.close();
  fs.rmSync(process.env.FAMILY_DATA_DIR as string, { recursive: true, force: true });
});
