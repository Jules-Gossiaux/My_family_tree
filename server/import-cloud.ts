import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH } from './config';

/**
 * Monte l'arbre local sur Postgres, puis ses fichiers dans le bucket privé.
 *
 * La base SQLite est ouverte en lecture seule : l'import ne doit pas pouvoir abîmer la seule
 * copie qui ne vit pas chez l'hébergeur. Tout est écrit en « merge-duplicates » sur la clef
 * primaire : relancer le script remet les mêmes lignes à jour au lieu d'en créer des secondes.
 */

const ADRESSE = process.env.VITE_SUPABASE_URL || lireEnv('VITE_SUPABASE_URL');
const SECRETE = process.env.SUPABASE_SECRET_KEY || lireEnv('SUPABASE_SECRET_KEY');

if (!ADRESSE || !SECRETE) {
  console.error("  Manque VITE_SUPABASE_URL ou SUPABASE_SECRET_KEY dans .env.local.");
  process.exit(1);
}

function lireEnv(nom: string): string {
  const fichier = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(fichier)) return '';
  for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const i = ligne.indexOf('=');
    if (i < 0 || ligne.slice(0, i).trim() !== nom) continue;
    return ligne.slice(i + 1).trim();
  }
  return '';
}

const CLES = { apikey: SECRETE, authorization: `Bearer ${SECRETE}` };

const sqlite = new Database(DB_PATH, { readonly: true });

async function requete(methode: string, chemin: string, corps?: BodyInit, entetes?: Record<string, string>): Promise<string> {
  const reponse = await fetch(ADRESSE + chemin, {
    method: methode,
    headers: { ...CLES, ...entetes },
    body: corps,
  });
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 400)}`);
  return texte;
}

function lignes<T = Record<string, unknown>>(table: string): T[] {
  return sqlite.prepare(`SELECT * FROM ${table}`).all() as T[];
}

async function lireJson<T>(chemin: string, demande?: { methode?: string; corps?: string }): Promise<T> {
  const reponse = await fetch(ADRESSE + chemin, {
    method: demande?.methode ?? 'GET',
    headers: { ...CLES, 'content-type': 'application/json' },
    body: demande?.corps,
  });
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`${chemin} → ${reponse.status} ${texte.slice(0, 400)}`);
  return JSON.parse(texte) as T;
}

/**
 * Le dossier « medias/ » du disque porte le nom du bucket : la clé de l'objet s'arrête là où
 * commence le bucket. Les deux mondes restent reliés, un tirage hebdomadaire n'a qu'à rendre le
 * préfixe pour retrouver le chemin local.
 */
function cleStorage(cheminLocal: string): string {
  return cheminLocal.replace(/^medias\//, '');
}

async function inserer(table: string, rangs: Record<string, unknown>[], clef?: string[]): Promise<void> {
  if (!rangs.length) return;
  const conflit = clef ? `?on_conflict=${clef.join(',')}` : '';
  await requete('POST', `/rest/v1/${table}${conflit}`, JSON.stringify(rangs), {
    'content-type': 'application/json',
    prefer: 'return=minimal, resolution=merge-duplicates',
  });
}

/**
 * Une table, dans l'ordre où ses clefs étrangères peuvent être satisfaites.
 * « differe » nomme les colonnes qui renvoient à une table insérée après : elles partent à NULL
 * et sont rendues une fois la référence en place. Personne et branche s'ont ainsi l'une l'autre.
 */
const ORDRE: { table: string; clef?: string[]; differe?: string[] }[] = [
  { table: 'person', differe: ['branch_id'] },
  { table: 'branch' },
  { table: 'name_variant' },
  { table: 'place', differe: ['parent_place_id'] },
  { table: 'couple' },
  { table: 'parent_child' },
  { table: 'event' },
  { table: 'media' },
  { table: 'media_person', clef: ['media_id', 'person_id'] },
  { table: 'media_event', clef: ['media_id', 'event_id'] },
  { table: 'note' },
  { table: 'source' },
];

const media = lignes<{ id: string; kind: string; mime: string | null; original_path: string; thumb_path: string | null }>('media');

// Les fichiers montent d'abord : une ligne dont l'objet n'est pas là serait un media sans image.
let octets = 0;
for (const ligne of media) {
  for (const colonne of ['original_path', 'thumb_path'] as const) {
    const cheminLocal = ligne[colonne];
    if (!cheminLocal) continue;
    const fichier = path.join(DATA_DIR, ...cheminLocal.split('/'));
    if (!fs.existsSync(fichier)) throw new Error(`media ${ligne.id} : fichier absent ${cheminLocal}`);
    const corps = fs.readFileSync(fichier);
    await requete('POST', `/storage/v1/object/medias/${cleStorage(cheminLocal)}`, corps, {
      'content-type': ligne.mime ?? 'application/octet-stream',
      'x-upsert': 'true',
    });
    octets += corps.length;
  }
  console.log(`  media ${ligne.id.slice(0, 8)}  ${ligne.original_path}`);
}

for (const { table, clef, differe } of ORDRE) {
  const rangs = lignes(table);
  const enAttente: { id: string; correctif: Record<string, unknown> }[] = [];

  for (const rang of rangs) {
    // SQLite ne connait pas le booleen : 0 et 1 deviennent vrai et faux.
    if (table === 'person') rang.living = Boolean(rang.living);
    if (table === 'media') {
      if (rang.original_path) rang.original_path = cleStorage(String(rang.original_path));
      if (rang.thumb_path) rang.thumb_path = cleStorage(String(rang.thumb_path));
    }
    for (const colonne of differe ?? []) {
      const valeur = rang[colonne];
      if (valeur == null) continue;
      enAttente.push({ id: String(rang.id), correctif: { [colonne]: valeur } });
      rang[colonne] = null;
    }
  }

  await inserer(table, rangs, clef);
  for (const { id, correctif } of enAttente) {
    await requete('PATCH', `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, JSON.stringify(correctif), {
      'content-type': 'application/json',
      prefer: 'return=minimal',
    });
  }
  if (rangs.length) console.log(`  ${table.padEnd(13)} ${rangs.length} ligne(s)${enAttente.length ? ` (${enAttente.length} ref. différée(s))` : ''}`);
}

// La souche de l'arbre est un réglage global : il vivait dans config.json, il rejoint tree_setting.
const reglages = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8')) as { rootPersonId?: string };
if (reglages.rootPersonId) {
  await inserer('tree_setting', [
    { id: 1, root_person_id: reglages.rootPersonId, updated_at: new Date().toISOString() },
  ]);
  console.log(`  tree_setting    racine ${reglages.rootPersonId}`);
}

/*
 * Contrôles : ce que répond Postgres doit peser ce que dit SQLite, et un objet rangé dans le
 * bucket doit redescendre par une URL signée exactement tel qu'il est monté. Sans cela, un
 * import vert n'est qu'un script qui n'a pas planté.
 */
const ecarts: string[] = [];

for (const { table, clef } of ORDRE) {
  // « id » n'existe pas partout : les tables de jointure ont une clef composite.
  const colonne = clef?.[0] ?? 'id';
  const local = (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const distant = (await lireJson<unknown[]>(`/rest/v1/${table}?select=${colonne}&limit=5000`)).length;
  if (local !== distant) ecarts.push(`${table} : ${local} en local, ${distant} en ligne`);
  if (local) console.log(`  vérifié ${table.padEnd(13)} ${local}/${distant}`);
}

const racineEnLigne = await lireJson<{ root_person_id: string | null }[]>(`/rest/v1/tree_setting?id=eq.1&select=root_person_id`);
if (reglages.rootPersonId && racineEnLigne[0]?.root_person_id !== reglages.rootPersonId) {
  ecarts.push('tree_setting : la racine en ligne n’est pas celle du réglage local');
}

let octetsRedescendus = 0;
for (const ligne of media) {
  for (const colonne of ['original_path', 'thumb_path'] as const) {
    const cheminLocal = ligne[colonne];
    if (!cheminLocal) continue;
    const cle = cleStorage(cheminLocal);
    const { signedURL } = await lireJson<{ signedURL: string }>(
      `/storage/v1/object/sign/medias/${cle}`,
      { methode: 'POST', corps: JSON.stringify({ expiresIn: 60 }) },
    );
    // L'API renvoie un chemin relatif à « /storage/v1 », pas à la racine du domaine.
    const adresse = signedURL.startsWith('http') ? signedURL : `${ADRESSE}/storage/v1${signedURL}`;
    const reponse = await fetch(adresse);
    if (!reponse.ok) throw new Error(`URL signée refusee pour ${cle} : ${reponse.status}`);
    const distant = await reponse.arrayBuffer();
    const local = fs.statSync(path.join(DATA_DIR, ...cheminLocal.split('/'))).size;
    if (distant.byteLength !== local) ecarts.push(`${cle} : ${local} octets ici, ${distant.byteLength} en ligne`);
    octetsRedescendus += distant.byteLength;
  }
}

sqlite.close();

console.log('');
console.log(`  Médias : ${(octets / 1048576).toFixed(1)} Mo montés, ${(octetsRedescendus / 1048576).toFixed(1)} Mo redescendus par URL signée.`);

if (ecarts.length) {
  console.error('');
  for (const ecart of ecarts) console.error('  ÉCART —', ecart);
  console.error('');
  process.exit(1);
}

console.log('  Tout correspond.');
console.log('');
