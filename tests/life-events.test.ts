import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-vie-'));

const { db, newId, now } = await import('../server/db');
const {
  LifeEventError,
  createEvent,
  deleteEvent,
  eventsOfCouple,
  eventsOfPerson,
  getEvent,
  setPersonDateEvent,
  updateEvent,
} = await import('../server/life-events');

type Row = Record<string, any>;

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

function addCouple(a: string, b: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO couple (id, partner_a, partner_b, type, status, created_at)
     VALUES (?, ?, ?, 'mariage', 'en_cours', ?)`,
  ).run(id, a, b, now());
  return id;
}

function addPlace(name: string): string {
  const id = newId();
  db.prepare('INSERT INTO place (id, name) VALUES (?, ?)').run(id, name);
  return id;
}

function addSource(reference: string, kind = 'acte'): string {
  const id = newId();
  db.prepare('INSERT INTO source (id, kind, reference, reliability) VALUES (?, ?, ?, ?)').run(
    id,
    kind,
    reference,
    'certain',
  );
  return id;
}

function eventRows(personId: string): Row[] {
  return db.prepare('SELECT * FROM event WHERE person_id = ?').all(personId) as Row[];
}

function expectRefusal(action: () => void): LifeEventError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof LifeEventError, `attendu un refus, reçu : ${String(error)}`);
    return error;
  }
  return assert.fail('l’événement aurait dû être refusé');
}

describe('saisir un fait de la vie', () => {
  let anna: string;

  before(() => {
    anna = addPerson('Anna');
  });

  it('garde le texte de la date à côté de la date analysée', () => {
    const event = createEvent({ personId: anna, type: 'naissance', dateText: 'vers 1912' });

    assert.equal(event.type, 'naissance');
    assert.equal(event.label, 'Naissance');
    assert.equal(event.date?.text, 'vers 1912');
    assert.equal(event.date?.qualifier, 'about');
    assert.equal(event.date?.min, '1912');
    assert.equal(event.confidence, 'probable', 'sans preuve désignée, le doute reste dit');
  });

  it('conserve le texte d’une date qu’elle ne sait pas lire, sans inventer d’année', () => {
    const event = createEvent({ personId: anna, type: 'bapteme', dateText: 'le douze de jamais' });

    assert.equal(event.date?.text, 'le douze de jamais');
    assert.equal(event.date?.qualifier, 'unknown');
    assert.equal(event.date?.min, null);
    assert.equal(event.date?.max, null);
  });

  it('accepte un fait sans date : il se rangera à la fin de la vie', () => {
    const event = createEvent({ personId: anna, type: 'profession', description: 'modiste' });

    assert.equal(event.date, null);
    assert.equal(event.description, 'modiste');
  });

  it('ne connaît que les types de la spec', () => {
    const refus = expectRefusal(() => createEvent({ personId: anna, type: ' graduation ' }));
    assert.equal(refus.status, 400);
    assert.match(refus.message, /naissance, bapteme/);
  });

  it('ne connaît que trois degrés de confiance', () => {
    const refus = expectRefusal(() =>
      createEvent({ personId: anna, type: 'autre', confidence: 'sûr à cent pour cent' }),
    );
    assert.equal(refus.status, 400);
    assert.match(refus.message, /certain, probable, douteux/);
  });

  it('demande à qui le fait arrive', () => {
    const sansSujet = expectRefusal(() => createEvent({ type: 'autre' }));
    assert.equal(sansSujet.status, 400);
    assert.match(sansSujet.message, /une personne ou à une union/);

    const couple = addCouple(anna, addPerson('Bérenger'));
    const deux = expectRefusal(() =>
      createEvent({ personId: anna, coupleId: couple, type: 'residence' }),
    );
    assert.equal(deux.status, 400);
    assert.match(deux.message, /pas les deux/);
  });

  it('ne rattache pas à une personne ni à une union qui n’existent pas', () => {
    assert.equal(
      expectRefusal(() => createEvent({ personId: 'personne-inconnue', type: 'autre' })).status,
      404,
    );
    assert.equal(
      expectRefusal(() => createEvent({ coupleId: 'union-inconnue', type: 'autre' })).status,
      404,
    );
  });
});

describe('une naissance et un décès par personne', () => {
  let carla: string;

  before(() => {
    carla = addPerson('Carla');
  });

  it('refuse la seconde naissance et dit laquelle reprendre', () => {
    createEvent({ personId: carla, type: 'naissance', dateText: '1901' });

    const refus = expectRefusal(() => createEvent({ personId: carla, type: 'naissance', dateText: '1902' }));
    assert.equal(refus.status, 409);
    assert.match(refus.message, /déjà un événement « Naissance »/);
    assert.equal(eventRows(carla).length, 1);
  });

  it('laisse deux résidences, elles', () => {
    createEvent({ personId: carla, type: 'residence', dateText: '1920', description: 'rue de Lille' });
    createEvent({ personId: carla, type: 'residence', dateText: '1935', description: 'rue de Gand' });

    assert.equal(eventRows(carla).length, 3);
  });

  it('ne se laisse pas contourner en changeant de date sous un autre type', () => {
    const residence = eventsOfPerson(carla).find((one) => one.description === 'rue de Lille');
    assert.ok(residence);
    // Un baptême reste un baptême : la règle ne porte que sur la naissance et le décès.
    createEvent({ personId: carla, type: 'bapteme', dateText: '1901' });
    assert.equal(eventRows(carla).length, 4);
  });

  it('suit la date tapée sur la fiche sans dédoubler la ligne', () => {
    const avant = eventRows(carla).filter((row) => row.type === 'naissance').length;
    assert.equal(avant, 1);

    setPersonDateEvent(carla, 'naissance', '12 mars 1901');
    const apres = eventRows(carla).filter((row) => row.type === 'naissance');
    assert.equal(apres.length, 1, 'la fiche et l’éditeur de vie écrivent la même ligne');
    assert.equal(apres[0].date_text, '12 mars 1901');
    assert.equal(apres[0].date_min, '1901-03-12');
  });

  it('rend la date quand la fiche la vide', () => {
    setPersonDateEvent(carla, 'naissance', '');
    assert.equal(eventRows(carla).filter((row) => row.type === 'naissance').length, 0);
  });

  it('garde le texte d’une date que la fiche ne sait pas lire', () => {
    setPersonDateEvent(carla, 'deces', 'on ne sait pas');

    const rows = eventRows(carla).filter((row) => row.type === 'deces');
    assert.equal(rows.length, 1, 'une date illisible reste une information, pas une ligne perdue');
    assert.equal(rows[0].date_text, 'on ne sait pas');
    assert.equal(rows[0].date_qualifier, 'unknown');
    assert.equal(rows[0].date_min, null, 'et aucune année ne lui est prêtée');
  });
});

describe('modifier un fait déjà écrit', () => {
  let dieter: string;
  let place: string;
  let source: string;

  before(() => {
    dieter = addPerson('Dieter');
    place = addPlace('Roubaix');
    source = addSource('AD du Nord, 5E 1234, acte de mariage');
  });

  it('pose un lieu et une source, et les rend à l’écran', () => {
    const event = createEvent({
      personId: dieter,
      type: 'naissance',
      dateText: '1898',
      placeId: place,
      sourceId: source,
      confidence: 'certain',
    });

    assert.equal(event.place, 'Roubaix');
    assert.equal(event.placeId, place);
    assert.equal(event.source, 'AD du Nord, 5E 1234, acte de mariage');
    assert.equal(event.sourceKind, 'acte');
    assert.equal(event.confidence, 'certain');
  });

  it('laisse intact ce que la demande ne nomme pas', () => {
    const event = eventsOfPerson(dieter)[0];
    const update = updateEvent(event.id, { description: 'né à domicile' });

    assert.equal(update.description, 'né à domicile');
    assert.equal(update.date?.text, '1898', 'la date n’était pas dans la demande');
    assert.equal(update.place, 'Roubaix');
    assert.equal(update.confidence, 'certain');
  });

  it('efface la date quand elle est vidée, pas quand elle est absente', () => {
    const event = eventsOfPerson(dieter)[0];
    const vide = updateEvent(event.id, { dateText: '' });

    assert.equal(vide.date, null);
    assert.equal(vide.description, 'né à domicile');
  });

  it('rend un lieu inconnu et une source inconnue refusés', () => {
    const event = eventsOfPerson(dieter)[0];
    assert.equal(expectRefusal(() => updateEvent(event.id, { placeId: 'lieu-inconnu' })).status, 404);
    assert.equal(expectRefusal(() => updateEvent(event.id, { sourceId: 'source-inconnue' })).status, 404);
    assert.equal(getEvent(event.id).place, 'Roubaix', 'le refus n’a rien déplacé');
  });

  it('ne dédouble pas une naissance en la re-datant', () => {
    const event = eventsOfPerson(dieter)[0];
    updateEvent(event.id, { type: 'naissance', dateText: '1899' });
    assert.equal(eventRows(dieter).filter((row) => row.type === 'naissance').length, 1);
  });

  it('refuse de transformer un autre fait en seconde naissance', () => {
    const bapt = createEvent({ personId: dieter, type: 'bapteme', dateText: '1899-04-01' });
    const refus = expectRefusal(() => updateEvent(bapt.id, { type: 'naissance' }));
    assert.equal(refus.status, 409);
    assert.equal(getEvent(bapt.id).type, 'bapteme');
  });

  it('vide le lieu et la source quand on les met à null', () => {
    const event = eventsOfPerson(dieter)[0];
    const rendu = updateEvent(event.id, { placeId: null, sourceId: null });

    assert.equal(rendu.place, null);
    assert.equal(rendu.source, null);
  });

  it('ne connaît pas un événement qui n’existe pas', () => {
    assert.equal(expectRefusal(() => updateEvent('evenement-inconnu', { type: 'autre' })).status, 404);
    assert.equal(expectRefusal(() => deleteEvent('evenement-inconnu')).status, 404);
    assert.equal(expectRefusal(() => getEvent('evenement-inconnu')).status, 404);
  });
});

describe('lire la vie dans l’ordre', () => {
  let elsa: string;

  before(() => {
    elsa = addPerson('Elsa');
    createEvent({ personId: elsa, type: 'deces', dateText: '1975' });
    createEvent({ personId: elsa, type: 'naissance', dateText: '1900' });
    createEvent({ personId: elsa, type: 'residence', description: 'sans date connue' });
    createEvent({ personId: elsa, type: 'bapteme', dateText: '1901-02' });
  });

  it('range du plus ancien au plus récent, une date inconnue à la fin', () => {
    const types = eventsOfPerson(elsa).map((event) => event.type);
    assert.deepEqual(types, ['naissance', 'bapteme', 'deces', 'residence']);
  });

  it('compte les fichiers reliés au fait', () => {
    const media = newId();
    db.prepare(
      `INSERT INTO media (id, kind, original_path, created_at)
       VALUES (?, 'photo', 'medias/photos/1900/x.jpg', ?)`,
    ).run(media, now());
    const bapteme = eventsOfPerson(elsa).find((event) => event.type === 'bapteme');
    assert.ok(bapteme);
    db.prepare('INSERT INTO media_event (media_id, event_id) VALUES (?, ?)').run(media, bapteme.id);

    assert.equal(eventsOfPerson(elsa).find((event) => event.id === bapteme.id)?.mediaCount, 1);
  });

  it('range aussi les faits d’une union', () => {
    const a = addPerson('Gérard');
    const b = addPerson('Gisèle');
    const couple = addCouple(a, b);
    createEvent({ coupleId: couple, type: 'autre', dateText: '1948', description: 'mariage à la mairie' });

    const events = eventsOfCouple(couple);
    assert.equal(events.length, 1);
    assert.equal(events[0].personId, null);
    assert.equal(events[0].coupleId, couple);
  });

  it('suit la suppression de la personne', () => {
    db.prepare('DELETE FROM person WHERE id = ?').run(elsa);
    assert.equal(eventRows(elsa).length, 0, 'les faits d’une personne effacée la suivent');
  });
});
