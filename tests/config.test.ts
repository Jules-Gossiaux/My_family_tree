import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-reglages-'));

const { db, newId, now } = await import('../server/db');
const { DATA_DIR } = await import('../server/config');
const { listNotices } = await import('../server/notices');
const {
  ConfigError,
  patchConfig,
  readConfig,
  repairConfigAfterDelete,
} = await import('../server/app-config');

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

function expectRefusal(action: () => void): ConfigError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof ConfigError, `attendu un refus, reçu : ${String(error)}`);
    return error;
  }
  return assert.fail('le réglage aurait dû être refusé');
}

describe('les deux personnes de référence', () => {
  let anna: string;
  let bob: string;

  it('ne rien réglé du tout répond vide, pas une erreur', () => {
    assert.equal(fs.existsSync(CONFIG_PATH), false, 'aucun fichier de réglages avant la demande');
    assert.deepEqual(readConfig(), { rootPersonId: null, mePersonId: null });
  });

  it('règle la personne de référence et « moi » séparément', () => {
    anna = addPerson('Anna');
    bob = addPerson('Bob');

    patchConfig({ mePersonId: bob });
    assert.deepEqual(readConfig(), { rootPersonId: null, mePersonId: bob });

    patchConfig({ rootPersonId: anna });
    assert.deepEqual(readConfig(), { rootPersonId: anna, mePersonId: bob });
  });

  it('laisse en place ce que la demande ne nomme pas', () => {
    patchConfig({});
    assert.deepEqual(readConfig(), { rootPersonId: anna, mePersonId: bob });
  });

  it('retire « moi » sans toucher à la personne de référence', () => {
    patchConfig({ mePersonId: null });
    assert.deepEqual(readConfig(), { rootPersonId: anna, mePersonId: null });
    patchConfig({ mePersonId: bob });
  });

  it('refuse une personne qui n’existe plus et nomme le réglage en cause', () => {
    const refus = expectRefusal(() => patchConfig({ mePersonId: 'personne-effacee' }));
    assert.equal(refus.status, 400);
    assert.match(refus.message, /personne « moi »/);

    const refusSouche = expectRefusal(() => patchConfig({ rootPersonId: 'personne-effacee' }));
    assert.equal(refusSouche.status, 400);
    assert.match(refusSouche.message, /personne de référence/);

    assert.deepEqual(readConfig(), { rootPersonId: anna, mePersonId: bob }, 'un refus ne change rien');
  });

  it('ne pose pas la personne de référence quand « moi » est refusé', () => {
    const refus = expectRefusal(() => patchConfig({ rootPersonId: bob, mePersonId: 'personne-effacee' }));
    assert.equal(refus.status, 400);
    assert.deepEqual(readConfig(), { rootPersonId: anna, mePersonId: bob });
  });
});

describe('effacer une personne de référence', () => {
  let carla: string;
  let dieter: string;
  let elsa: string;

  it('éteint « moi » et laisse la personne de référence où elle est', () => {
    carla = addPerson('Carla');
    dieter = addPerson('Dieter');
    elsa = addPerson('Elsa');
    patchConfig({ rootPersonId: carla, mePersonId: dieter });

    db.prepare('DELETE FROM person WHERE id = ?').run(dieter);
    repairConfigAfterDelete(dieter);

    assert.deepEqual(readConfig(), { rootPersonId: carla, mePersonId: null });
  });

  it('fait repartir la personne de référence d’une personne qui existe encore', () => {
    db.prepare('DELETE FROM person WHERE id = ?').run(carla);
    repairConfigAfterDelete(carla);

    const config = readConfig();
    assert.notEqual(config.rootPersonId, carla, 'la personne de référence ne peut rester pendue sur une id sans visage');
    assert.ok(db.prepare('SELECT id FROM person WHERE id = ?').get(config.rootPersonId), 'la nouvelle personne de référence existe');
    assert.equal(config.mePersonId, null, '« moi » était déjà vide : cet effacement n’y change rien');
  });

  it('ne réécrit rien quand la personne effacée n’était personne', () => {
    const before = fs.readFileSync(CONFIG_PATH, 'utf8');
    const zephyr = addPerson('Zéphyr');
    db.prepare('DELETE FROM person WHERE id = ?').run(zephyr);
    repairConfigAfterDelete(zephyr);

    assert.equal(fs.readFileSync(CONFIG_PATH, 'utf8'), before);
  });

  it('laisse les deux réglages vides quand le dernier visage part', () => {
    const greta = addPerson('Greta');
    patchConfig({ rootPersonId: elsa, mePersonId: greta });
    db.prepare('DELETE FROM person WHERE id NOT IN (?, ?)').run(elsa, greta);

    // Comme la route le fait : une personne à la fois, et le réglage suit.
    for (const id of [elsa, greta]) {
      db.prepare('DELETE FROM person WHERE id = ?').run(id);
      repairConfigAfterDelete(id);
    }

    assert.deepEqual(readConfig(), { rootPersonId: null, mePersonId: null });
  });
});

describe('un fichier de réglages abîmé', () => {
  it('se dit à l’écran au lieu d’inventer un réglage', () => {
    const before = fs.readFileSync(CONFIG_PATH, 'utf8');
    fs.writeFileSync(CONFIG_PATH, '{ ce n’est pas du JSON', 'utf8');

    assert.deepEqual(readConfig(), { rootPersonId: null, mePersonId: null });
    assert.match(
      listNotices().join('\n'),
      /fichier de réglages est abîmé/,
      'la panne est annoncée, pas masquée par un vide',
    );
    assert.equal(fs.readFileSync(CONFIG_PATH, 'utf8'), '{ ce n’est pas du JSON', 'le fichier reste sur le disque');

    fs.writeFileSync(CONFIG_PATH, before, 'utf8');
  });
});
