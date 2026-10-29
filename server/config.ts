import fs from 'node:fs';
import path from 'node:path';

/**
 * Résolution du dossier de données.
 *
 * Ordre de priorité :
 *   1. variable d'environnement FAMILY_DATA_DIR
 *   2. config.local.json à la racine du projet (ignoré par git)
 *   3. D:\Genealogie sous Windows (recommandation de la spec, créé au besoin)
 *
 * Le repli sur le dossier du projet est volontairement supprimé : une base qui se
 * crée là où le code est rangé finit par être déplacée, nettoyée ou versionnée. Si
 * aucun dossier ne se décide, on s'arrête en l'écrivant plutôt que d'ouvrir un arbre
 * vide que l'on prendrait pour ses données perdues.
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

  if (process.platform === 'win32') return 'D:\\Genealogie';

  console.error(
    [
      '',
      '  Aucun dossier de données n’est choisi, et rien ne sera écrit tant que ce choix n’est pas fait.',
      '',
      '  Dites où vivent vos données, par l’un de ces deux moyens :',
      '',
      '      set FAMILY_DATA_DIR=D:\\Chemin\\vers\\mes\\donnees',
      '      config.local.json  { "dataDir": "D:\\\\Chemin\\\\vers\\\\mes\\\\donnees" }',
      '',
      '  Le dossier sera créé s’il manque.',
      '',
    ].join('\n'),
  );
  process.exit(1);
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
