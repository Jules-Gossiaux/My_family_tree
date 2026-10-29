import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-restore-cli-'));

const { db, newId, now } = await import('../server/db');
const { forceBackup } = await import('../server/backup');
const { archiveCounts } = await import('../server/restore');
const { DATA_DIR, DB_PATH } = await import('../server/config');

const SCRIPT = path.resolve('server', 'restore.ts');

/** Le script tel que le double-clic le lance : un processus, ce que l'on tape, ce qu'il répond. */
function run(args: string[], typed?: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
      // Un port précis, qui n'appartient qu'à ce test : le script demande si l'application est
      // ouverte avant de toucher à la base, et ce n'est jamais celle de la maison qu'il faut sonder.
      env: { ...process.env, FAMILY_DATA_DIR: DATA_DIR, PORT: '4677' },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    if (typed !== undefined) child.stdin.end(typed);
    child.on('close', (code) => resolve({ code, out }));
  });
}

function persons(file: string): number {
  const base = new Database(file, { readonly: true });
  try {
    return (base.prepare('SELECT COUNT(*) AS n FROM person').get() as { n: number }).n;
  } finally {
    base.close();
  }
}

describe('le script de restauration tel qu’on le tape', () => {
  let archive = '';

  before(async () => {
    const stored = newId();
    db.prepare(
      `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
       VALUES (?, 'Suzette', 'Test', 'F', 1, ?, ?)`,
    ).run(stored, now(), now());

    archive = (await forceBackup('manuel')).name;

    db.prepare(
      `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
       VALUES (?, 'Zélie', 'Test', 'F', 1, ?, ?)`,
    ).run(newId(), now(), now());

    db.close(); // l'application serait fermée : le script refuse de travailler par-dessus une base ouverte
  });

  it('dit son refus en français plutôt qu’en pile d’appels', async () => {
    const result = await run(['--archive', 'famille-1900-01-01-0000-inconnue.zip', '--yes']);

    assert.equal(result.code, 1);
    assert.match(result.out, /archive introuvable/);
    assert.ok(!result.out.includes('restore.ts:'), 'une erreur attendue ne doit pas finir en trace technique');
  });

  it('donne la liste des archives sans rien changer', async () => {
    const result = await run(['--list']);

    assert.equal(result.code, 0);
    assert.match(result.out, /1 archive\(s\)/);
    assert.match(result.out, new RegExp(archive));
    assert.equal(persons(DB_PATH), 2, 'lister ne restaure pas');
  });

  it('ne remplace rien tant que OUI n’a pas été tapé', async () => {
    const result = await run([], '1\nnon\n');

    assert.equal(result.code, 0);
    assert.match(result.out, /Rien n.a été changé/);
    assert.equal(persons(DB_PATH), 2, 'refuser laisse la base telle quelle');
  });

  it('restaure l’archive choisie au numéro', async () => {
    const result = await run([], '1\nOUI\n');

    assert.equal(result.code, 0);
    assert.match(result.out, /Base restaurée/);
    assert.match(result.out, /avant-restauration/);
    assert.equal(persons(DB_PATH), 1, 'la personne saisie après l’archive est repartie');

    const safety = fs.readdirSync(path.join(DATA_DIR, 'sauvegardes')).find((name) => name.includes('avant-restauration'));
    assert.ok(safety, 'une copie de ce qui était en place a été gardée');
    assert.equal(archiveCounts(path.join(DATA_DIR, 'sauvegardes', safety)).persons, 2);
  });
});

after(() => {
  if (db.open) db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
