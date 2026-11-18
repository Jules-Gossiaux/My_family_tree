import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-sources-'));

const { db, newId, now } = await import('../server/db');
const { SourceError, createSource, deleteSource, listSources, updateSource } = await import(
  '../server/sources'
);
const { createEvent, eventsOfPerson, updateEvent } = await import('../server/life-events');

type Row = Record<string, any>;

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

/** Un fichier qui cite une source : l'effacement compte les deux sortes de citations. */
function addMedia(sourceId: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO media (id, kind, original_path, created_at, source_id)
     VALUES (?, 'photo', 'medias/photos/1900/x.jpg', ?, ?)`,
  ).run(id, now(), sourceId);
  return id;
}

function sourceRows(): Row[] {
  return db.prepare('SELECT * FROM source').all() as Row[];
}

function knownReference(reference: string): string {
  const row = sourceRows().find((candidate) => candidate.reference === reference)!;
  return row.id as string;
}

function expectRefusal<T extends Error>(action: () => unknown, kind: new (...args: any[]) => T): T {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof kind, `attendu un refus de ${kind.name}, reçu : ${String(error)}`);
    return error;
  }
  return assert.fail('la source aurait dû être refusée');
}

describe('une source se déclare une fois', () => {
  it('se classe, se cite et rend son genre en français', () => {
    const acte = createSource({ kind: ' ACTE ', reference: '  AD du Nord, 5E 1234  ' });

    assert.equal(acte.kind, 'acte', 'le genre se range sans accent');
    assert.equal(acte.label, 'Acte', 'et son libellé s’affiche en français');
    assert.equal(acte.reference, 'AD du Nord, 5E 1234', 'les espaces de trop ne se gardent pas');
    assert.equal(acte.reliability, 'probable', 'sans fiabilité dite, on présume');
    assert.deepEqual([acte.eventCount, acte.mediaCount], [0, 0], 'rien ne la cite encore');
  });

  it('refuse ce qui ne la désigne pas et n’écrit rien', () => {
    const avant = sourceRows().length;

    const genre = expectRefusal(() => createSource({ kind: 'tiktok', reference: 'un profil' }), SourceError);
    assert.equal(genre.status, 400);
    assert.match(genre.message, /livre/);

    const sansGenre = expectRefusal(() => createSource({ reference: 'sans genre' }), SourceError);
    assert.equal(sansGenre.status, 400);
    assert.match(sansGenre.message, /se classe/);

    const vide = expectRefusal(() => createSource({ kind: 'livre', reference: '   ' }), SourceError);
    assert.equal(vide.status, 400);
    assert.match(vide.message, /une cote/);

    const fiabilite = expectRefusal(
      () => createSource({ kind: 'livre', reference: 'un livre sans fiabilité', reliability: 'peut-etre' }),
      SourceError,
    );
    assert.equal(fiabilite.status, 400);
    assert.match(fiabilite.message, /douteux/);

    assert.equal(sourceRows().length, avant, 'une source refusée ne peuple pas la liste');
  });

  it('ne se déclare pas deux fois sous la même référence', () => {
    const doublon = expectRefusal(
      () => createSource({ kind: 'livre', reference: '  ad DU NORD, 5e 1234 ' }),
      SourceError,
    );

    assert.equal(doublon.status, 409);
    assert.match(doublon.message, /Acte/, 'le refus dit sous quel genre la ligne existe déjà');
    assert.equal(sourceRows().length, 1);
  });

  it('range sa liste par genre puis par référence', () => {
    createSource({ kind: 'livre', reference: 'Recueil de la Marine' });
    createSource({ kind: 'temoignage', reference: 'Tante Michèle, 1998' });

    assert.deepEqual(
      listSources().map((source) => `${source.label}|${source.reference}`),
      ['Acte|AD du Nord, 5E 1234', 'Livre|Recueil de la Marine', 'Témoignage|Tante Michèle, 1998'],
      'la liste se lit comme un catalogue',
    );
  });
});

describe('corriger une source', () => {
  let acte: string;
  let anna: string;

  before(() => {
    acte = knownReference('AD du Nord, 5E 1234');
    anna = addPerson('Anna');
    createEvent({ personId: anna, type: 'naissance', dateText: '1901', sourceId: acte });
  });

  it('déplace la référence, pas les faits qui la citent', () => {
    const corrige = updateSource(acte, { reference: 'AD du Nord, 3E 142' });

    assert.equal(corrige.id, acte, 'la source reste la même ligne, seul le texte bouge');
    assert.equal(corrige.reference, 'AD du Nord, 3E 142');
    assert.equal(eventsOfPerson(anna)[0].source, 'AD du Nord, 3E 142', 'le fait suit la nouvelle cote');
  });

  it('ne se refuse pas elle-même quand elle garde sa référence', () => {
    assert.equal(updateSource(acte, { reference: ' AD du Nord, 3E 142 ' }).reference, 'AD du Nord, 3E 142');
  });

  it('refuse une référence déjà prise ailleurs et dit sous quel genre', () => {
    const temoignage = listSources().find((source) => source.kind === 'temoignage')!;
    const refus = expectRefusal(
      () => updateSource(temoignage.id, { reference: 'ad du nord, 3e 142' }),
      SourceError,
    );

    assert.equal(refus.status, 409);
    assert.match(refus.message, /Acte/);
    assert.equal(
      listSources().find((source) => source.id === temoignage.id)!.reference,
      'Tante Michèle, 1998',
      'le refus n’a rien changé',
    );
  });

  it('change le genre et la fiabilité sans rien redemander d’autre', () => {
    const corrige = updateSource(acte, { kind: 'livre', reliability: 'certain' });

    assert.deepEqual([corrige.kind, corrige.label, corrige.reliability], ['livre', 'Livre', 'certain']);
    assert.equal(eventsOfPerson(anna)[0].source, 'AD du Nord, 3E 142', 'la référence n’a pas bougé');

    const vide = expectRefusal(() => updateSource(acte, { reference: '   ' }), SourceError);
    assert.equal(vide.status, 400);
    assert.equal(updateSource(acte, { kind: 'acte' }).reference, 'AD du Nord, 3E 142');
  });

  it('compte ce qui la cite, faits et fichiers ensemble', () => {
    assert.equal(listSources().find((source) => source.id === acte)!.eventCount, 1);

    addMedia(acte);
    assert.equal(listSources().find((source) => source.id === acte)!.mediaCount, 1);
  });

  it('ne connaît pas une source qui n’existe pas', () => {
    const inconnue = expectRefusal(() => updateSource('source-inconnue', { kind: 'acte' }), SourceError);
    assert.equal(inconnue.status, 404);
    assert.equal(expectRefusal(() => deleteSource('source-inconnue'), SourceError).status, 404);
  });
});

describe('effacer une source', () => {
  let acte: string;
  let anna: string;
  let fait: string;

  before(() => {
    acte = createSource({ kind: 'acte', reference: 'AD du Nord, 8E 411' }).id;
    anna = addPerson('Gérard');
    fait = createEvent({ personId: anna, type: 'bapteme', dateText: '1902', sourceId: acte }).id;
  });

  it('se refuse tant qu’un fait la cite, et dit combien de gestes reste à faire', () => {
    addMedia(acte);
    const refus = expectRefusal(() => deleteSource(acte), SourceError);

    assert.equal(refus.status, 409);
    assert.match(refus.message, /1 fait et 1 fichier/);
    assert.equal(sourceRows().some((row) => row.id === acte), true, 'le refus laisse la source en place');
    assert.equal(eventsOfPerson(anna)[0].source, 'AD du Nord, 8E 411');
  });

  it('s’efface une fois les citations retirées, sans rien ôter du fait', () => {
    updateEvent(fait, { sourceId: null });
    db.prepare('DELETE FROM media WHERE source_id = ?').run(acte);

    deleteSource(acte);
    const reste = eventsOfPerson(anna)[0];

    assert.equal(sourceRows().some((row) => row.id === acte), false);
    assert.equal(reste.source, null, 'le fait ne cite plus rien');
    assert.equal(reste.sourceId, null);
    assert.equal(reste.date?.text, '1902', 'il garde sa date et le reste de sa vie');
    assert.equal(reste.place, null, 'et rien d’autre n’a bougé autour de lui');
  });

  it('s’efface quand elle n’a jamais été citée', () => {
    const libre = createSource({ kind: 'web', reference: 'example.fr/acte-1870' });

    deleteSource(libre.id);
    assert.equal(sourceRows().some((row) => row.id === libre.id), false);
    assert.equal(listSources().length, sourceRows().length, 'la liste ne porte que ce qui existe');
  });
});
