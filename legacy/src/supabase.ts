import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ADRESSE = import.meta.env.VITE_SUPABASE_URL;
const CLE_PUBLIQUE = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Ce que l'écran montre quand le déploiement n'a pas reçu son adresse : un arbre vide se
 * prendrait pour des données perdues, une phrase vide d'adresse se prend pour une panne.
 */
export const SANS_ADRESSE =
  "L'application n'a pas l'adresse du serveur où vit l'arbre. " +
  'Sur Vercel : Réglages du projet → Environment Variables → VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.';

/**
 * Un seul client pour toute l'application : la session — donc les droits — se partage entre
 * tout ce qui lit. La clef publiée n'est pas un secret, elle est dans le navigateur ; ce qui
 * ferme l'arbre, c'est la ligne family_member du compte connecté, que le serveur vérifie à
 * chaque requête.
 */
export const supabase: SupabaseClient | null =
  ADRESSE && CLE_PUBLIQUE ? createClient(ADRESSE, CLE_PUBLIQUE) : null;
