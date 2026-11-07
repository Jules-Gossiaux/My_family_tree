import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config';
import { db } from './db';
import { notify } from './notices';

/**
 * Les deux personnes de référence, rangées dans `config.json` à côté de la base.
 *
 * `rootPersonId` dit où l'écran s'ouvre, `mePersonId` dit qui l'on est dedans : deux questions
 * différentes, réglées séparément — la personne de référence pose le regard, « moi » est
 * la personne que l'on veut retrouver d'un clic.
 *
 * Un identifiant qui pend — personne effacée entre-temps, archive restaurée venue d'un autre
 * arbre — n'est pas une panne : il se lit, il se remplace, et l'interface le dit au lieu de
 * réécrire le fichier en cachette.
 */
export interface AppConfig {
  rootPersonId: string | null;
  mePersonId: string | null;
}

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

/** Un réglage qui ne peut pas être tenu : le code HTTP dit pourquoi la demande repart. */
export class ConfigError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<AppConfig>;
      return { rootPersonId: parsed.rootPersonId ?? null, mePersonId: parsed.mePersonId ?? null };
    }
  } catch (error) {
    // Le fichier reste sur le disque : la panne est dite à l'écran, pas remplacée par un vide.
    console.error(`[réglages] ${CONFIG_PATH} est illisible, les personnes de référence sont perdues.`);
    console.error(String(error));
    notify(
      'Le fichier de réglages est abîmé : la personne de référence et la personne « moi » sont à choisir à nouveau.',
    );
  }
  return { rootPersonId: null, mePersonId: null };
}

export function writeConfig(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Pose les réglages demandés et laisse intacts ceux qui ne sont pas nommés. Une personne qui
 * n'existe plus est refusée : mieux vaut un réglage qui n'a pas bougé qu'un arbre centré sur
 * une id sans visage.
 */
export function patchConfig(patch: Partial<AppConfig>): AppConfig {
  const config = readConfig();
  const next: AppConfig = {
    rootPersonId: patch.rootPersonId === undefined ? config.rootPersonId : patch.rootPersonId ?? null,
    mePersonId: patch.mePersonId === undefined ? config.mePersonId : patch.mePersonId ?? null,
  };

  const references = [
    ['la personne de référence', next.rootPersonId],
    ['la personne « moi »', next.mePersonId],
  ] as const;
  for (const [label, id] of references) {
    if (id && !db.prepare('SELECT id FROM person WHERE id = ?').get(id)) {
      throw new ConfigError(400, `Cette personne n’existe plus dans la base : ${label} n’est pas réglée.`);
    }
  }

  writeConfig(next);
  return next;
}

/**
 * Une personne effacée ne laisse aucun des deux réglages pendus : la personne de référence repart
 * d'une personne qui existe encore, « moi » s'éteint jusqu'à un nouveau choix. Rien n'est écrit quand l'effacée
 * n'était personne.
 */
export function repairConfigAfterDelete(personId: string): void {
  const config = readConfig();
  if (config.rootPersonId !== personId && config.mePersonId !== personId) return;

  const survivor = db.prepare('SELECT id FROM person LIMIT 1').get() as { id: string } | undefined;
  writeConfig({
    rootPersonId: config.rootPersonId === personId ? (survivor?.id ?? null) : config.rootPersonId,
    mePersonId: config.mePersonId === personId ? null : config.mePersonId,
  });
}
