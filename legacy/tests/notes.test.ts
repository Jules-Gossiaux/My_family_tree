import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-notes-'));

const { db, newId, now } = await import('../server/db');
const { NoteError, createNote, deleteNote, dropNotesFor, notesOf, updateNote } = await import(
  '../server/notes'
);
const { createEvent, deleteEvent, setPersonDateEvent } = await import('../server/life-events');
const { deletePlace, findOrCreatePlace } = await import('../server/places');
const { deleteMedia } = await import('../server/media');
const { pruneEmptyCouples } = await import('../server/relations');

type Row = Record<string, any>;

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

/** Une union que plus rien ne justifie : c'est elle que l'élagage emporte avec sa marge. */
function addEmptyCouple(): string {
  const id = newId();
  db
    .prepare(`INSERT INTO couple (id, type, status, created_at) VALUES (?, 'inconnu', 'en_cours', ?)`)
    .run(id, now());
  return id;
}

function addMediaRow(): string {
  const id = newId();
  db.prepare(
    `INSERT INTO media (id, kind, original_path, created_at)
     VALUES (?, 'photo', 'medias/photos/1900/x.jpg', ?)`,
  ).run(id, now());
  return id;
}

function noteRows(): Row[] {
  return db.prepare('SELECT * FROM note').all() as Row[];
}

function bornEvent(personId: string): string {
  const row = db
    .prepare("SELECT id FROM event WHERE person_id = ? AND type = 'naissance'")
    .get(personId) as Row;
  return row.id as string;
}

/** Une note plus ancienne que les autres : seule l'écriture commande l'ordre de lecture. */
function writeEarlier(id: string): void {
  db.prepare('UPDATE note SET created_at = ? WHERE id = ?').run('2019-01-01T00:00:00.000Z', id);
}

function expectRefusal(action: () => unknown): NoteError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof NoteError, `attendu un refus de note, reçu : ${String(error)}`);
    return error;
  }
  return assert.fail('la note aurait dû être refusée');
}

describe('une note se pose sur une ligne qui existe', () => {
  it('garde son texte et la cible qu’on lui donne', () => {
    const camille = addPerson('Camille');
    const note = createNote({
      targetType: ' Person ',
      targetId: camille,
      body: '  modiste rue de Lille  ',
    });

    assert.equal(note.targetType, 'person', 'le type se range comme la base le connaît');
    assert.equal(note.targetId, camille);
    assert.equal(note.body, 'modiste rue de Lille', 'les espaces de trop ne se gardent pas');
    assert.match(note.createdAt, /^\d{4}-\d{2}-\d{2}T/, 'une note s’écrit à un moment précis');
    assert.deepEqual(notesOf('person', camille).map((one) => one.id), [note.id]);
  });

  it('se refuse sans texte, sans cible ou sur une cible inventée', () => {
    const helene = addPerson('Hélène');
    const avant = noteRows().length;

    const vide = expectRefusal(() =>
      createNote({ targetType: 'person', targetId: helene, body: '   ' }),
    );
    assert.equal(vide.status, 400);
    assert.match(vide.message, /s’écrit/);

    const cible = expectRefusal(() => createNote({ targetType: 'lieu', targetId: helene, body: 'un mot' }));
    assert.equal(cible.status, 400);
    assert.match(cible.message, /place/, 'le refus dit sur quoi une note se pose');

    const inventee = expectRefusal(() =>
      createNote({ targetType: 'person', targetId: 'x-inventee', body: 'un mot' }),
    );
    assert.equal(inventee.status, 404);

    const sansCible = expectRefusal(() => createNote({ targetType: 'person', body: 'un mot' }));
    assert.equal(sansCible.status, 404);

    assert.equal(noteRows().length, avant, 'une note refusée ne peuple pas la base');
  });

  it('ne se mélange pas d’une ligne à l’autre', () => {
    const julie = addPerson('Julie');
    const rene = addPerson('René');
    const fait = createEvent({ personId: julie, type: 'residence', dateText: '1913' });

    createNote({ targetType: 'person', targetId: julie, body: 'née à Roubaix' });
    createNote({ targetType: 'event', targetId: fait.id, body: 'le recensement la donne veuve' });

    assert.equal(
      notesOf('person', julie).length,
      1,
      'la marge d’une personne ne compte pas celle d’un fait',
    );
    assert.equal(notesOf('person', rene).length, 0, 'ni celle du voisin');
    assert.equal(notesOf('event', fait.id)[0].body, 'le recensement la donne veuve');
  });

  it('se relit dans l’ordre où elle a été écrite', () => {
    const marguerite = addPerson('Marguerite');
    const premiere = createNote({ targetType: 'person', targetId: marguerite, body: 'premier mot' });
    createNote({ targetType: 'person', targetId: marguerite, body: 'second mot' });
    writeEarlier(premiere.id);

    assert.deepEqual(
      notesOf('person', marguerite).map((one) => one.body),
      ['premier mot', 'second mot'],
    );
  });
});

describe('corriger et effacer une note', () => {
  it('corrige le texte sans changer la date ni la cible', () => {
    const yvonne = addPerson('Yvonne');
    const note = createNote({ targetType: 'person', targetId: yvonne, body: 'modiste' });

    const corrige = updateNote(note.id, '  modiste, rue de Lille  ');

    assert.equal(corrige.id, note.id);
    assert.equal(corrige.body, 'modiste, rue de Lille');
    assert.equal(
      corrige.createdAt,
      note.createdAt,
      'une correction reste écrite au jour de sa première phrase',
    );
    assert.equal(corrige.targetId, yvonne);

    const vide = expectRefusal(() => updateNote(note.id, '  '));
    assert.equal(vide.status, 400);
    assert.equal(
      noteRows().find((row) => row.id === note.id)!.body,
      'modiste, rue de Lille',
      'le refus ne vide pas la note',
    );
  });

  it('ne connaît pas une note qui n’existe pas', () => {
    assert.equal(expectRefusal(() => updateNote('note-inconnue', 'un mot')).status, 404);
    assert.equal(expectRefusal(() => deleteNote('note-inconnue')).status, 404);
  });

  it('s’efface seule', () => {
    const lucie = addPerson('Lucie');
    const note = createNote({ targetType: 'person', targetId: lucie, body: 'à reprendre' });

    deleteNote(note.id);

    assert.equal(notesOf('person', lucie).length, 0);
    assert.equal(noteRows().some((row) => row.id === note.id), false);
  });
});

describe('ce que l’on efface emporte ses notes', () => {
  it('suit la personne hors de la base', () => {
    const brigitte = addPerson('Brigitte');
    createNote({ targetType: 'person', targetId: brigitte, body: 'sa cousine raconte…' });

    dropNotesFor('person', brigitte);

    assert.equal(notesOf('person', brigitte).length, 0);
  });

  it('suit un fait que l’on retire', () => {
    const anna = addPerson('Odette');
    const faite = createEvent({ personId: anna, type: 'residence', dateText: '1913' });
    createNote({ targetType: 'event', targetId: faite.id, body: 'une rue que l’on ne retrouve plus' });

    deleteEvent(faite.id);

    assert.equal(notesOf('event', faite.id).length, 0, 'le fait parti, sa marge part avec lui');
  });

  it('suit aussi le fait rendu par une date vidée sur la fiche', () => {
    const anna = addPerson('Solange');
    setPersonDateEvent(anna, 'naissance', '1901');
    const fait = bornEvent(anna);
    createNote({ targetType: 'event', targetId: fait, body: 'née vers dix heures du matin' });

    setPersonDateEvent(anna, 'naissance', '');

    assert.equal(notesOf('event', fait).length, 0, 'vider la date efface le fait, donc sa note');
  });

  it('suit le lieu, le fichier et l’union élaguée', () => {
    const lieu = findOrCreatePlace('Roubaix').place;
    createNote({ targetType: 'place', targetId: lieu.id, body: 'fabrique de laine' });
    deletePlace(lieu.id);
    assert.equal(notesOf('place', lieu.id).length, 0);

    const fichier = addMediaRow();
    createNote({ targetType: 'media', targetId: fichier, body: 'le dos de la photo est daté' });
    deleteMedia(fichier);
    assert.equal(notesOf('media', fichier).length, 0);

    const union = addEmptyCouple();
    createNote({ targetType: 'couple', targetId: union, body: 'on ne sait pas qui elle a épousé' });
    pruneEmptyCouples();
    assert.equal(notesOf('couple', union).length, 0, 'une union élaguée ne laisse pas sa note orpheline');
  });

  it('ignore une cible qu’il ne connaît pas', () => {
    const renee = addPerson('Renée');
    const note = createNote({ targetType: 'person', targetId: renee, body: 'rien à voir ici' });

    dropNotesFor('branche', renee);
    assert.equal(notesOf('person', renee).length, 1, 'un type inconnu ne fait pas partir les notes');

    deleteNote(note.id);
  });
});
