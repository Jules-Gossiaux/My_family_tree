import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-lieux-'));

const { db, newId, now } = await import('../server/db');
const { PlaceError, deletePlace, findOrCreatePlace, listPlaces, renamePlace } = await import(
  '../server/places'
);
const { LifeEventError, createEvent, eventsOfPerson, updateEvent } = await import(
  '../server/life-events'
);

type Row = Record<string, any>;

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

function addMedia(placeId: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO media (id, kind, original_path, created_at, place_id)
     VALUES (?, 'photo', 'medias/photos/1900/x.jpg', ?, ?)`,
  ).run(id, now(), placeId);
  return id;
}

function placeRows(): Row[] {
  return db.prepare('SELECT * FROM place').all() as Row[];
}

function expectRefusal<T extends Error>(action: () => unknown, kind: new (...args: any[]) => T): T {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof kind, `attendu un refus de ${kind.name}, reçu : ${String(error)}`);
    return error;
  }
  return assert.fail('le lieu aurait dû être refusé');
}

describe('un lieu se nomme, il ne se recopie pas', () => {
  it('trouve la ligne plutôt que d’en écrire une seconde à la même enseigne', () => {
    const first = findOrCreatePlace('Roubaix');
    assert.equal(first.created, true);

    const again = findOrCreatePlace('  roubaix  ');
    assert.equal(again.created, false, 'les espaces et les majuscules ne font pas un nouveau lieu');
    assert.equal(again.place.id, first.place.id);
    assert.equal(again.place.name, 'Roubaix', 'la première orthographe écrite garde la main');

    const third = findOrCreatePlace('ROUBAIX');
    assert.equal(third.place.id, first.place.id);
    assert.equal(placeRows().length, 1);
  });

  it('dit qu’un lieu se nomme', () => {
    const refus = expectRefusal(() => findOrCreatePlace('   '), PlaceError);
    assert.equal(refus.status, 400);
    assert.match(refus.message, /une ville, un hameau, un pays/);
    assert.equal(placeRows().length, 1);
  });

  it('range la liste par nom et compte ce qui s’y est passé', () => {
    const lille = findOrCreatePlace('Lille').place;
    addMedia(lille.id);
    addMedia(lille.id);

    const names = listPlaces().map((place) => `${place.name}:${place.eventCount}:${place.mediaCount}`);
    assert.deepEqual(names, ['Lille:0:2', 'Roubaix:0:0'], 'la liste se lit comme un annuaire');
  });
});

describe('renommer un lieu', () => {
  let roubaix: string;
  let anna: string;

  before(() => {
    roubaix = placeRows().find((row) => row.name === 'Roubaix')!.id as string;
    anna = addPerson('Anna');
    createEvent({ personId: anna, type: 'naissance', dateText: '1901', placeId: roubaix });
  });

  it('déplace le nom, pas les lignes qui pointent déjà dessus', () => {
    const renome = renamePlace(roubaix, 'Roubaix (Nord)');

    assert.equal(renome.name, 'Roubaix (Nord)');
    assert.equal(renome.id, roubaix, 'le lieu reste le même, seul le nom bouge');
    assert.equal(eventsOfPerson(anna)[0].place, 'Roubaix (Nord)');
  });

  it('refuse un nom qu’un autre lieu porte déjà et dit lequel', () => {
    const refus = expectRefusal(() => renamePlace(roubaix, ' LILLE '), PlaceError);
    assert.equal(refus.status, 409);
    assert.match(refus.message, /Lille/);
    assert.equal(renamePlace(roubaix, 'Roubaix (Nord)').name, 'Roubaix (Nord)', 'le refus n’a rien changé');
  });

  it('ne connaît pas un lieu qui n’existe pas et ne nomme rien du tout', () => {
    assert.equal(expectRefusal(() => renamePlace('lieu-inconnu', 'Gand'), PlaceError).status, 404);
    assert.equal(expectRefusal(() => renamePlace(roubaix, '  '), PlaceError).status, 400);
  });
});

describe('effacer un lieu', () => {
  let gand: string;
  let personId: string;

  before(() => {
    gand = findOrCreatePlace('Gand').place.id;
    personId = addPerson('Gérard');
    createEvent({ personId, type: 'residence', dateText: '1948', placeId: gand });
    addMedia(gand);
  });

  it('rend les faits à un lieu inconnu sans rien leur ôter d’autre', () => {
    const rendu = deletePlace(gand);

    assert.deepEqual(rendu, { events: 1, media: 1 });
    const reste = eventsOfPerson(personId)[0];
    assert.equal(reste.place, null, 'le fait ne porte plus de lieu');
    assert.equal(reste.date?.text, '1948', 'il garde sa date et le reste de sa vie');
    assert.equal(placeRows().some((row) => row.id === gand), false);
  });

  it('ne connaît pas un lieu qui n’existe pas', () => {
    assert.equal(expectRefusal(() => deletePlace('lieu-inconnu'), PlaceError).status, 404);
  });
});

describe('un fait écrit son lieu', () => {
  let carla: string;

  before(() => {
    carla = addPerson('Carla');
  });

  it('trouve ou crée la ligne d’après le nom tapé', () => {
    const avant = placeRows().length;
    const event = createEvent({ personId: carla, type: 'naissance', dateText: '1902', placeName: '  courneuf  ' });

    assert.equal(event.place, 'courneuf');
    assert.equal(placeRows().length, avant + 1, 'le nom tapé devient une ligne, en ses propres lettres');

    const second = createEvent({ personId: carla, type: 'residence', dateText: '1930', placeName: 'Courneuf' });
    assert.equal(second.placeId, event.placeId, 'une seconde fois, c’est la même ligne');
    assert.equal(placeRows().length, avant + 1, 'et toujours pas de doublon');

    const compte = listPlaces().find((place) => place.id === event.placeId);
    assert.equal(compte?.eventCount, 2, 'la liste compte les faits qui s’y rattachent');
  });

  it('ne demande pas le nom et l’identifiant du même lieu', () => {
    const lieu = placeRows().find((row) => row.name === 'courneuf')!;
    const refus = expectRefusal(
      () => createEvent({ personId: carla, type: 'profession', placeId: lieu.id as string, placeName: 'Courneuf' }),
      LifeEventError,
    );
    assert.equal(refus.status, 400);
    assert.match(refus.message, /pas les deux/);
  });

  it('ne laisse pas un lieu orphelin quand le fait est refusé', () => {
    const avant = placeRows().length;
    const refus = expectRefusal(
      () => createEvent({ personId: carla, type: 'naissance', dateText: '1903', placeName: 'Bruges' }),
      LifeEventError,
    );

    assert.equal(refus.status, 409);
    assert.equal(placeRows().length, avant, 'un refus ne peuple pas la liste des lieux');
  });

  it('rend le lieu quand le champ se vide, et le change quand il est nommé', () => {
    const naissance = eventsOfPerson(carla).find((event) => event.type === 'naissance')!;

    const vide = updateEvent(naissance.id, { placeName: '' });
    assert.equal(vide.place, null);

    const change = updateEvent(naissance.id, { placeName: 'bruges' });
    assert.equal(change.place, 'bruges');
    assert.equal(
      placeRows().filter((row) => /^bruges$/i.test(row.name as string)).length,
      1,
      'le nom tapé une fois ne se recopie pas deux fois',
    );
  });

  it('refuse un identifiant de lieu qui n’existe plus', () => {
    const naissance = eventsOfPerson(carla).find((event) => event.type === 'naissance')!;
    const avant = placeRows().length;

    assert.equal(expectRefusal(() => updateEvent(naissance.id, { placeId: 'lieu-efface' }), LifeEventError).status, 404);
    assert.equal(eventsOfPerson(naissance.personId!)[0].place, 'bruges', 'le refus laisse le lieu en place');
    assert.equal(placeRows().length, avant);
  });
});
