import fs from 'node:fs';
import path from 'node:path';

/**
 * Résolution du dossier de données.
 *
 * Ordre de priorité :
 *   1. variable d'environnement FAMILY_DATA_DIR
 *   2. config.local.json à la racine du projet (ignoré par git)
 *   3. D:\Genealogie (recommandation de la spec, si le dossier existe)
 *   4. ./data dans le projet (repli, ignoré par git)
 */
export function resolveDataDir(): string {
  const fromEnv = process.env.FAMILY_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());

  const localConfig = path.resolve(process.cwd(), 'config.local.json');
  if (fs.existsSync(localConfig)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(localConfig, 'utf8')) as { dataDir?: string };
      if (typeof parsed.dataDir === 'string' && parsed.dataDir.trim()) {
        return path.resolve(parsed.dataDir.trim());
      }
    } catch {
      console.warn('[config] config.local.json illisible, on ignore.');
    }
  }

  if (process.platform === 'win32' && fs.existsSync('D:\\Genealogie')) {
    return 'D:\\Genealogie';
  }

  return process.cwd();
}

export const DATA_DIR = resolveDataDir();
export const DB_PATH = path.join(DATA_DIR, 'data', 'famille.db');
export const MEDIA_DIR = path.join(DATA_DIR, 'medias');

const LAYOUT = [
  'data',
  'medias',
  'medias/photos',
  'medias/documents',
  'medias/vignettes',
  'scans_bruts',
  'sauvegardes',
  'exports',
];

export function ensureLayout(): void {
  for (const dir of LAYOUT) {
    fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true });
  }
}
