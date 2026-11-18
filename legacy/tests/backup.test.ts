import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-backup-'));

const { backupFile } = await import('../server/backup');

const DATA_DIR = process.env.FAMILY_DATA_DIR as string;
const BACKUP_DIR = path.join(DATA_DIR, 'sauvegardes');

describe('récupérer une archive pour la copier ailleurs', () => {
  before(() => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(path.join(BACKUP_DIR, 'famille-2026-10-29-1643-auto.zip'), 'zip');
    fs.writeFileSync(path.join(BACKUP_DIR, 'note-personnelle.txt'), 'à ne pas livrer');
  });

  it('donne une archive que l’application a elle-même écrite', () => {
    const file = backupFile('famille-2026-10-29-1643-auto.zip');
    assert.ok(file, 'l’archive doit être trouvée');
    assert.equal(file.path, path.join(BACKUP_DIR, 'famille-2026-10-29-1643-auto.zip'));
    assert.equal(file.size, 3);
  });

  it('refuse un nom qui sort du dossier de sauvegardes', () => {
    for (const name of [
      '../config.json',
      '../../medias/photos/paul.jpg',
      'famille-2026-10-29-1643-auto.zip/../../config.json',
      path.join('..', 'sauvegardes', 'famille-2026-10-29-1643-auto.zip'),
    ]) {
      assert.equal(backupFile(name), null, `« ${name} » ne doit rien ouvrir`);
    }
  });

  it('refuse un fichier qui n’est pas une archive', () => {
    assert.equal(backupFile('note-personnelle.txt'), null);
    assert.equal(backupFile(''), null);
    assert.equal(backupFile('famille-2026-10-29-1643-manuelle.zip'), null, 'nom inconnu');
  });

  it('refuse une archive annoncée mais absente du disque', () => {
    assert.equal(backupFile('famille-1999-01-01-1200-auto.zip'), null);
  });
});
