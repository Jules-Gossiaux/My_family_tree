/**
 * Ajoute un membre de la famille côté connexion.
 *
 * « Allow new users to sign up » est éteint sur le projet : personne ne peut se créer de compte
 * depuis l'écran de login, et c'est voulu — une adresse glanée ne doit pas ouvrir l'arbre. Le
 * compte se crée donc ici, avec la clef secrète, et l'invitation devient une ligne dans
 * family_member : c'est cette ligne, et elle seule, qui décide de ce que le compte verra.
 *
 *   npm run membre -- --email anne@exemple.be
 *   npm run membre -- --email anne@exemple.be --ecriture --person 965dd415-…
 *   npm run membre -- --liste
 */
import fs from 'node:fs';
import path from 'node:path';

const ADRESSE = process.env.VITE_SUPABASE_URL || lireEnv('VITE_SUPABASE_URL');
const SECRETE = process.env.SUPABASE_SECRET_KEY || lireEnv('SUPABASE_SECRET_KEY');

if (!ADRESSE || !SECRETE) {
  console.error('  Manque VITE_SUPABASE_URL ou SUPABASE_SECRET_KEY dans .env.local.');
  process.exit(1);
}

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

function argument(nom: string): string | null {
  const i = process.argv.indexOf(`--${nom}`);
  if (i < 0) return null;
  const suivant = process.argv[i + 1];
  return suivant && !suivant.startsWith('--') ? suivant.trim() : 'vrai';
}

async function auth<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
  const reponse = await fetch(`${ADRESSE}/auth/v1${chemin}`, {
    method: methode,
    headers: { apikey: SECRETE, authorization: `Bearer ${SECRETE}`, 'content-type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 300)}`);
  return (texte ? JSON.parse(texte) : {}) as T;
}

async function donnees<T>(methode: string, chemin: string, corps?: unknown): Promise<T> {
  const reponse = await fetch(`${ADRESSE}/rest/v1${chemin}`, {
    method: methode,
    headers: {
      apikey: SECRETE,
      authorization: `Bearer ${SECRETE}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`${methode} ${chemin} → ${reponse.status} ${texte.slice(0, 300)}`);
  return (texte ? JSON.parse(texte) : []) as T;
}

type Compte = { id: string; email?: string | null };

async function liste(): Promise<Compte[]> {
  const reponse = await auth<{ users?: Compte[] } | Compte[]>('GET', '/admin/users?page=1&per_page=1000');
  return Array.isArray(reponse) ? reponse : (reponse.users ?? []);
}

if (argument('liste')) {
  const membres = await donnees<{ auth_uid: string; email: string; can_write: boolean; person_id: string | null }[]>(
    'GET',
    '/family_member?select=auth_uid,email,can_write,person_id&order=email',
  );
  const comptes = await liste();
  const parUid = new Map(membres.map((m) => [m.auth_uid, m]));
  console.log('');
  if (!comptes.length) console.log('  Aucun compte sur le projet.');
  for (const compte of comptes) {
    const membre = parUid.get(compte.id);
    const droit = membre ? (membre.can_write ? 'écrit' : 'lit seulement') : 'aucun droit';
    const moi = membre?.person_id ? `  · dossier ${membre.person_id}` : '';
    console.log(`  ${(compte.email ?? '(sans adresse)').padEnd(34)} ${droit}${moi}`);
  }
  console.log('');
  process.exit(0);
}

const email = (argument('email') ?? '').toLowerCase();
if (!email || !email.includes('@')) {
  console.error('  Il faut une adresse :  npm run membre -- --email anne@exemple.be');
  process.exit(1);
}

const deja = (await liste()).find((c) => (c.email ?? '').toLowerCase() === email);
const compte: Compte = deja ?? (await auth<Compte>('POST', '/admin/users', { email, email_confirm: true }));
if (!deja) console.log(`  Compte créé pour ${email}`);

const ecriture = Boolean(argument('ecriture'));
const personne = argument('person');
if (personne === 'vrai') {
  console.error('  --person veut un identifiant de personne dans l’arbre.');
  process.exit(1);
}

const enLigne = personne ? (await donnees<{ id: string }[]>('GET', `/person?id=eq.${encodeURIComponent(personne)}&select=id`))[0] : undefined;
if (personne && !enLigne) {
  console.error(`  Cette personne n’est pas dans l’arbre en ligne : ${personne}`);
  process.exit(1);
}

const rang = {
  auth_uid: compte.id,
  email,
  person_id: enLigne?.id ?? null,
  can_write: ecriture,
  created_at: new Date().toISOString(),
};

await donnees('POST', '/family_member?on_conflict=auth_uid', [rang]);

console.log('');
console.log(`  ${email} — ${ecriture ? 'peut modifier l’arbre' : 'lecture seule'}${enLigne ? `, son « moi » est ${personne}` : ''}.`);
console.log('  Un code de connexion vaut à partir de maintenant : il suffit de le demander sur l’écran de login.');
console.log('');
