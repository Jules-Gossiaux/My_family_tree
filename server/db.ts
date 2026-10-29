import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { DB_PATH, ensureLayout } from './config';
import { runMigrations } from './migrations';

const here = path.dirname(fileURLToPath(import.meta.url));

ensureLayout();

/**
 * Le moteur SQLite est un binaire compilé pour une version précise de Node : une
 * mise à jour de Node le rend inchargeable, et l'erreur qui en sort est illisible
 * pour quelqu'un qui ne développe pas. On lui donne directement la commande qui répare.
 */
function openDatabase(): Database.Database {
  try {
    return new Database(DB_PATH);
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_DLOPEN_FAILED') {
      console.error(
        [
          '',
          "  Le moteur de base de données n'est pas compatible avec cette version de Node.js.",
          '  Dans ce dossier, lancez une seule fois la commande :',
          '',
          '      npm rebuild better-sqlite3',
          '',
          '  Puis relancez l\'application.',
          '',
        ].join('\n'),
      );
      process.exit(1);
    }
    throw error;
  }
}

export const db = openDatabase();
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
db.exec(schema);

// Après l'ouverture : `schema.sql` doit avoir posé les tables avant que les migrations les ajustent.
runMigrations();

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
