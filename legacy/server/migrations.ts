import { db } from './db';
import { notify } from './notices';

type Row = Record<string, any>;

interface Migration {
  version: number;
  /** Écriture réelle sur une base qui date d'avant. */
  up: () => void;
  /** Faux quand la base sort déjà de `schema.sql` dans la bonne forme. */
  needed?: () => boolean;
}

/** Le type de rupture déclaré sur une colonne, tel que SQLite le retient. */
function onDeleteAction(table: string, column: string): string | null {
  const rows = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Row[];
  const found = rows.find((row) => row.from === column);
  return found ? (found.on_delete as string) : null;
}

function hasColumn(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
  return rows.some((row) => row.name === column);
}

function wasCascade(table: string, column: string): boolean {
  return onDeleteAction(table, column) === 'CASCADE';
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    // Un couple survit à la suppression d'un de ses deux membres. Avant : ON DELETE CASCADE,
    // donc effacer une personne mal orthographiée détruisait son union, ses actes de mariage
    // et, par `SET NULL` sur les enfants, la mémoire de l'union dont chacun était issu.
    // Même définition que `couple` dans schema.sql : les deux textes doivent rester les mêmes.
    needed: () => wasCascade('couple', 'partner_a') || wasCascade('couple', 'partner_b'),
    up: () => {
      db.exec(`
        CREATE TABLE couple_new (
          id                  TEXT PRIMARY KEY,
          partner_a           TEXT REFERENCES person(id) ON DELETE SET NULL,
          partner_b           TEXT REFERENCES person(id) ON DELETE SET NULL,
          type                TEXT NOT NULL DEFAULT 'inconnu',
          status              TEXT NOT NULL DEFAULT 'en_cours',
          start_date_min      TEXT,
          start_date_max      TEXT,
          start_date_qualifier TEXT,
          start_date_text     TEXT,
          end_date_min        TEXT,
          end_date_max        TEXT,
          end_date_qualifier  TEXT,
          end_date_text       TEXT,
          place_id            TEXT REFERENCES place(id) ON DELETE SET NULL,
          created_at          TEXT NOT NULL
        );

        INSERT INTO couple_new
          SELECT id, partner_a, partner_b, type, status,
                 start_date_min, start_date_max, start_date_qualifier, start_date_text,
                 end_date_min, end_date_max, end_date_qualifier, end_date_text,
                 place_id, created_at
            FROM couple;

        DROP TABLE couple;
        ALTER TABLE couple_new RENAME TO couple;

        CREATE INDEX IF NOT EXISTS idx_couple_a ON couple(partner_a);
        CREATE INDEX IF NOT EXISTS idx_couple_b ON couple(partner_b);
      `);
    },
  },
  {
    version: 2,
    // Une branche est partie d'une personne : quand cette personne est effacée, la branche reste
    // et se cherche une autre tête. Avant : `root_person_id` n'était qu'un TEXT, donc la base
    // pouvait garder une tête désignant une personne disparue — et l'écran Réglages la proposait
    // quand même dans la liste des racines.
    // Même définition que `branch` dans schema.sql : les deux textes doivent rester les mêmes.
    needed: () => onDeleteAction('branch', 'root_person_id') !== 'SET NULL',
    up: () => {
      db.exec(`
        CREATE TABLE branch_new (
          id             TEXT PRIMARY KEY,
          name           TEXT NOT NULL,
          color          TEXT NOT NULL DEFAULT '#C9A961',
          root_person_id TEXT REFERENCES person(id) ON DELETE SET NULL,
          created_at     TEXT NOT NULL
        );

        INSERT INTO branch_new SELECT id, name, color, root_person_id, created_at FROM branch;

        DROP TABLE branch;
        ALTER TABLE branch_new RENAME TO branch;

        UPDATE branch SET root_person_id = NULL
          WHERE root_person_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM person p WHERE p.id = branch.root_person_id);
      `);
    },
  },
  {
    version: 3,
    // Où joindre une personne et où elle repose : quatre colonnes ajoutées après coup. Les bases
    // déjà écrites les reçoivent vides, sans rien toucher à ce qu'elles portent.
    needed: () => !hasColumn('person', 'address'),
    up: () => {
      db.exec(`
        ALTER TABLE person ADD COLUMN address TEXT;
        ALTER TABLE person ADD COLUMN phone TEXT;
        ALTER TABLE person ADD COLUMN email TEXT;
        ALTER TABLE person ADD COLUMN cemetery TEXT;
      `);
    },
  },
];

function userVersion(): number {
  return (db.pragma('user_version', { simple: true }) as number) ?? 0;
}

/**
 * Le schéma est posé par `schema.sql` avec des `CREATE TABLE IF NOT EXISTS`, qui ne rattrapent
 * pas une base déjà créée. Les ajustements d'une version à l'autre passent donc ici, et
 * `PRAGMA user_version` sert de calendrier : une migration ne se rejoue pas, et une base qui
 * monte de plusieurs versions les traverse dans l'ordre.
 */
export function runMigrations(): void {
  const from = userVersion();

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;

    if (migration.needed?.() ?? true) {
      // La clause ON DELETE d'une colonne ne se modifie pas : on remplace la table, et il faut
      // suspendre le contrôle des clés étrangères pendant l'échange.
      db.pragma('foreign_keys = OFF');
      db.transaction(migration.up)();
      db.pragma('foreign_keys = ON');
      console.log(`[migration] schéma porté à la version ${migration.version}`);
    }

    // PRAGMA user_version prend une valeur en dur, pas un paramètre.
    db.pragma(`user_version = ${migration.version}`);
  }

  const broken = db.prepare('PRAGMA foreign_key_check').all() as Row[];
  if (broken.length > 0) {
    console.warn(`[migration] ${broken.length} liens pendants après la mise à jour du schéma.`);
    notify(
      'La mise à jour du schéma a laissé des liens pendants. Gardez la dernière sauvegarde sous la main.',
    );
  }
}
