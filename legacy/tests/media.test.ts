import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// Un dossier temporaire, comme partout ailleurs : les photos de test ne doivent jamais
// rejoindre le vrai dossier familial, ni en rester dans la base, ni sur le disque.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-medias-'));

const { db, newId, now } = await import('../server/db');
const { DATA_DIR } = await import('../server/config');
const {
  MAX_BYTES,
  MediaError,
  attachPersons,
  deleteMedia,
  detachPerson,
  getMedia,
  listMedia,
  mediaFile,
  rejectUpload,
  setPortrait,
  storeMedia,
  storeThumbnail,
  updateMedia,
} = await import('../server/media');

type Row = Record<string, any>;

/** Un JPEG vrai n'est pas nécessaire : l'application ne décode rien, elle range des octets. */
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'u'.charCodeAt(0), 0x00]);

function addPerson(label: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO person (id, given_names, family_name, sex, living, created_at, updated_at)
     VALUES (?, ?, 'Test', '?', 1, ?, ?)`,
  ).run(id, label, now(), now());
  return id;
}

function files(): string[] {
  const walk = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  };
  return walk(path.join(DATA_DIR, 'medias')).sort();
}

function mediaRows(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM media').get() as Row).n as number;
}

function expectRefusal(action: () => unknown, label: string): MediaError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof MediaError, `${label} : ce n’est pas un refus de média`);
    return error;
  }
  assert.fail(`${label} : la promesse a été acceptée`);
}

let marie = '';
let paul = '';

before(() => {
  marie = addPerson('Marie');
  paul = addPerson('Paul');
});

after(() => {
  if (db.open) db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('entrer une photo', () => {
  it('refuse ce que le navigateur ne saura pas montrer', () => {
    assert.match(rejectUpload('photo', 'image/tiff', 1000) ?? '', /format n.*est pas accepté/);
    assert.match(rejectUpload('tableau', 'image/jpeg', 1000) ?? '', /photo ou un document/);
    assert.match(rejectUpload('photo', 'image/jpeg', 0) ?? '', /vide/);
    assert.match(rejectUpload('photo', 'image/jpeg', MAX_BYTES + 1) ?? '', /Mo/);
    assert.equal(rejectUpload('photo', 'image/jpeg', 1000), null);
  });

  it('range l’original par année et le déclare dans la base', () => {
    const { media, deduped } = storeMedia({
      kind: 'photo',
      mime: 'image/jpeg',
      buffer: BYTES,
      taken: '1952-06-14',
      width: 1200,
      height: 800,
    });
    assert.equal(deduped, false);
    assert.equal(media.kind, 'photo');
    assert.equal(media.width, 1200);
    assert.equal(media.date?.qualifier, 'exact');
    assert.equal(media.date?.min, '1952-06-14');
    assert.deepEqual(media.persons, []);

    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(media.id) as Row;
    assert.equal(row.original_path, `medias/photos/1952/${media.id}.jpg`);
    assert.ok(fs.existsSync(path.join(DATA_DIR, ...row.original_path.split('/'))));
    assert.equal(row.sha256.length, 64);
  });

  it('ne range pas deux fois la même image', () => {
    const before_files = files().length;
    const second = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: BYTES });
    assert.equal(second.deduped, true);
    assert.equal(files().length, before_files, 'des octets ont été écrits une seconde fois');
  });

  it('sépare les documents des photos', () => {
    const { media } = storeMedia({
      kind: 'document',
      mime: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
      taken: '1901',
      documentType: 'acte de naissance',
    });
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(media.id) as Row;
    assert.match(row.original_path, /^medias\/documents\/1901\/.+\.pdf$/);
    assert.equal(media.documentType, 'acte de naissance');
  });

  it('rangée faute d’année lisible, mais pas perdue', () => {
    const { media } = storeMedia({ kind: 'photo', mime: 'image/png', buffer: Buffer.from('‰/png') });
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(media.id) as Row;
    assert.match(row.original_path, new RegExp(`^medias/photos/${new Date().getFullYear()}/`));
    assert.equal(media.date, null, 'une date que l’on ne sait pas lire ne s’invente pas');
  });

  it('garde la vignette à part de l’original', () => {
    const { media } = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('autre image') });
    assert.equal(media.hasThumb, false);
    const withThumb = storeThumbnail(media.id, Buffer.from('vignette'));
    assert.equal(withThumb.hasThumb, true);

    const thumbRow = db.prepare('SELECT thumb_path FROM media WHERE id = ?').get(media.id) as Row;
    assert.match(thumbRow.thumb_path, /^medias\/vignettes\/\d{4}\/[0-9a-f-]+\.jpg$/);

    const original = mediaFile(media.id, 'original');
    const thumb = mediaFile(media.id, 'thumb');
    assert.ok(original.file !== thumb.file, 'la vignette a écrasé l’original');
    assert.equal(thumb.mime, 'image/jpeg');
    assert.equal(fs.existsSync(original.file), true);
    assert.equal(fs.existsSync(thumb.file), true);
  });

  it('refuse une vignette vide ou délirante', () => {
    const { media } = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('image y') });
    assert.equal(expectRefusal(() => storeThumbnail(media.id, Buffer.alloc(0)), 'vignette vide').status, 400);
    assert.equal(
      expectRefusal(() => storeThumbnail(media.id, Buffer.alloc(3 * 1024 * 1024)), 'vignette géante').status,
      400,
    );
    assert.equal(expectRefusal(() => storeThumbnail(newId(), Buffer.from('x')), 'vignette sans média').status, 404);
  });
});

describe('relier une image à une personne', () => {
  it('rattache seul et par lot', () => {
    const a = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('groupe a') }).media;
    const b = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('groupe b') }).media;

    attachPersons(a.id, [marie]);
    attachPersons(b.id, [marie, paul], 'témoin');
    assert.equal(getMedia(a.id).persons.length, 1);
    assert.equal(getMedia(b.id).persons.length, 2);
    assert.equal(getMedia(b.id).persons[0].role, 'témoin');

    // La même personne ajoutée deux fois ne duplique pas : un nom par photo suffit.
    attachPersons(a.id, [marie]);
    assert.equal(getMedia(a.id).persons.length, 1);
  });

  it('refuse une personne qui n’est pas dans l’arbre', () => {
    const media = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('solo') }).media;
    assert.equal(expectRefusal(() => attachPersons(media.id, [newId()]), 'inconnue').status, 400);
    assert.equal(expectRefusal(() => attachPersons(newId(), [marie]), 'média absent').status, 404);
  });

  it('ne rattache pas pour rien : le bac d’entrée ne montre que ce qui cherche', () => {
    const attached = listMedia({ unattached: true }).every((media) => media.persons.length === 0);
    assert.equal(attached, true);
    const unattachedBefore = listMedia({ unattached: true }).length;
    const loose = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('sans visage') }).media;
    assert.equal(listMedia({ unattached: true }).length, unattachedBefore + 1);
    attachPersons(loose.id, [marie]);
    assert.equal(listMedia({ unattached: true }).length, unattachedBefore);
  });

  it('détacher enlève la personne et le portrait qui allait avec', () => {
    const media = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('portrait') }).media;
    attachPersons(media.id, [marie]);
    setPortrait(marie, media.id);
    assert.equal((db.prepare('SELECT portrait_media_id FROM person WHERE id = ?').get(marie) as Row).portrait_media_id, media.id);

    detachPerson(media.id, marie);
    assert.equal(getMedia(media.id).persons.length, 0);
    assert.equal(
      (db.prepare('SELECT portrait_media_id FROM person WHERE id = ?').get(marie) as Row).portrait_media_id,
      null,
      'le portrait de la fiche montre une personne qui n’est plus sur la photo',
    );
  });

  it('ne choisit pas un portrait parmi des inconnus', () => {
    const media = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('non rattaché') }).media;
    assert.equal(expectRefusal(() => setPortrait(paul, media.id), 'portrait sans lien').status, 400);
    setPortrait(paul, null);
    assert.equal(
      (db.prepare('SELECT portrait_media_id FROM person WHERE id = ?').get(paul) as Row).portrait_media_id,
      null,
    );
  });

  it('liste les médias d’une personne', () => {
    const personMedia = listMedia({ personId: marie });
    assert.ok(personMedia.length >= 2);
    assert.equal(personMedia.every((media) => media.persons.some((p) => p.id === marie)), true);
  });

  it('range la vie d’une personne du plus ancien au plus récent', () => {
    const joseph = addPerson('Joseph');
    const recent = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('1968'), taken: '1968-05-01' }).media;
    const ancien = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('1911'), taken: '1911-01-09' }).media;
    const sansDate = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('sans date') }).media;
    for (const media of [recent, ancien, sansDate]) attachPersons(media.id, [joseph]);

    assert.deepEqual(
      listMedia({ personId: joseph }).map((media) => media.id),
      [ancien.id, recent.id, sansDate.id],
      'un dossier de vie se lit dans l’ordre où la vie s’est déroulée',
    );

    // Le bac d’entrée, lui, montre d’abord ce qui vient d’arriver.
    const leDernier = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('dépôt récent') }).media;
    assert.equal(listMedia({ unattached: true })[0].id, leDernier.id);
  });
});

describe('corriger et effacer', () => {
  it('écrit une légende, un type et une date floue', () => {
    const { media } = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('mariage') });
    const updated = updateMedia(media.id, {
      caption: '  mariage de 1952  ',
      dateText: 'vers 1952',
      documentType: null,
    });
    assert.equal(updated.caption, 'mariage de 1952');
    assert.equal(updated.date?.qualifier, 'about');
    assert.equal(updated.date?.min, '1952');

    assert.equal(updateMedia(media.id, { caption: null }).caption, null);
    assert.equal(updateMedia(media.id, { kind: 'document' }).kind, 'document');
    assert.equal(expectRefusal(() => updateMedia(media.id, { kind: 'tableau' as 'photo' }), 'type inventé').status, 400);
    assert.equal(expectRefusal(() => updateMedia(newId(), { caption: 'x' }), 'média absent').status, 404);
  });

  it('efface la ligne et les deux fichiers', () => {
    const { media } = storeMedia({ kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from('à jeter') });
    storeThumbnail(media.id, Buffer.from('vignette à jeter'));
    const paths = [mediaFile(media.id, 'original').file, mediaFile(media.id, 'thumb').file];
    const rows = mediaRows();

    deleteMedia(media.id);
    assert.equal(mediaRows(), rows - 1);
    for (const file of paths) assert.equal(fs.existsSync(file), false, `${file} est resté sur le disque`);
    deleteMedia(media.id); // effacer deux fois ne doit pas casser
  });

  it('refuse un chemin inscrit dans la base qui sortirait du dossier', () => {
    const id = newId();
    db.prepare(
      `INSERT INTO media (id, kind, original_path, created_at) VALUES (?, 'photo', ?, ?)`,
    ).run(id, '../../../Windows/win.ini', now());
    assert.equal(expectRefusal(() => mediaFile(id, 'original'), 'hors dossier').status, 400);

    db.prepare('UPDATE media SET original_path = ? WHERE id = ?').run('medias/photos/1900/absent.jpg', id);
    assert.equal(expectRefusal(() => mediaFile(id, 'original'), 'fichier manquant').status, 404);
    deleteMedia(id);
  });
});
