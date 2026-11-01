import { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { SANS_ADRESSE, supabase } from './supabase';

/** Ce que la famille sait d'un compte : son adresse, son droit, et la personne qu'il est dans l'arbre. */
export interface Member {
  email: string;
  canWrite: boolean;
  personId: string | null;
}

/**
 * Le compte connecté descend par un contexte : l'écran de garde l'a déjà lu, et un écran qui le
 * relirait pour lui-même afficherait un arbre sans droit le temps de la requête.
 */
const MemberContext = createContext<Member | null>(null);

export const MemberProvider = MemberContext.Provider;

export function useMember(): Member | null {
  return useContext(MemberContext);
}

/**
 * Les refus du serveur d'identité sont écrits pour un développeur anglais. Ici ils tombent sous
 * les yeux de quelqu'un qui attend un code : la même nouvelle, dans la langue de la maison.
 */
const REFUS: [string, string][] = [
  ['Invalid login credentials', "Ce code ne correspond pas. Reprenez le dernier email reçu, les chiffres ont changé depuis le précédent."],
  ['Signups not allowed', "Cette adresse n'a pas de compte dans l'arbre. Elle doit d'abord être invitée."],
  ['Email not confirmed', "Cette adresse n'a pas encore confirmé un seul email de connexion."],
  ['Too many requests', 'Trop de demandes à la suite. Attendez une minute et redemandez le code.'],
  ['For security purposes', 'Il faut attendre un peu avant de redemander un code à la même adresse.'],
];

function enFrancais(message: string): string {
  for (const [cote, maison] of REFUS) if (message.includes(cote)) return maison;
  return message;
}

/**
 * Le code arrive par email ; aucun compte ne se crée au passage, les inscriptions sont fermées.
 * Le même email porte aussi un lien : on lui demande de revenir sur l'adresse où l'on se trouve,
 * pour que le clic ouvre l'arbre sur ce poste-ci et non sur le site réglé par défaut.
 */
export async function sendCode(email: string): Promise<string | null> {
  if (!supabase) return SANS_ADRESSE;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
  });
  return error ? enFrancais(error.message) : null;
}

export async function checkCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return SANS_ADRESSE;
  const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
  return error ? enFrancais(error.message) : null;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

async function readMember(): Promise<Member | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('family_member')
    .select('email, can_write, person_id')
    .maybeSingle();
  if (error || !data) return null;
  return { email: data.email, canWrite: Boolean(data.can_write), personId: data.person_id ?? null };
}

export interface Account {
  /** Le serveur d'identité n'a pas encore répondu : rien à afficher d'autre que l'attente. */
  pending: boolean;
  session: Session | null;
  member: Member | null;
}

/**
 * La session et la ligne family_member viennent ensemble : un compte connecté mais pas invité
 * ne doit pas voir un arbre vide, il doit entendre qu'il n'est pas encore de la famille.
 */
export function useAccount(): Account {
  const [account, setAccount] = useState<Account>({ pending: true, session: null, member: null });

  useEffect(() => {
    if (!supabase) {
      setAccount({ pending: false, session: null, member: null });
      return;
    }
    let vivant = true;

    const rafraichir = async (session: Session | null) => {
      const member = session ? await readMember() : null;
      if (vivant) setAccount({ pending: false, session, member });
    };

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void rafraichir(session);
    });
    void supabase.auth.getSession().then(({ data: { session } }) => void rafraichir(session));

    return () => {
      vivant = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return account;
}
