import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { db } from './db';
import { DATA_DIR, MEDIA_DIR } from './config';

const BACKUP_DIR = path.join(DATA_DIR, 'sauvegardes');
const KEEP = 20;
const AUTO_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') + '-' + [pad(now.getHours()), pad(now.getMinutes())].join('');
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((file) => file.endsWith('.zip'))
    .map((file) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, file));
      return { name: file, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function lastBackup(): BackupInfo | null {
  return listBackups()[0] ?? null;
}

function prune(): void {
  const backups = listBackups();
  for (const backup of backups.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, backup.name));
    } catch {
      /* un fichier verrouillé ne doit pas empêcher la sauvegarde */
    }
  }
}

/**
 * Archive datée : la base (copiée proprement, sans les journaux WAL) et les médias.
 * Le fichier est écrit dans un temporaire puis renommé, pour ne jamais laisser
 * une archive à moitié écrite en cas d'interruption.
 */
export async function createBackup(reason = 'auto'): Promise<BackupInfo> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const name = `famille-${stamp()}-${reason}.zip`;
  const target = path.join(BACKUP_DIR, name);
  const partial = `${target}.part`;
  const tempDb = path.join(BACKUP_DIR, `.snapshot-${Date.now()}.db`);

  await db.backup(tempDb);

  const zip = new AdmZip();
  zip.addLocalFile(tempDb, '', 'famille.db');

  const configPath = path.join(DATA_DIR, 'config.json');
  if (fs.existsSync(configPath)) zip.addLocalFile(configPath);

  if (fs.existsSync(MEDIA_DIR)) {
    zip.addLocalFolder(MEDIA_DIR, 'medias');
  }

  zip.addFile(
    'LISEZMOI.txt',
    Buffer.from(
      [
        'Sauvegarde de l’arbre généalogique familial.',
        '',
        `Date : ${new Date().toLocaleString('fr-BE')}`,
        `Origine : ${DATA_DIR}`,
        '',
        'Contenu :',
        '  famille.db   la base de données complète (SQLite)',
        '  medias/      photos et documents scannés',
        '  config.json  réglages de l’application',
        '',
        'Restauration : fermez l’application, remplacez le fichier',
        'famille.db du dossier de données par celui de cette archive.',
        '',
      ].join('\n'),
      'utf8',
    ),
  );

  zip.writeZip(partial);
  fs.unlinkSync(tempDb);
  fs.renameSync(partial, target);

  prune();

  const stat = fs.statSync(target);
  return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
}

/** Sauvegarde automatique au démarrage, si la dernière est trop ancienne. */
export function scheduleAutoBackup(): void {
  setTimeout(() => {
    const last = lastBackup();
    const stale = !last || Date.now() - new Date(last.createdAt).getTime() > AUTO_INTERVAL_MS;
    if (!stale) return;
    createBackup('auto').catch((error) => {
      console.warn('[sauvegarde] échec :', error);
    });
  }, 4000);
}
