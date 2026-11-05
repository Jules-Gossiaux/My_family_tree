import fs from 'node:fs';
import path from 'node:path';

/**
 * Ce que les scripts de ligne de commande savent d'une base en ligne : où elle est, avec quelle
 * clef on y entre, et comment on lui parle.
 *
 * La clef est celle du service : elle traverse le RLS, ce qui est exactement ce qu'il faut pour
 * vider ou remplir une base entière — et ce qui ne doit jamais sortir du disque. Elle se lit dans
 * .env.local, jamais dans une conversation ni dans une archive.
 */

export function lireEnv(nom: string): string {
  const fichier = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(fichier)) return '';
  for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const i = ligne.indexOf('=');
    if (i < 0 || ligne.slice(0, i).trim() !== nom) continue;
    return ligne.slice(i + 1).trim();
  }
  return '';
}

export const ADRESSE = process.env.VITE_SUPABASE_URL || lireEnv('VITE_SUPABASE_URL');
export const SECRETE = process.env.SUPABASE_SECRET_KEY || lireEnv('SUPABASE_SECRET_KEY');

export const BUCKET = 'medias';

export function reference(): string {
  return new URL(ADRESSE).hostname.split('.')[0];
}

export const CLES = { apikey: SECRETE, authorization: `Bearer ${SECRETE}` };

export async function appeler(
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

export async function json<T>(chemin: string): Promise<T> {
  const reponse = await appeler('GET', chemin, undefined, { accept: 'application/json' });
  return (await reponse.json()) as T;
}

/** Le total que la base annonce pour une table, sans en descendre une seule ligne. */
export async function compter(nom: string): Promise<number> {
  const reponse = await appeler('GET', `/rest/v1/${nom}?select=*&limit=0`, undefined, {
    prefer: 'count=exact',
  });
  const enTete = reponse.headers.get('content-range') ?? '';
  const total = Number(enTete.split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`${nom} : comptage illisible (${enTete || 'en-tete absent'})`);
  return total;
}

export function annoncerAbsenceDeClef(): void {
  console.error('  Manque VITE_SUPABASE_URL ou SUPABASE_SECRET_KEY dans .env.local.');
  process.exit(1);
}
