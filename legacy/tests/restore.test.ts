import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-restore-'));

const { db, newId, now } = await import('../server/db');
const { attachRelation } = await import('../server/relations');
const { forceBackup } = await import('../server/backup');
const { archiveCounts, listArchives, restore } = await import('../server/restore');
const { DATA_DIR, DB_PATH } = await import('../server/config');

const BACKUP_DIR = path.join(DATA_DIR, 'sauvegardes');
const CRAFT_DIR = path.join(DATA_DIR, 'exports');

/**
 * Un port que rien n'écoute : la vérification « l'application est-elle ouverte ? » doit laisser
 * passer. Sans ce port explicite, le test toucherait le 4321 de l'application de la maison.
 */
async function quietPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function busyPort(): Promise<{ port: number; stop: () => Promise<void> }> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, stop: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function readBase(file: string): { persons: number; has: (id: string) => boolean } {
  const base = new Database(file, { readonly: true });
  try {
    const ids = new Set(
      (base.prepare('SELECT id FROM person').all() as { id: string }[]).map((row) => row.id),
    );
    return { persons: ids.size, has: (id: string) => ids.has(id) };
  } finally {
    base.close();
  }
}

async function expectRefusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return assert.fail('la restauration aurait dû être refusée');
}

/** Archive fabriquée à partir d'une vraie, avec ce que l'application n'écrit pas elle-même. */
function craft(name: string, mutate: (zip: AdmZip) => void, source?: string): string {
  const zip = source ? new AdmZip(source) : new AdmZip();
  mutate(zip);
  const target = path.join(CRAFT_DIR, name);
  fs.mkdirSync(CRAFT_DIR, { recursive: true });
  zip.writeZip(target);
  return target;
}

describe('recharger une archive à la place de la base en place', () => {
  let alice: string;
  let chloe: string;
  let celine: string;
  let archive = '';

  before(async () => {
    alice = addPerson('Alice');
    const bruno = addPerson('Bruno');
    chloe = addPerson('Chloé');
    attachRelation(chloe, { type: 'child', ofPersonId: alice, otherParentId: bruno });

    archive = (await forceBackup('manuel')).name;
    celine = addPerson('Céline'); // saisi après l'archive : la restauration doit le faire disparaître
  });

  it('compte ce qu’une archive contient sans rien installer', () => {
    const counts = archiveCounts(path.join(BACKUP_DIR, archive));

    assert.deepEqual(counts, { persons: 3, couples: 1, events: 0, media: 0 });
    assert.equal(readBase(DB_PATH).persons, 4, 'compter ne doit rien changer à la base en place');
  });

  it('refuse une archive sans base, sans toucher à ce qui marche', async () => {
    const empty = craft('sans-base.zip', (zip) => zip.addFile('LISEZMOI.txt', Buffer.from('rien', 'utf8')));

    const message = await expectRefusal(
      restore({ archive: empty, dataDir: DATA_DIR, port: await quietPort() }),
    );

    assert.match(message, /ne contient pas de base/);
    assert.equal(readBase(DB_PATH).persons, 4);
    assert.equal(safetyCopies().length, 0, 'refuser avant de copier ne doit rien écrire');
  });

  it('refuse une base abîmée dans l’archive et remet la précédente en place', async () => {
    const broken = craft('base-abimee.zip', (zip) =>
      zip.addFile('famille.db', Buffer.from('ceci n’est pas du SQLite', 'utf8')),
    );

    const message = await expectRefusal(
      restore({ archive: broken, dataDir: DATA_DIR, port: await quietPort() }),
    );

    assert.match(message, /archive refusée/);
    assert.equal(readBase(DB_PATH).persons, 4, 'une archive refusée laisse l’arbre tel quel');
    assert.deepEqual(leftovers(), [], 'le fichier temporaire de contrôle doit être reparté');
  });

  it('refuse de remplacer la base pendant que l’application est ouverte', async () => {
    const listener = await busyPort();
    try {
      const message = await expectRefusal(
        restore({ archive: path.join(BACKUP_DIR, archive), dataDir: DATA_DIR, port: listener.port }),
      );
      assert.match(message, /ouverte sur le port/);
      assert.equal(safetyCopies().length, 0);
    } finally {
      await listener.stop();
    }
  });

  it('ramène ce qui a été saisi depuis l’archive et garde une copie du chemin inverse', async () => {
    const escaped = `arbre-restore-${Date.now()}.txt`;
    const source = path.join(BACKUP_DIR, archive);
    const withMedias = craft(
      'avec-reglages-et-medias.zip',
      (zip) => {
        zip.addFile('config.json', Buffer.from(JSON.stringify({ rootPersonId: chloe }), 'utf8'));
        zip.addFile('medias/photos/2026/loin.jpg', Buffer.from('une photo de l’archive', 'utf8'));
        zip.addFile('medias/en-place.txt', Buffer.from('rien de bon', 'utf8'));
        // Le nom est tordu après coup : adm-zip nettoie ceux qu'on lui donne à l'ajout, et une
        // archive venue d'un autre programme, elle, peut porter « ../../ » sans gêner personne.
        const hostile = zip.getEntry('medias/en-place.txt');
        assert.ok(hostile);
        hostile.entryName = `medias/../../${escaped}`;
      },
      source,
    );

    // La vraie marche : rien ne doit tenir la base ouverte pendant l'échange des fichiers.
    db.close();
    const logs: string[] = [];

    const summary = await restore({
      archive: withMedias,
      dataDir: DATA_DIR,
      port: await quietPort(),
      log: (line) => logs.push(line),
    });

    assert.equal(summary.previous?.persons, 4, 'la base écrasée était comptée');
    assert.equal(summary.restored.persons, 3);
    assert.equal(summary.rootPersonId, chloe);
    assert.equal(summary.rootWasRestored, true);
    assert.equal(summary.mediasRestored, 1);

    const base = readBase(DB_PATH);
    assert.equal(base.has(celine), false, 'la personne saisie après l’archive doit avoir disparu');
    assert.equal(base.has(chloe), true, 'les personnes de l’archive doivent être revenues');
    assert.ok(
      fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8').includes(chloe),
      'la personne de référence de l’archive reprend la place',
    );
    assert.equal(fs.existsSync(path.join(DATA_DIR, 'medias', 'photos', '2026', 'loin.jpg')), true);
    assert.equal(
      fs.existsSync(path.join(DATA_DIR, '..', escaped)),
      false,
      'une entrée d’archive ne doit pas écrire hors du dossier des médias',
    );
    assert.match(logs.join('\n'), /copie de sûreté/);
    assert.match(logs.join('\n'), /sort du dossier/, 'un média écarté doit être dit, pas passé sous silence');
    assert.deepEqual(leftovers(), [], 'le fichier de contrôle ne laisse rien derrière lui, ni journaux');

    const copies = safetyCopies();
    assert.equal(copies.length, 1);
    assert.equal(archiveCounts(copies[0]).persons, 4, 'la copie de sûreté tient ce qui était en place');

    // Le chemin inverse : cette archive de sûreté se restaure comme n'importe quelle autre.
    const back = await restore({
      archive: copies[0],
      dataDir: DATA_DIR,
      port: await quietPort(),
      log: (line) => logs.push(line),
    });
    assert.equal(back.restored.persons, 4);
    assert.equal(readBase(DB_PATH).has(celine), true, 'on peut revenir en arrière');
    assert.equal(safetyCopies().length, 2, 'deux restaurations dans la même minute gardent leurs deux copies');
    assert.notEqual(safetyCopies()[0], safetyCopies()[1]);
  });

  it('dit que la personne de référence est à choisir quand l’archive pointe une personne absente', async () => {
    const ghost = craft(
      'reference-inconnue.zip',
      (zip) => zip.addFile('config.json', Buffer.from(JSON.stringify({ rootPersonId: 'personne-effacee' }), 'utf8')),
      path.join(BACKUP_DIR, archive),
    );
    const logs: string[] = [];

    const summary = await restore({
      archive: ghost,
      dataDir: DATA_DIR,
      port: await quietPort(),
      log: (line) => logs.push(line),
    });

    assert.equal(summary.rootPersonId, null);
    assert.equal(summary.rootWasRestored, false);
    assert.match(logs.join('\n'), /elle est à choisir dans Réglages/);
    assert.equal(readBase(DB_PATH).persons, 3, 'la base est restaurée même si sa personne de référence est introuvable');
  });

  it('donne les archives du dossier, la plus récente en tête', () => {
    const archives = listArchives(DATA_DIR);

    assert.ok(archives.length >= 4, 'les archives écrites pendant ces tests sont toutes listées');
    const dates = archives.map((entry) => Date.parse(entry.createdAt));
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a), 'du plus récent au plus ancien');

    const names = archives.map((entry) => entry.name);
    assert.ok(names.includes(archive));
    for (const copy of safetyCopies()) {
      assert.ok(names.includes(path.basename(copy)), 'une copie de sûreté se retrouve dans la liste');
    }
  });
});

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

function safetyCopies(): string[] {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((file) => file.includes('avant-restauration'))
    .map((file) => path.join(BACKUP_DIR, file))
    .sort();
}

function leftovers(): string[] {
  return fs.readdirSync(path.join(DATA_DIR, 'data')).filter((file) => file.includes('.restauration-'));
}

after(() => {
  if (db.open) db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
