import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { DATA_DIR } from './config';
import { ADRESSE, BUCKET, SECRETE, annoncerAbsenceDeClef, appeler, compter, json, reference } from './cloud';

/**
 * Rouvre un coffre : la base en ligne et le bucket redeviennent ce que l'archive avait trouvé.
 *
 * C'est le seul script du projet qui écrit dans la base en ligne, alors il ouvre trois portes et la
 * plus dangereuse est la dernière :
 *
 *   --list                        ce que le dossier des sauvegardes contient ;
 *   --verifier <archive>          lit l'archive et la compare à la base, sans rien toucher ;
 *   --retablir <archive>          écrit. Un coffre de ce qui est en place est pris avant, les
 *                                 empreintes du manifeste sont contrôlées avant, et une base déjà
 *                                 peuplée refuse qu'on la couvre sans un « --remplacer » explicite.
 *
 * L'ordre des tables n'est pas un goût : les clés étrangères l'imposent. Personne et branche se
 * réclament l'une l'autre, le lieu s'appelle lui-même — ces colonnes partent à null et reviennent
 * par correctif une fois la référence en place.
 */

export type Rang = Record<string, unknown>;

export interface EnteteTable {
  lignes: number;
  octets: number;
  sha256: string;
}

export interface EnteteMedia {
  cle: string;
  octets: number;
  sha256: string;
}

export interface Manifeste {
  projet: string;
  horodatage: string;
  tables: Record<string, EnteteTable>;
  medias: EnteteMedia[];
  orphelins: string[];
  ecarts: string[];
}

export interface Coffre {
  nom: string;
  chemin: string;
  taille: number;
  manifeste: Manifeste;
  tables: Map<string, Rang[]>;
  octets: Map<string, Buffer>;
  /** Ce qui ne peut pas être rattrapé : archive abîmée, trou dans le manifeste. */
  soucis: string[];
}

export const NOM_D_ARCHIVES = 'coffre-';

const sha256 = (octets: Buffer): string => crypto.createHash('sha256').update(octets).digest('hex');

function option(nom: string): string {
  const i = process.argv.indexOf(nom);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
}

function present(nom: string): boolean {
  return process.argv.includes(nom);
}

export function archives(dossier: string): { nom: string; chemin: string; taille: number; date: string }[] {
  if (!fs.existsSync(dossier)) return [];
  return fs
    .readdirSync(dossier)
    .filter((f) => f.startsWith(NOM_D_ARCHIVES) && f.endsWith('.zip'))
    .map((f) => {
      const chemin = path.join(dossier, f);
      const statut = fs.statSync(chemin);
      return { nom: f, chemin, taille: statut.size, date: statut.mtime.toISOString() };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Lecture intégrale : une archive de coffre fait quelques dizaines de Mo, et un rejeu qui échoue à
 * mi-chemin parce qu'un fichier manquait au vingt-troisième téléchargement est un rejeu à recommencer.
 *
 * Chaque ligne et chaque octet sont pesés contre le manifeste pendant la lecture : une archive qui a
 * bougé depuis le jour où elle a été écrite se fait connaître ici, pas après la vidange.
 */
export function charger(nomOuChemin: string, dossier: string): Coffre {
  const chemin = path.isAbsolute(nomOuChemin) ? nomOuChemin : path.join(dossier, nomOuChemin);
  if (!fs.existsSync(chemin)) {
    throw new Error(`Aucune archive à ce chemin : ${chemin}\n  « --list » montre celles que le dossier connaît.`);
  }
  const zip = new AdmZip(chemin);
  const entrees = new Map(zip.getEntries().map((e) => [e.entryName, e]));
  const feuille = entrees.get('manifeste.json');
  if (!feuille) throw new Error(`${path.basename(chemin)} : pas de manifeste.json — ce n'est pas un coffre écrit par server/coffre.ts.`);

  const manifeste = JSON.parse(feuille.getData().toString('utf8')) as Manifeste;
  const soucis: string[] = [];
  const tables = new Map<string, Rang[]>();
  const octets = new Map<string, Buffer>();

  for (const [nom, entete] of Object.entries(manifeste.tables)) {
    const entree = entrees.get(`tables/${nom}.json`);
    if (!entree) {
      soucis.push(`${nom} : le manifeste la compte, l'archive ne la contient pas`);
      continue;
    }
    const corps = entree.getData();
    const empreinte = sha256(corps);
    if (empreinte !== entete.sha256) {
      soucis.push(`${nom} : l'archive est abîmée (empreinte ${empreinte.slice(0, 12)}…, attendue ${entete.sha256.slice(0, 12)}…)`);
    }
    const rangs = JSON.parse(corps.toString('utf8')) as Rang[];
    if (rangs.length !== entete.lignes) {
      soucis.push(`${nom} : ${rangs.length} ligne(s) dans l'archive, le manifeste en annonce ${entete.lignes}`);
    }
    tables.set(nom, rangs);
  }

  for (const cle of entrees.keys()) {
    if (cle.startsWith('tables/') && !(cle.slice(7, -5) in manifeste.tables)) {
      soucis.push(`${cle} : une table dans l'archive que le manifeste ne nomme pas`);
    }
  }

  for (const entete of manifeste.medias) {
    const entree = entrees.get(`medias/${entete.cle}`);
    if (!entree) {
      soucis.push(`${entete.cle} : le manifeste le compte, l'archive ne le contient pas`);
      continue;
    }
    const corps = entree.getData();
    if (corps.length !== entete.octets) {
      soucis.push(`${entete.cle} : ${corps.length} octets dans l'archive, ${entete.octets} annoncés`);
    } else if (sha256(corps) !== entete.sha256) {
      soucis.push(`${entete.cle} : l'archive est abîmée, l'empreinte ne correspond plus`);
    }
    octets.set(entete.cle, corps);
  }

  return { nom: path.basename(chemin), chemin, taille: fs.statSync(chemin).size, manifeste, tables, octets, soucis };
}

/** Ce que la base en ligne dit, comparé à ce que l'archive dit. Ne touche rien. */
export async function confronter(coffre: Coffre): Promise<{ table: string; archive: number; enLigne: number }[]> {
  const lignes: { table: string; archive: number; enLigne: number }[] = [];
  for (const [nom, entete] of Object.entries(coffre.manifeste.tables).sort((a, b) => a[0].localeCompare(b[0]))) {
    lignes.push({ table: nom, archive: entete.lignes, enLigne: await compter(nom) });
  }
  return lignes;
}

/** Un objet est-il dans le bucket, à la taille près ? Un HEAD suffit : la tête porte le poids. */
async function absentDuBucket(cle: string, attendu: number): Promise<string | null> {
  const chemin = cle.split('/').map(encodeURIComponent).join('/');
  const reponse = await fetch(`${ADRESSE}/storage/v1/object/authenticated/${BUCKET}/${chemin}`, {
    method: 'HEAD',
    headers: { apikey: SECRETE, authorization: `Bearer ${SECRETE}` },
  });
  if (!reponse.ok) return cle;
  const taille = Number(reponse.headers.get('content-length') ?? NaN);
  return taille === attendu ? null : `${cle} (${taille} octets en ligne, ${attendu} dans l'archive)`;
}

const ORDRE: { table: string; clef?: string[]; differe?: string[] }[] = [
  { table: 'place', differe: ['parent_place_id'] },
  { table: 'person', differe: ['branch_id'] },
  { table: 'branch' },
  { table: 'couple' },
  { table: 'parent_child' },
  { table: 'event' },
  { table: 'media' },
  { table: 'media_person', clef: ['media_id', 'person_id'] },
  { table: 'media_event', clef: ['media_id', 'event_id'] },
  { table: 'name_variant' },
  { table: 'note' },
  { table: 'source' },
  { table: 'family_member' },
  { table: 'tree_setting' },
];

const MIME = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.gif', 'image/gif'],
  ['.pdf', 'application/pdf'],
]);

function mimesDuCoffre(coffre: Coffre): Map<string, string> {
  const parCle = new Map<string, string>();
  for (const rang of coffre.tables.get('media') ?? []) {
    const mime = rang.mime ? String(rang.mime) : '';
    for (const colonne of ['original_path', 'thumb_path'] as const) {
      const cle = rang[colonne];
      if (cle) parCle.set(String(cle), mime);
    }
  }
  return parCle;
}

/** Les tables de l'archive, dans l'ordre où poser leurs lignes a une chance de passer les clés. */
export function ordreDePose(coffre: Coffre): { table: string; clef?: string[]; differe?: string[] }[] {
  const connues = new Set(Object.keys(coffre.manifeste.tables));
  const plan = ORDRE.filter((e) => connues.has(e.table));
  const oubliees = [...connues].filter((nom) => !ORDRE.some((e) => e.table === nom)).sort();
  return [...plan, ...oubliees.map((table) => ({ table }))];
}

async function inserer(nom: string, rangs: Rang[], clef?: string[]): Promise<void> {
  if (!rangs.length) return;
  const conflit = clef ? `?on_conflict=${clef.join(',')}` : '';
  await appeler('POST', `/rest/v1/${nom}${conflit}`, JSON.stringify(rangs), {
    'content-type': 'application/json',
    prefer: 'return=minimal, resolution=merge-duplicates',
  });
}

/**
 * Vider une table : PostgREST refuse un DELETE sans filtre, alors on cible une colonne qui ne peut
 * pas être vide — la première des lignes de l'archive, clef primaire en général. Ce qui survivrait à
 * cette suppression est une erreur, pas un reste : la vidange doit être totale avant la pose.
 */
async function vider(nom: string, rangs: Rang[]): Promise<void> {
  const avant = await compter(nom);
  if (!avant) return;
  const sonde = rangs[0] ?? (await json<Rang[]>(`/rest/v1/${nom}?select=*&limit=1`))[0];
  const colonne = Object.keys(sonde ?? {})[0];
  if (!colonne) throw new Error(`${nom} : aucune colonne pour cibler la vidange`);
  await appeler('DELETE', `/rest/v1/${nom}?${encodeURIComponent(colonne)}=not.is.null`);
  const reste = await compter(nom);
  if (reste) throw new Error(`${nom} : ${reste} ligne(s) sur ${avant} ont survécu à la vidange par ${colonne}`);
  console.log(`  vidé ${nom.padEnd(14)} ${avant} ligne(s)`);
}

function deposerFichier(cle: string, corps: Buffer, mime: string): Promise<Response> {
  const chemin = cle.split('/').map(encodeURIComponent).join('/');
  return appeler('POST', `/storage/v1/object/${BUCKET}/${chemin}`, new Uint8Array(corps), {
    'content-type': mime || 'application/octet-stream',
    'x-upsert': 'true',
  });
}

/** Le coffre de ce qui est en ligne avant d'y toucher, pris par le script qui sait le faire. */
function filetDeSecurite(): string {
  console.log('  Un coffre de la base telle qu’elle est avant de la toucher…');
  console.log('');
  const fils = spawnSync('npm run coffre', { stdio: 'inherit', shell: true });
  if (fils.status !== 0) throw new Error('le coffre de sécurité a échoué : rien n’est écrit. (« --sans-filet » pour passer outre)');
  const dernier = archives(path.join(DATA_DIR, 'sauvegardes'))[0];
  if (!dernier) throw new Error('le coffre de sécurité n’a rien laissé dans le dossier : rien n’est écrit.');
  console.log('');
  console.log(`  Filet : ${dernier.nom}`);
  console.log('');
  return dernier.nom;
}

/* ------------------------------------------------------------------ la ligne de commande */

async function main(): Promise<number> {
  if (!ADRESSE || !SECRETE) {
    annoncerAbsenceDeClef();
    return 1;
  }

  const dossier = option('--dossier') ? path.resolve(option('--dossier')) : path.join(DATA_DIR, 'sauvegardes');
  const refEnLigne = reference();

  if (present('--list')) {
    const liste = archives(dossier);
    console.log('');
    if (!liste.length) console.log(`  Aucun coffre dans ${dossier}.`);
    else {
      console.log(`  Coffres de ${dossier}`);
      console.log('');
      for (const une of liste) {
        const zip = new AdmZip(une.chemin);
        const feuille = zip.getEntry('manifeste.json');
        if (!feuille) {
          console.log(`  ${une.nom}  ${(une.taille / 1048576).toFixed(1)} Mo   SANS MANIFESTE`);
          continue;
        }
        const m = JSON.parse(feuille.getData().toString('utf8')) as Manifeste;
        const lignes = Object.values(m.tables).reduce((a, t) => a + t.lignes, 0);
        console.log(
          `  ${une.nom}  ${((une.taille / 1048576).toFixed(1)).padStart(6)} Mo` +
            `  ${String(lignes).padStart(4)} ligne(s)  ${String(m.medias.length).padStart(3)} fichier(s)` +
            `  ${m.projet === refEnLigne ? 'ce projet' : `projet ${m.projet}`}` +
            `${m.ecarts.length ? `  ${m.ecarts.length} écart(s) à la naissance` : ''}`,
        );
      }
    }
    console.log('');
    console.log('  --verifier <archive>  contrôle l’archive et la compare à la base, sans rien toucher.');
    console.log('  --retablir <archive>  remplit la base et le bucket. Écrit, donc : la dernière porte.');
    console.log('');
    return 0;
  }

  if (!option('--verifier') && !option('--retablir')) {
    console.log('');
    console.log('  Rouvrir un coffre, c’est choisir une des trois portes :');
    console.log('');
    console.log('      npm run ouvrir-coffre -- --list');
    console.log('      npm run ouvrir-coffre -- --verifier coffre-2026-11-04-2121.zip');
    console.log('      npm run ouvrir-coffre -- --retablir coffre-2026-11-04-2121.zip');
    console.log('');
    console.log('  « --retablir » écrit dans la base en ligne : il prend un coffre avant, et refuse');
    console.log('  une base déjà peuplée sans un « --remplacer » explicite.');
    console.log('');
    return 0;
  }

  const retablir = present('--retablir');
  const coffre = charger(retablir ? option('--retablir') : option('--verifier'), dossier);

  console.log('');
  console.log(`  ${coffre.nom}  (${(coffre.taille / 1048576).toFixed(1)} Mo, écrit le ${coffre.manifeste.horodatage.slice(0, 16).replace('T', ' ')} pour le projet ${coffre.manifeste.projet})`);
  console.log('');

  if (coffre.manifeste.projet !== refEnLigne) {
    console.log(`  ⚠ Cette archive vient du projet « ${coffre.manifeste.projet} », la base en ligne est « ${refEnLigne} ».`);
    console.log('    Les comptes invités (family_member) ne désigneraient plus les bonnes personnes.');
    if (!present('--quand-meme')) {
      console.log('');
      console.log('  On s’arrête là. « --quand-meme » assume le mélange.');
      console.log('');
      return 1;
    }
    console.log('    « --quand-meme » : on continue, à ta demande.');
    console.log('');
  }

  if (coffre.manifeste.ecarts.length) {
    console.log(`  ${coffre.manifeste.ecarts.length} écart(s) déjà signalés le jour où ce coffre a été écrit :`);
    for (const ecart of coffre.manifeste.ecarts) console.log('    ' + ecart);
    console.log('');
  }

  if (coffre.soucis.length) {
    console.error('  ARCHIVE EN CAUSE — elle ne sera pas reposée :');
    for (const souci of coffre.soucis) console.error('    ' + souci);
    console.error('');
    return 1;
  }

  console.log(`  Archive : ${Object.keys(coffre.manifeste.tables).length} tables relues, ${coffre.octets.size} fichier(s) vérifié(s) empreinte par empreinte.`);
  console.log('');
  console.log('  Table           archive   en ligne');
  const comparaison = await confronter(coffre);
  const diffs = comparaison.filter((l) => l.archive !== l.enLigne);
  for (const ligne of comparaison) {
    console.log(`  ${ligne.table.padEnd(15)} ${String(ligne.archive).padStart(7)}   ${String(ligne.enLigne).padStart(7)}${ligne.archive === ligne.enLigne ? '' : '   ≠'}`);
  }

  console.log('');
  const manquants: string[] = [];
  for (const entete of coffre.manifeste.medias) {
    const absent = await absentDuBucket(entete.cle, entete.octets);
    if (absent) manquants.push(absent);
  }
  console.log(`  Fichiers : ${coffre.manifeste.medias.length - manquants.length}/${coffre.manifeste.medias.length} déjà dans le bucket.`);
  for (const un of manquants) console.log(`    qui manqueront — ${un}`);
  console.log('');

  if (!retablir) {
    console.log(`  Rien n’a été touché. « --retablir ${coffre.nom} » pour que cela devienne la base.`);
    console.log('');
    if (diffs.length) console.log(`  ${diffs.length} table(s) différent de l’archive.`);
    console.log('');
    return diffs.length ? 2 : 0;
  }

  const enLigne = comparaison.reduce((a, l) => a + l.enLigne, 0);
  const filet = present('--sans-filet') ? '(aucun : --sans-filet)' : filetDeSecurite();

  if (enLigne && !present('--remplacer')) {
    console.error('');
    console.error(`  La base en ligne a ${enLigne} ligne(s) : un rejeu n'est pas un ajout.`);
    console.error(`  « --retablir ${coffre.nom} --remplacer » pour décider de la couvrir — le filet est déjà pris : ${filet}`);
    console.error('');
    return 1;
  }

  /*
   * Une vidange qui échoue à la septième table laisse une base à moitié vide, et ce n'est pas une
   * raison de se taire : le nom du coffre qui précède est la réponse à « et maintenant ? ».
   */
  try {
    if (present('--remplacer')) {
      console.log('  Vidange, des enfants vers les parents :');
      for (const etape of [...ordreDePose(coffre)].reverse()) await vider(etape.table, coffre.tables.get(etape.table) ?? []);
      console.log('');
    }

    const mimes = mimesDuCoffre(coffre);
    console.log('  Les fichiers d’abord, pour qu’aucune ligne n’annonce une image absente :');
    for (const [cle, corps] of [...coffre.octets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      await deposerFichier(cle, corps, mimes.get(cle) ?? MIME.get(path.extname(cle).toLowerCase()) ?? 'application/octet-stream');
    }
    console.log(`  ${coffre.octets.size} objet(s) déposé(s) dans « ${BUCKET} ».`);
    console.log('');

    console.log('  Les lignes, dans l’ordre que les clés étrangères imposent :');
    for (const { table, clef, differe } of ordreDePose(coffre)) {
      const rangs = coffre.tables.get(table) ?? [];
      const enAttente: { id: string; correctif: Record<string, unknown> }[] = [];
      for (const rang of rangs) {
        for (const colonne of differe ?? []) {
          if (rang[colonne] == null) continue;
          enAttente.push({ id: String(rang.id), correctif: { [colonne]: rang[colonne] } });
          rang[colonne] = null;
        }
      }
      await inserer(table, rangs, clef);
      for (const { id, correctif } of enAttente) {
        await appeler('PATCH', `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, JSON.stringify(correctif), {
          'content-type': 'application/json',
          prefer: 'return=minimal',
        });
      }
      if (rangs.length) {
        console.log(`  ${table.padEnd(14)} ${String(rangs.length).padStart(5)} ligne(s)${enAttente.length ? ` (${enAttente.length} réf. différée(s))` : ''}`);
      }
    }

    console.log('');
    console.log('  Contrôle de ce qui est en place :');
    const apres = await confronter(coffre);
    const ecarts = apres.filter((l) => l.archive !== l.enLigne).map((l) => `${l.table} : ${l.enLigne} en ligne, ${l.archive} dans l’archive`);
    for (const entete of coffre.manifeste.medias) {
      const absent = await absentDuBucket(entete.cle, entete.octets);
      if (absent) ecarts.push(`objet ${absent}`);
    }

    const arbre = await appeler('POST', '/rest/v1/rpc/graph_json', JSON.stringify({}), {
      'content-type': 'application/json',
    }).then((r) => r.json() as Promise<{ persons?: unknown[]; couples?: unknown[] }>);
    console.log(`  L’arbre se relit : ${(arbre.persons ?? []).length} personne(s), ${(arbre.couples ?? []).length} couple(s).`);

    if (ecarts.length) {
      console.error('');
      for (const ecart of ecarts) console.error('  ÉCART —', ecart);
      console.error('');
      console.error('  La base n’est pas ce que l’archive promettait. Le rejeu peut être relancé : les');
      console.error(`  lignes se reposent sur la clef primaire. Filet : ${filet}`);
      console.error('');
      return 1;
    }

    console.log('');
    console.log('  La base en ligne est ce que l’archive disait.');
    console.log('');
    return 0;
  } catch (erreur) {
    const texte = erreur instanceof Error ? erreur.message : String(erreur);
    console.error('');
    console.error('  INTERROMPU —', texte);
    console.error('');
    console.error('  La base en ligne est peut-être à moitié vide ou à moitié remplie. Deux issues :');
    console.error('    1. relancer la même commande : les lignes se reposent sur la clef primaire ;');
    console.error(`    2. reposer le coffre de la base telle qu'elle était avant : ${filet}`);
    console.error('');
    return 1;
  }
}

// Le module s'importe tel quel dans les tests et ne se joue qu'à la ligne de commande.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
