import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import AdmZip from 'adm-zip';

// Le tiroir de test, jamais le dossier familial : ces archives sont fabriquées ligne à ligne.
process.env.FAMILY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-rejeu-'));

const { NOM_D_ARCHIVES, archives, charger, ordreDePose } = await import('../server/ouvrir-coffre');
const { DATA_DIR } = await import('../server/config');

const TIROIR = path.join(DATA_DIR, 'sauvegardes');
fs.mkdirSync(TIROIR, { recursive: true });

const sha = (octets: Buffer): string => crypto.createHash('sha256').update(octets).digest('hex');

type Rang = Record<string, unknown>;

/**
 * Une archive faite comme la write server/coffre.ts la fait : le JSON à deux espaces, le manifeste
 * qui en porte le compte et l'empreinte. Ce que testent ces lignes, c'est le contrôle du rejeu, pas
 * une idée de ce à quoi ressemble un coffre.
 */
function fabriquer(nom: string, f: { tables?: Record<string, Rang[]>; medias?: Record<string, Buffer>; projet?: string }): string {
  const zip = new AdmZip();
  const enteteTables: Record<string, { lignes: number; octets: number; sha256: string }> = {};
  const enteteMedias: { cle: string; octets: number; sha256: string }[] = [];

  for (const [table, rangs] of Object.entries(f.tables ?? {})) {
    const corps = Buffer.from(JSON.stringify(rangs, null, 2), 'utf8');
    zip.addFile(`tables/${table}.json`, corps);
    enteteTables[table] = { lignes: rangs.length, octets: corps.length, sha256: sha(corps) };
  }
  for (const [cle, corps] of Object.entries(f.medias ?? {})) {
    zip.addFile(`medias/${cle}`, corps);
    enteteMedias.push({ cle, octets: corps.length, sha256: sha(corps) });
  }
  zip.addFile(
    'manifeste.json',
    Buffer.from(
      JSON.stringify(
        {
          projet: f.projet ?? 'projet-des-tests',
          adresse: 'https://projet-des-tests.supabase.co',
          horodatage: new Date().toISOString(),
          sens: 'cloud vers disque',
          tables: enteteTables,
          medias: enteteMedias,
          orphelins: [],
          ecarts: [],
        },
        null,
        2,
      ),
      'utf8',
    ),
  );
  const chemin = path.join(TIROIR, nom);
  zip.writeZip(chemin);
  return chemin;
}

/** Retoucher une archive sans toucher son manifeste, comme le ferait un octet qui a bougé. */
function falsifier(chemin: string, entree: string, corps: Buffer): string {
  const zip = new AdmZip(chemin);
  zip.updateFile(entree, corps);
  zip.writeZip(chemin);
  return chemin;
}

const famille = {
  person: [{ id: 'jules', given_name: 'Jules', branch_id: 'gossiaux' }],
  branch: [{ id: 'gossiaux', name: 'Gossiaux', root_person_id: 'jules' }],
  place: [{ id: 'paris', name: 'Paris', parent_place_id: 'france' }],
  couple: [{ id: 'wf-jm', partner_a: 'wilhelm', partner_b: 'jean' }],
  parent_child: [{ id: 'pc1', parent_id: 'wilhelm', child_id: 'jules', couple_id: 'wf-jm' }],
  event: [{ id: 'e1', kind: 'birth', person_id: 'jules', couple_id: null }],
  media: [{ id: 'm1', original_path: 'photos/2026/m1.jpg', thumb_path: 'vignettes/2026/m1.jpg', mime: 'image/jpeg' }],
  media_person: [{ media_id: 'm1', person_id: 'jules' }],
  media_event: [{ media_id: 'm1', event_id: 'e1' }],
};

describe('rejouer un coffre', () => {
  it('reconnaît une archive saine, tables et fichiers compris', () => {
    const chemin = fabriquer('coffre-2026-01-01-0000.zip', { tables: famille, medias: { 'photos/2026/m1.jpg': Buffer.from('une photo') } });
    const coffre = charger(chemin, TIROIR);
    assert.equal(coffre.soucis.length, 0, coffre.soucis.join(' / '));
    assert.equal(coffre.tables.get('person')?.length, 1);
    assert.equal(coffre.octets.get('photos/2026/m1.jpg')?.toString(), 'une photo');
  });

  it('refuse une ligne qui a bougé depuis l’écriture du coffre', () => {
    const chemin = fabriquer('coffre-2026-01-01-0001.zip', { tables: famille });
    falsifier(chemin, 'tables/person.json', Buffer.from(JSON.stringify([{ id: 'jules', given_name: 'Jules', branch_id: 'autre' }], null, 2), 'utf8'));
    const souci = charger(chemin, TIROIR).soucis.join(' ');
    assert.match(souci, /person : l'archive est abîmée/);
  });

  it('refuse un fichier rogné de quatre octets', () => {
    const chemin = fabriquer('coffre-2026-01-01-0002.zip', { tables: famille, medias: { 'photos/2026/m1.jpg': Buffer.from('une photo') } });
    falsifier(chemin, 'medias/photos/2026/m1.jpg', Buffer.from('une p'));
    assert.match(charger(chemin, TIROIR).soucis.join(' '), /photos\/2026\/m1\.jpg : 5 octets dans l'archive, 9 annoncés/);
  });

  it('refuse une table échouée dans l’archive sans que le manifeste la connaisse', () => {
    const chemin = fabriquer('coffre-2026-01-01-0003.zip', { tables: famille });
    const zip = new AdmZip(chemin);
    zip.addFile('tables/cousin.json', Buffer.from('[]', 'utf8'));
    zip.writeZip(chemin);
    assert.match(charger(chemin, TIROIR).soucis.join(' '), /tables\/cousin\.json : une table dans l'archive que le manifeste ne nomme pas/);
  });

  it('signale la table que le manifeste annonce et que l’archive a perdue', () => {
    const chemin = fabriquer('coffre-2026-01-01-0004.zip', { tables: famille });
    const zip = new AdmZip(chemin);
    zip.deleteFile('tables/branch.json');
    zip.writeZip(chemin);
    assert.match(charger(chemin, TIROIR).soucis.join(' '), /branch : le manifeste la compte, l'archive ne la contient pas/);
  });

  it('ne prend pas une archive d’un autre monde pour un coffre', () => {
    const chemin = fabriquer('coffre-2026-01-01-0005.zip', { tables: famille });
    const zip = new AdmZip(chemin);
    zip.deleteFile('manifeste.json');
    zip.writeZip(chemin);
    assert.throws(() => charger(chemin, TIROIR), /pas de manifeste\.json/);
  });

  it('pose les parents avant les enfants, la table inconnue à la fin', () => {
    const coffre = charger(fabriquer('coffre-2026-01-01-0006.zip', { tables: { ...famille, tante: [{ id: 't1' }] } }), TIROIR);
    const range = ordreDePose(coffre).map((e) => e.table);
    assert.ok(range.indexOf('place') < range.indexOf('media'), 'un lieu référencé par un média se pose avant');
    assert.ok(range.indexOf('person') < range.indexOf('branch'), 'une branche racinée sur une personne se pose après');
    assert.ok(range.indexOf('couple') < range.indexOf('parent_child'), 'un lien pend sous un couple déclaré');
    assert.ok(range.indexOf('event') < range.indexOf('media_event'), 'un média collé à un fait se pose après lui');
    assert.equal(range[range.length - 1], 'tante', 'une table que le plan ne connaît pas passe à la fin, pas à la trappe');
  });

  it('laisse vide la colonne que la référence ne peut pas encore recevoir', () => {
    const coffre = charger(fabriquer('coffre-2026-01-01-0007.zip', { tables: famille }), TIROIR);
    const pose = ordreDePose(coffre);
    assert.deepEqual(pose.find((e) => e.table === 'person')?.differe, ['branch_id']);
    assert.deepEqual(pose.find((e) => e.table === 'place')?.differe, ['parent_place_id']);
    assert.deepEqual(pose.find((e) => e.table === 'media_person')?.clef, ['media_id', 'person_id']);
  });

  it('ne repose pas une table que le coffre ne contient pas', () => {
    const coffre = charger(fabriquer('coffre-2026-01-01-0008.zip', { tables: { person: famille.person } }), TIROIR);
    assert.deepEqual(ordreDePose(coffre).map((e) => e.table), ['person']);
  });

  it('distingue un coffre des archives de l’ère SQLite et les range du plus récent', () => {
    fabriquer('coffre-2026-01-01-0009.zip', { tables: famille });
    fs.writeFileSync(path.join(TIROIR, 'famille-2026-01-01-0000-auto.zip'), 'ceci est une base SQLite, pas un coffre');
    const noms = archives(TIROIR).map((a) => a.nom);
    assert.ok(noms.includes('coffre-2026-01-01-0009.zip'));
    assert.ok(!noms.some((n) => n.startsWith('famille-')), 'une archive de base SQLite ne se nomme jamais « --retablir »');
    assert.ok(noms.every((n) => n.startsWith(NOM_D_ARCHIVES)));
    const chemin = path.join(TIROIR, 'coffre-2026-01-01-0009.zip');
    const demain = new Date(Date.now() + 86400000);
    fs.utimesSync(chemin, demain, demain);
    assert.equal(archives(TIROIR)[0].nom, 'coffre-2026-01-01-0009.zip', 'la plus récente se propose la première');
  });

  it('lit un coffre désigné par son seul nom dans le dossier', () => {
    fabriquer('coffre-2026-01-03-0000.zip', { tables: famille });
    const coffre = charger('coffre-2026-01-03-0000.zip', TIROIR);
    assert.equal(coffre.nom, 'coffre-2026-01-03-0000.zip');
    assert.equal(coffre.manifeste.projet, 'projet-des-tests', 'la référence est lue du manifeste : le mélange de projets s’y voit');
  });

  it('refuse une archive que le dossier ne connaît pas, et le dit', () => {
    assert.throws(() => charger('coffre-1900-01-01-0000.zip', TIROIR), /« --list » montre celles que le dossier connaît/);
  });
});
