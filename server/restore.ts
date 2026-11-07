import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';

type Row = Record<string, any>;

export interface Counts {
  persons: number;
  couples: number;
  events: number;
  media: number;
}

export interface ArchiveInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface RestoreOptions {
  /** Chemin de l'archive, ou son seul nom quand elle vit dans le dossier « sauvegardes ». */
  archive: string;
  dataDir: string;
  /** Passer la vérification « l'application est-elle ouverte ? ». */
  force?: boolean;
  port?: number;
  log?: (line: string) => void;
}

export interface RestoreSummary {
  archive: string;
  dataDir: string;
  /** Ce que contenait la base remplacée ; null si elle était absente ou illisible. */
  previous: Counts | null;
  /** Ce qui est en place après l'échange, compté sur le fichier posé. */
  restored: Counts;
  rootPersonId: string | null;
  rootWasRestored: boolean;
  mediasRestored: number;
  safetyArchive: string | null;
}

const DB_ENTRY = 'famille.db';
const CONFIG_ENTRY = 'config.json';
const MEDIA_FOLDER = 'medias';
const DEFAULT_PORT = 4321;

function stamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** Les archives écrites par l'application, de la plus récente à la plus ancienne. */
export function listArchives(dataDir: string): ArchiveInfo[] {
  const dir = path.join(dataDir, 'sauvegardes');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.zip'))
    .map((file) => {
      const stat = fs.statSync(path.join(dir, file));
      return { name: file, path: path.join(dir, file), size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Une base que l'on va poser : intégrité, tables, comptages. Une archive qui échoue ici n'est pas
 * une archive que l'on installe à la place de ce qui marche.
 */
function inspect(file: string): Counts {
  const base = new Database(file, { readonly: true });
  try {
    const check = base.prepare('PRAGMA integrity_check').get() as Row;
    const verdict = String(Object.values(check)[0]);
    if (verdict !== 'ok') {
      throw new Error(`la base est abîmée (contrôle d’intégrité : ${verdict})`);
    }
    const tables = new Set(
      (base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((row) => row.name),
    );
    if (!tables.has('person')) {
      throw new Error('ce n’est pas une base d’arbre de famille : la table « person » y manque');
    }
    const count = (table: string) =>
      tables.has(table) ? (base.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Row).n : 0;
    return { persons: count('person'), couples: count('couple'), events: count('event'), media: count('media') };
  } finally {
    base.close();
  }
}

/** Compter ce qu'une archive contiendrait, sans rien toucher d'autre qu'un fichier temporaire. */
export function archiveCounts(archive: string): Counts {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'arbre-controle-'));
  try {
    const file = extractDbEntry(archive, path.join(staging, DB_ENTRY));
    return inspect(file);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function extractDbEntry(archive: string, target: string): string {
  const entry = new AdmZip(archive).getEntry(DB_ENTRY);
  if (!entry) {
    throw new Error(
      `cette archive ne contient pas de base « ${DB_ENTRY} » : on ne restaure que les archives produites par l’application.`,
    );
  }
  fs.writeFileSync(target, entry.getData());
  return target;
}

/** Une connexion que quelqu'un accepte sur ce port = l'application est ouverte. */
function portIsAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(700);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Un nom d'archive suffit : c'est ce que l'écran Réglages et `--list` donnent à lire. */
function resolveArchive(name: string, dataDir: string): string {
  if (fs.existsSync(name)) return path.resolve(name);
  const bare = name.endsWith('.zip') ? name : `${name}.zip`;
  const inBackups = path.join(dataDir, 'sauvegardes', bare);
  if (fs.existsSync(inBackups)) return inBackups;
  throw new Error(
    `archive introuvable : « ${bare} » n’est ni un chemin qui existe, ni un fichier de ` +
      `${path.join(dataDir, 'sauvegardes')}.\n  La liste des archives se demande avec   npm run restore -- --list`,
  );
}

function writeZip(target: string, label: string, files: { entry: string; from: string }[]): void {
  const zip = new AdmZip();
  for (const file of files) zip.addLocalFile(file.from, '', file.entry);
  zip.addFile(
    'LISEZMOI.txt',
    Buffer.from(
      [
        `Archive ${label}.`,
        '',
        `Date : ${new Date().toLocaleString('fr-BE')}`,
        '',
        'Contenu :',
        ...files.map((file) => `  ${file.entry}`),
        '',
        'Restauration : double-cliquez restore.bat, ou npm run restore -- --list',
        '',
      ].join('\n'),
      'utf8',
    ),
  );
  // Écrit à côté puis renommé : une coupure laisse l'archive précédente, jamais une moitié.
  const partial = `${target}.part`;
  zip.writeZip(partial);
  fs.renameSync(partial, target);
}

/** Deux restaurations dans la même minute ne doivent pas effacer la copie de sûreté de la première. */
function uniqueName(dir: string, name: string): string {
  let candidate = name;
  for (const letter of 'bcdefghijklmnopqrstuvwxyz') {
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
    candidate = name.replace(/\.zip$/, `-${letter}.zip`);
  }
  return candidate;
}

/**
 * Copie de sûreté de l'état actuel, écrite avant d'y toucher. Elle ne prend ni les journaux WAL ni
 * les médias : la restauration n'efface aucune photo, il n'y a donc rien à en protéger.
 */
async function safetyArchive(dataDir: string, dbPath: string, log: (line: string) => void): Promise<string | null> {
  if (!fs.existsSync(dbPath)) return null;

  const dir = path.join(dataDir, 'sauvegardes');
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, `famille-${stamp()}-avant-restauration.zip`);
  const target = path.join(dir, name);
  const tempDb = path.join(dir, `.avant-${process.pid}-${Date.now()}.db`);

  const source = new Database(dbPath);
  try {
    await source.backup(tempDb);
  } finally {
    source.close();
  }

  const files = [{ entry: DB_ENTRY, from: tempDb }];
  const configPath = path.join(dataDir, CONFIG_ENTRY);
  if (fs.existsSync(configPath)) files.push({ entry: CONFIG_ENTRY, from: configPath });

  try {
    writeZip(target, 'prise avant restauration pour ne pas perdre ce qui est là', files);
    log(`  copie de sûreté : ${name}`);
    return target;
  } finally {
    fs.rmSync(tempDb, { force: true });
  }
}

/** Le nom d'une entrée d'archive ne doit jamais faire sortir l'écriture du dossier des médias. */
function inside(dir: string, relative: string): string | null {
  const target = path.resolve(dir, relative);
  return target === path.resolve(dir) || target.startsWith(path.resolve(dir) + path.sep) ? target : null;
}

/**
 * Les médias de l'archive sont ajoutés à ceux du dossier. Rien n'y est supprimé : une restauration
 * ramène les personnes et les photos que leur ligne réclame, pas un tri dans ce qui est venu depuis.
 */
function extractMedias(zip: AdmZip, dataDir: string, log: (line: string) => void): number {
  const dest = path.join(dataDir, MEDIA_FOLDER);
  const prefix = `${MEDIA_FOLDER}/`;
  let written = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const target = inside(dest, entry.entryName.slice(prefix.length));
    if (!target) {
      log(`  média ignoré, son nom sort du dossier : ${entry.entryName}`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    written += 1;
  }
  return written;
}

function readRootPerson(configPath: string): string | null {
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { rootPersonId?: unknown };
    return typeof parsed.rootPersonId === 'string' && parsed.rootPersonId ? parsed.rootPersonId : null;
  } catch {
    return null;
  }
}

function personExists(file: string, id: string): boolean {
  const base = new Database(file, { readonly: true });
  try {
    return Boolean(base.prepare('SELECT id FROM person WHERE id = ?').get(id));
  } finally {
    base.close();
  }
}

/**
 * Remet la base d'une archive à la place de celle du dossier de données.
 *
 * L'ordre est ce qui rend l'opération sûre : on extrait à côté, on contrôle ce que l'on va poser,
 * on copie ce que l'on va écraser, et seulement alors on échange les fichiers. Écraser d'abord et
 * découvrir après que l'archive était vide ou abîmée serait irréparable.
 */
export async function restore(options: RestoreOptions): Promise<RestoreSummary> {
  const log = options.log ?? ((line: string) => console.log(line));
  const dataDir = path.resolve(options.dataDir);
  const dbPath = path.join(dataDir, 'data', DB_ENTRY);
  const configPath = path.join(dataDir, CONFIG_ENTRY);

  if (!fs.existsSync(dataDir)) throw new Error(`le dossier de données n’existe pas : ${dataDir}`);

  const archive = resolveArchive(options.archive, dataDir);
  const zip = new AdmZip(archive);
  if (!zip.getEntry(DB_ENTRY)) {
    throw new Error(
      `cette archive ne contient pas de base « ${DB_ENTRY} » : on ne restaure que les archives produites par l’application.`,
    );
  }

  const port = options.port ?? (Number(process.env.PORT) || DEFAULT_PORT);
  if (!options.force && (await portIsAlive(port))) {
    throw new Error(
      `l’application est ouverte sur le port ${port}. Fermez-la avant de restaurer : remplacer une base pendant ` +
        'qu’un programme l’utilise produirait un arbre à moitié écrit. On ne prend ce risque qu’en connaissance ' +
        'de cause, avec --force, quand aucune fenêtre de l’arbre ne tourne.',
    );
  }

  // 1. Extraire à côté et contrôler : rien d'existant n'a encore été touché.
  const staging = path.join(dataDir, 'data', `.restauration-${process.pid}-${Date.now()}.tmp.db`);
  // Ouvrir ne serait-ce qu'en lecture une base en mode WAL laisse des journaux à côté d'elle.
  // Ceux du fichier de contrôle portent un nom que plus rien ne relira : ils repartent avec lui.
  const discardStaging = () => {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${staging}${suffix}`, { force: true });
  };
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  fs.writeFileSync(staging, zip.getEntry(DB_ENTRY)!.getData());

  try {
    inspect(staging);
  } catch (error) {
    discardStaging();
    throw new Error(`archive refusée : ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Noter ce qui est en place : pour le dire à l'écran, et pour savoir s'il faut l'écarter.
  let previous: Counts | null = null;
  if (fs.existsSync(dbPath)) {
    try {
      previous = inspect(dbPath);
    } catch {
      log('  la base en place est illisible — c’est peut-être précisément pour cela qu’on restaure.');
    }
  }

  // 3. Copier ce qui va être écrasé.
  const safety = await safetyArchive(dataDir, dbPath, log);

  // 4. Échanger. Renommer plutôt qu'écrire par-dessus : sous Windows l'ancien fichier reste
  // accessible jusqu'au renommage suivant, donc une coupure ne laisse jamais deux moitiés de base.
  const pending = `${dbPath}.avant`;
  if (fs.existsSync(dbPath)) {
    // Une restauration coupée en route laisse ce nom occupé, et Windows refuse de poser un
    // fichier sur un fichier qui existe déjà : on l'écarte avant de s'en servir.
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${pending}${suffix}`, { force: true });
    fs.renameSync(dbPath, pending);
    try {
      fs.renameSync(staging, dbPath);
    } catch (error) {
      fs.renameSync(pending, dbPath);
      throw new Error(`échange annulé, la base précédente est remise en place : ${String(error)}`);
    }
    fs.rmSync(pending, { force: true });
  } else {
    fs.renameSync(staging, dbPath);
  }

  // Les journaux appartiennent à la base qui n'est plus là ; les laisser ferait relire l'ancienne.
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  discardStaging();

  // 5. Les réglages voyagent avec l'archive qui les contient.
  const configEntry = zip.getEntry(CONFIG_ENTRY);
  if (configEntry) fs.writeFileSync(configPath, configEntry.getData());

  const mediasRestored = extractMedias(zip, dataDir, log);

  // 6. Relire ce qui est en place : on n'annonce une réussite que sur un fichier vérifié.
  const restored = inspect(dbPath);
  let rootPersonId = readRootPerson(configPath);
  let rootWasRestored = Boolean(configEntry);
  if (rootPersonId && !personExists(dbPath, rootPersonId)) {
    log("  attention : la personne de référence de l’archive n’est pas dans cette base, elle est à choisir dans Réglages.");
    rootPersonId = null;
    rootWasRestored = false;
  }

  return { archive, dataDir, previous, restored, rootPersonId, rootWasRestored, mediasRestored, safetyArchive: safety };
}

/** `--nom=valeur` et `--nom valeur` se valent : la seconde forme est celle que l'on tape. */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[index]);
    if (!match) continue;
    if (match[2] !== undefined) {
      out[match[1]] = match[2];
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[match[1]] = next;
      index += 1;
    } else {
      out[match[1]] = true;
    }
  }
  return out;
}

function describe(counts: Counts): string {
  return `${counts.persons} personne(s) · ${counts.couples} union(s) · ${counts.events} événement(s)`;
}

function printArchives(archives: ArchiveInfo[], dataDir: string): void {
  console.log(`\n  Dossier de données : ${dataDir}`);
  if (archives.length === 0) {
    console.log('  Aucune archive dans le dossier « sauvegardes ».\n');
    return;
  }
  console.log(`  ${archives.length} archive(s), de la plus récente à la plus ancienne :\n`);
  archives.forEach((archive, index) => {
    const date = new Date(archive.createdAt).toLocaleString('fr-BE');
    console.log(`    ${String(index + 1).padStart(2)}. ${archive.name}   ${date}   ${(archive.size / 1024).toFixed(0)} ko`);
  });
  console.log('');
}

const AIDE = [
  '',
  '  Restaurer une archive de sauvegarde dans le dossier de données.',
  '',
  '      restore.bat                       choisir une archive dans la liste (le plus simple)',
  '      npm run restore -- --list         la liste, sans rien changer',
  '      npm run restore -- --archive famille-2026-10-29-1840-manuel.zip',
  '',
  '  --data-dir <dossier>  un dossier de données autre que celui de l’application',
  '  --yes                 ne pas demander de confirmation (écriture dans un script)',
  '  --force               restaurer même si l’application semble ouverte (déconseillé)',
  '  --aide                ce texte',
  '',
  '  Une restauration remplace la base actuelle : tout ce qui a été saisi depuis l’archive disparaît.',
  '  Ce qui était là avant est copié dans une archive « avant-restauration » avant d’y toucher.',
  '',
].join('\n');

/**
 * Une seule lecture des lignes tapées, partagée par toutes les questions. Deux `rl.question` l'un
 * après l'autre laissent la seconde sans réponse quand les lignes arrivent d'un coup : la
 * restauration s'arrête avant d'avoir demandé l'avis de la personne.
 */
function makeAsker(): { ask: (prompt: string) => Promise<string>; close: () => void } {
  const rl = createInterface({ input: process.stdin });
  const buffered: string[] = [];
  let waiting: ((line: string) => void) | null = null;
  let closed = false;

  rl.on('line', (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      buffered.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    waiting?.('');
  });

  return {
    async ask(prompt: string) {
      process.stdout.write(prompt);
      if (buffered.length > 0) return buffered.shift() as string;
      if (closed) return '';
      return new Promise<string>((resolve) => {
        waiting = resolve;
      });
    },
    close: () => rl.close(),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args['aide']) {
    console.log(AIDE);
    return 0;
  }

  if (args['data-dir']) process.env.FAMILY_DATA_DIR = path.resolve(String(args['data-dir']));
  // Importée seulement ici : la résolution du dossier s'appuie sur la variable d'environnement
  // ci-dessus, et un import de tête l'aurait figée avant la lecture des arguments.
  const { resolveDataDir } = await import('./config');
  const dataDir = resolveDataDir();
  const archives = listArchives(dataDir);

  if (args['list']) {
    printArchives(archives, dataDir);
    return archives.length === 0 ? 1 : 0;
  }

  let chosen: string | null = null;
  try {
    if (args['archive']) chosen = resolveArchive(String(args['archive']), dataDir);
  } catch (error) {
    console.error(`\n  ${messageOf(error)}\n`);
    return 1;
  }
  if (!chosen && archives.length === 0) {
    console.error("\n  Aucune archive à restaurer dans ce dossier de données.\n");
    return 1;
  }

  const asker = makeAsker();
  try {
    let archive = chosen;
    if (!archive) {
      printArchives(archives, dataDir);
      const answer = (await asker.ask('  Numéro de l’archive à restaurer : ')).trim();
      archive = archives[Number(answer) - 1]?.path;
      if (!archive) {
        console.log('\n  Ce numéro n’existe pas, rien n’a été changé.\n');
        return 2;
      }
    }

    let incoming: Counts;
    try {
      incoming = archiveCounts(archive);
    } catch (error) {
      console.error(`\n  Archive refusée : ${messageOf(error)}\n`);
      return 1;
    }

    console.log(`\n  Archive choisie : ${path.basename(archive)}`);
    console.log(`  Elle contient   : ${describe(incoming)}`);

    if (!args['yes']) {
      const dbPath = path.join(dataDir, 'data', DB_ENTRY);
      if (fs.existsSync(dbPath)) {
        try {
          console.log(`  La base actuelle : ${describe(inspect(dbPath))}`);
        } catch {
          console.log('  La base actuelle est illisible — c’est peut-être précisément pour cela qu’on restaure.');
        }
      } else {
        console.log('  La base actuelle : aucune, ce dossier est vide.');
      }
      const answer = (await asker.ask('\n  Tapez OUI pour remplacer la base actuelle : ')).trim().toUpperCase();
      if (answer !== 'OUI') {
        console.log('\n  Rien n’a été changé.\n');
        return 0;
      }
    }

    const summary = await restore({
      archive,
      dataDir,
      force: Boolean(args['force']),
      port: args['port'] ? Number(args['port']) : undefined,
      log: (line) => console.log(line),
    });

    console.log(`\n  Base restaurée dans ${summary.dataDir}`);
    console.log(`  ${describe(summary.restored)}`);
    if (summary.mediasRestored > 0) console.log(`  ${summary.mediasRestored} média(s) repris de l’archive`);
    if (summary.rootWasRestored && summary.rootPersonId) console.log(`  personne de référence : ${summary.rootPersonId}`);
    if (summary.safetyArchive) {
      console.log(`  ce qui était là avant est dans : ${path.basename(summary.safetyArchive)}`);
    }
    console.log('  Relancez l’application (start.bat) pour voir l’arbre restauré.');
    console.log('');
    return 0;
  } catch (error) {
    console.error(`\n  Restauration refusée : ${messageOf(error)}\n`);
    return 1;
  } finally {
    asker.close();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Le module s'exécute quand on le lance en ligne de commande, et s'importe tel quel dans les tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
