import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

// La base de test s'écrit dans un dossier temporaire : jamais dans le vrai dossier familial.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-export-'));

const { db, newId, now } = await import('../server/db');
const { attachRelation } = await import('../server/relations');
const { parseGenealogyDate } = await import('../server/dates');
const { buildExport, EXPORT_FORMAT, EXPORT_VERSION, exportFileName } = await import('../server/export');

type Row = Record<string, any>;

function addPerson(givenNames: string, sex: 'M' | 'F'): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', ?, 1, ?, ?)`,
  ).run(id, givenNames, sex, now(), now());
  return id;
}

function addBirth(personId: string, written: string): void {
  const date = parseGenealogyDate(written);
  assert.ok(date, `la date « ${written} » devait être comprise`);
  db.prepare(
    `INSERT INTO event (id, person_id, type, date_min, date_max, date_qualifier, date_text, created_at)
     VALUES (?, ?, 'naissance', ?, ?, ?, ?, ?)`,
  ).run(newId(), personId, date.min, date.max, date.qualifier, date.text, now());
}

describe('export JSON', () => {
  let paul: string;
  let marie: string;
  let eve: string;
  let nina: string;

  before(() => {
    paul = addPerson('Paul', 'M');
    marie = addPerson('Marie', 'F');
    eve = addPerson('Eve', 'F');
    nina = addPerson('Nina', 'F');

    addBirth(paul, 'vers 1920');
    db.prepare('INSERT INTO name_variant (id, person_id, name, type) VALUES (?, ?, ?, ?)').run(
      newId(),
      paul,
      'Paulo',
      'surnom',
    );

    const placeId = newId();
    db.prepare('INSERT INTO place (id, name) VALUES (?, ?)').run(placeId, 'Liège');
    db.prepare(
      `INSERT INTO media (id, kind, original_path, date_min, date_max, date_qualifier, date_text, created_at)
       VALUES (?, 'photo', 'medias/photos/1920/paul.jpg', '1920', '1920', 'about', 'vers 1920', ?)`,
    ).run(newId(), now());

    const media = db.prepare('SELECT id FROM media').get() as Row;
    db.prepare('INSERT INTO media_person (media_id, person_id, role) VALUES (?, ?, ?)').run(
      media.id,
      paul,
      'sujet',
    );

    // Eve vient d'une union déclarée, Nina d'un seul parent : les deux cas doivent ressortir.
    attachRelation(eve, { type: 'child', ofPersonId: paul, otherParentId: marie });
    attachRelation(nina, { type: 'child', ofPersonId: paul });
  });

  it('porte le format et les comptages de la base', () => {
    const doc = buildExport(paul);
    assert.equal(doc.format, EXPORT_FORMAT);
    assert.equal(doc.version, EXPORT_VERSION);
    assert.equal(doc.rootPersonId, paul);
    assert.equal(doc.counts.persons, 4);
    assert.equal(doc.counts.parentChild, 3);
    assert.equal(doc.counts.places, 1);
    assert.equal(doc.persons.length, doc.counts.persons);
    assert.ok(doc.note.includes('date.qualifier'), 'la note doit expliquer les dates floues');
  });

  it('garde une date floue avec son texte et son incertitude', () => {
    const birth = buildExport(null).events.find((event) => event.personId === paul);
    assert.ok(birth, 'la naissance de Paul doit être dans l’export');
    assert.equal(birth.date?.text, 'vers 1920');
    assert.equal(birth.date?.qualifier, 'about');
    assert.equal(birth.date?.min, '1920');
  });

  it('ne dévine aucune union dans les liens de parenté', () => {
    const links = buildExport(null).parentChild;
    const fromEve = links.filter((link) => link.childId === eve);
    const fromNina = links.filter((link) => link.childId === nina);

    assert.equal(fromEve.length, 2);
    assert.ok(
      fromEve.every((link) => link.coupleId !== null),
      'les deux liens d’Eve portent l’union déclarée',
    );
    assert.equal(fromNina.length, 1);
    assert.equal(fromNina[0].coupleId, null, 'un parent seul ne doit rien inventer');
  });

  it('rattache les noms alternatifs et les médias à leur personne', () => {
    const persons = buildExport(null).persons;
    const exported = persons.find((person) => person.id === paul);
    assert.ok(exported);
    assert.deepEqual(exported.nameVariants, [{ name: 'Paulo', type: 'surnom' }]);

    const media = buildExport(null).media;
    assert.equal(media.length, 1);
    assert.deepEqual(media[0].persons, [{ personId: paul, role: 'sujet' }]);
    assert.equal(media[0].originalPath, 'medias/photos/1920/paul.jpg');
    assert.equal(exported.mediaIds[0], media[0].id);
  });

  it('propose un nom de fichier daté', () => {
    assert.match(exportFileName(new Date('2026-10-29T14:07:00')), /^arbre-20261029-1407\.json$/);
  });
});
