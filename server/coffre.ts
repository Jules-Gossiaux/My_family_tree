import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { DATA_DIR } from './config';

/**
 * Descend l'arbre du cloud sur le disque : chaque table en JSON, chaque objet du bucket privé, le
 * tout dans une archive datée.
 *
 * Le sens importe : depuis que Postgres est la source de vérité, la seule copie qui ne vit pas chez
 * l'hébergeur est celle-ci. Rien ici n'écrit vers le cloud, et rien ne supprime : une archive de
 * trop ne coûte que de la place, une archive de moins coûte des ancêtres.
 *
 * Le compte n'est pas cru : la base annonce combien de lignes elle a, on les redemande page par
 * page, et ce qui manque à l'appel est une erreur. Un coffre incomplet qui se dit réussi est le
 * pire des coffres.
 */

const ADRESSE = process.env.VITE_SUPABASE_URL || lireEnv('VITE_SUPABASE_URL');
const SECRETE = process.env.SUPABASE_SECRET_KEY || lireEnv('SUPABASE_SECRET_KEY');

const BUCKET = 'medias';
const PAGE = 100;
const PAR_PAGE_DE_REPERTOIRE = 1000;

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

function option(nom: string): string {
  const i = process.argv.indexOf(nom);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-')
    + '-' + [pad(now.getHours()), pad(now.getMinutes())].join('');
}

const CLES = { apikey: SECRETE, authorization: `Bearer ${SECRETE}` };

// « --sortie » sert au premier essai : on écrit dans un tiroir avant de ranger chez soi.
const DOSSIER = option('--sortie') ? path.resolve(option('--sortie')) : path.join(DATA_DIR, 'sauvegardes');

/*
 * Le coffre se remplit sans personne devant l'écran, le dimanche : ce qu'il a vu doit rester écrit
 * à côté des archives. Une sauvegarde que personne ne regarde et qui a échoué en silence n'est pas
 * une sauvegarde, c'est une habitude.
 */
let consigne = '(aucune archive écrite)';

function journal(ligne: string): void {
  consigne = ligne;
}

process.on('exit', (code) => {
  try {
    fs.appendFileSync(
      path.join(DOSSIER, 'coffre.log'),
      `[${new Date().toISOString()}] ${consigne}${code === 0 ? '' : ` — code ${code}`}\n`,
      'utf8',
    );
  } catch {
    /* pas de journal sans dossier : le message reste sur la console */
  }
});

function planter(erreur: unknown): void {
  const texte = erreur instanceof Error ? erreur.message : String(erreur);
  console.error(erreur instanceof Error ? erreur.stack : texte);
  journal(`ÉCHEC — ${texte.slice(0, 300)}`);
  process.exit(1);
}

process.on('uncaughtException', planter);
process.on('unhandledRejection', planter);

if (!ADRESSE || !SECRETE) {
  console.error('  Manque VITE_SUPABASE_URL ou SUPABASE_SECRET_KEY dans .env.local.');
  journal('ECHEC — manque VITE_SUPABASE_URL ou SUPABASE_SECRET_KEY dans .env.local');
  process.exit(1);
}

const REF = new URL(ADRESSE).hostname.split('.')[0];

async function appeler(
  methode: string,
  chemin: string,
  corps?: BodyInit,
  entetes?: Record<string, string>,
): Promise<Response> {
  const reponse = await fetch(ADRESSE + chemin, {
    method: methode,
    headers: { ...CLES, ...entetes },
    body: corps,
  });
  if (!reponse.ok) {
    const texte = await reponse.text();
    throw new Error(`${methode} ${chemin} -> ${reponse.status} ${texte.slice(0, 400)}`);
  }
  return reponse;
}

async function json<T>(chemin: string): Promise<T> {
  const reponse = await appeler('GET', chemin, undefined, { accept: 'application/json' });
  return (await reponse.json()) as T;
}

/**
 * Les tables telles que PostgREST les expose : c'est la liste de ce que l'application lit, pas une
 * liste recopiée dans le script et promise à l'oubli.
 */
async function tables(): Promise<string[]> {
  const spec = await json<{ paths: Record<string, { get?: unknown }> }>('/rest/v1/');
  return Object.entries(spec.paths)
    .filter(([chemin, item]) => /^\/[a-z][a-z0-9_]*$/.test(chemin) && item.get)
    .map(([chemin]) => chemin.slice(1))
    .sort();
}

async function compter(nom: string): Promise<number> {
  const reponse = await appeler('GET', `/rest/v1/${nom}?select=*&limit=0`, undefined, {
    prefer: 'count=exact',
  });
  const enTete = reponse.headers.get('content-range') ?? '';
  const total = Number(enTete.split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`${nom} : comptage illisible (${enTete || 'en-tete absent'})`);
  return total;
}

type Rang = Record<string, unknown>;

/**
 * Une table entière. « order » reprend toutes les colonnes : deux lignes ne se ressemblent pas,
 * donc l'ordre ne dépend ni du moment ni de la page d'où l'on vient, et la même archive se refait
 * à l'identique.
 */
async function descendre(nom: string): Promise<Rang[]> {
  const total = await compter(nom);
  if (total === 0) return [];

  const un = await json<Rang[]>(`/rest/v1/${nom}?select=*&limit=1`);
  const ordre = Object.keys(un[0] ?? {})
    .map((colonne) => `${encodeURIComponent(colonne)}.asc`)
    .join(',');

  const rangs: Rang[] = [];
  for (let decalage = 0; decalage < total; decalage += PAGE) {
    const page = await json<Rang[]>(
      `/rest/v1/${nom}?select=*&order=${ordre}&limit=${PAGE}&offset=${decalage}`,
    );
    rangs.push(...page);
  }
  if (rangs.length !== total) {
    throw new Error(`${nom} : ${total} lignes annoncees, ${rangs.length} descendues`);
  }
  return rangs;
}

interface Entree {
  name: string;
  id: string | null;
}

/** Un « id » null dans la réponse de Storage designe un dossier : on y descend. */
async function parcourir(prefix: string): Promise<string[]> {
  const reponse = await appeler(
    'POST',
    `/storage/v1/object/list/${BUCKET}`,
    JSON.stringify({ prefix, limit: PAR_PAGE_DE_REPERTOIRE, sortBy: { column: 'name', order: 'asc' } }),
    { 'content-type': 'application/json' },
  );
  const entrees = (await reponse.json()) as Entree[];
  if (entrees.length >= PAR_PAGE_DE_REPERTOIRE) {
    throw new Error(`${BUCKET}/${prefix || 'racine'} : ${entrees.length} entrees d'un coup, le repertoire est trop grand pour une page`);
  }
  const cles: string[] = [];
  for (const entree of entrees) {
    const chemin = prefix + entree.name;
    if (entree.id === null) cles.push(...(await parcourir(chemin + '/')));
    else cles.push(chemin);
  }
  return cles;
}

async function telecharger(cle: string): Promise<Buffer> {
  const chemin = cle.split('/').map(encodeURIComponent).join('/');
  const reponse = await appeler('GET', `/storage/v1/object/authenticated/${BUCKET}/${chemin}`);
  return Buffer.from(await reponse.arrayBuffer());
}

const sha256 = (octets: Buffer): string => crypto.createHash('sha256').update(octets).digest('hex');

fs.mkdirSync(DOSSIER, { recursive: true });

const ecarts: string[] = [];
const archive = new AdmZip();

console.log('');
console.log(`  Coffre du projet ${REF}`);
console.log('');

/*
 * Les tables d'abord : leurs lignes disent quels fichiers le bucket doit contenir, et c'est ce
 * que dit la colonne sha256 qui sert de controle aux octets que l'on va chercher.
 */
const noms = await tables();
const etatDesTables: Record<string, { lignes: number; octets: number; sha256: string }> = {};
const toutesLesTables = new Map<string, Rang[]>();

for (const nom of noms) {
  const rangs = await descendre(nom);
  toutesLesTables.set(nom, rangs);
  const corps = JSON.stringify(rangs, null, 2);
  archive.addFile(`tables/${nom}.json`, Buffer.from(corps, 'utf8'));
  etatDesTables[nom] = { lignes: rangs.length, octets: Buffer.byteLength(corps), sha256: sha256(Buffer.from(corps)) };
  if (rangs.length) console.log(`  ${nom.padEnd(14)} ${String(rangs.length).padStart(5)} ligne(s)`);
}

const annonces = new Map<string, string>();
for (const rang of toutesLesTables.get('media') ?? []) {
  if (rang.original_path) annonces.set(String(rang.original_path), String(rang.sha256 ?? ''));
  if (rang.thumb_path) annonces.set(String(rang.thumb_path), '');
}

console.log('');

/*
 * Le bucket se vide lui-même, sans passer par la base : un objet que plus aucune ligne ne nomme
 * reste dans l'archive. Le trier est une décision du propriétaire des fichiers, pas d'une
 * sauvegarde.
 */
const cles = (await parcourir('')).sort();
const etatDesMedias: { cle: string; octets: number; sha256: string }[] = [];
const orphelins: string[] = [];
let poids = 0;

for (const cle of cles) {
  const octets = await telecharger(cle);
  archive.addFile(`medias/${cle}`, octets);
  const somme = sha256(octets);
  etatDesMedias.push({ cle, octets: octets.length, sha256: somme });
  poids += octets.length;

  const attendue = annonces.get(cle);
  if (attendue === undefined) orphelins.push(cle);
  else if (attendue && attendue !== somme) ecarts.push(`${cle} : la base annonce ${attendue.slice(0, 16)}…, l'objet porte ${somme.slice(0, 16)}…`);
  console.log(`  media ${(cle + ' ').padEnd(46)} ${(octets.length / 1024).toFixed(0)} Ko`);
}

for (const cle of annonces.keys()) {
  if (!cles.includes(cle)) ecarts.push(`${cle} : la base le compte, le bucket ne le connaît pas`);
}

const manifeste = {
  projet: REF,
  adresse: ADRESSE,
  horodatage: new Date().toISOString(),
  sens: 'cloud vers disque',
  tables: etatDesTables,
  medias: etatDesMedias,
  orphelins,
  ecarts,
};

archive.addFile('manifeste.json', Buffer.from(JSON.stringify(manifeste, null, 2), 'utf8'));
archive.addFile(
  'LISEZMOI.txt',
  Buffer.from(
    [
      'Coffre de l’arbre genealogique : copie du cloud sur ce disque.',
      '',
      `Projet : ${REF}   Date : ${new Date().toLocaleString('fr-BE')}`,
      '',
      'Contenu :',
      '  tables/<nom>.json  toutes les lignes de chaque table de Postgres, telles qu’elles sont en ligne',
      `  medias/            tous les objets du bucket « ${BUCKET} », dossiers et vignettes compris`,
      '  manifeste.json     comptes, poids et empreintes sha256 de tout ce qui precede',
      '',
      `Photos et documents : ${etatDesMedias.length} objet(s), ${(poids / 1048576).toFixed(1)} Mo.`,
      'Lignes :',
      ...Object.entries(etatDesTables).map(([nom, e]) => `  ${nom} : ${e.lignes}`),
      '',
      'Ce coffre ne remplace rien et n’efface rien : il constate. Les tables JSON et les fichiers',
      'suffisent à tout comprendre ; les rendre à une base, videe ou perdue, reste a ecrire.',
      '',
    ].join('\n'),
    'utf8',
  ),
);

const nom = `coffre-${stamp()}.zip`;
const cible = path.join(DOSSIER, nom);
const partiel = `${cible}.part`;
archive.writeZip(partiel);
fs.renameSync(partiel, cible);

const taille = fs.statSync(cible).size;
const voisins = fs.readdirSync(DOSSIER).filter((f) => f.startsWith('coffre-') && f.endsWith('.zip')).length;

console.log('');
console.log('  ' + '-'.repeat(58));
console.log(`  Archive : ${cible}`);
console.log(`  Taille  : ${(taille / 1048576).toFixed(1)} Mo   (${(poids / 1048576).toFixed(1)} Mo de fichiers, le reste en tables)`);
console.log(`  Coffres deja gardes dans ce dossier : ${voisins}. Rien n'a ete supprime.`);
console.log('  ' + '-'.repeat(58));

const resume = `${nom}  ${(taille / 1048576).toFixed(1)} Mo  ${Object.values(etatDesTables).reduce((a, t) => a + t.lignes, 0)} ligne(s)  ${etatDesMedias.length} objet(s)`;

if (orphelins.length) {
  console.log('');
  console.log(`  ${orphelins.length} objet(s) dans le bucket que plus aucune ligne ne nomme :`);
  for (const cle of orphelins) console.log('    ' + cle);
}

if (ecarts.length) {
  journal(`${resume}  ${ecarts.length} ECART(S) — ${ecarts[0]}`);
  console.error('');
  for (const ecart of ecarts) console.error('  ÉCART —', ecart);
  console.error('');
  process.exit(1);
}

journal(resume);
console.log('');
console.log('  Tout correspond.');
console.log('');
