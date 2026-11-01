import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MemberProvider, sendCode, signOut, checkCode, useAccount } from './session';

const EMAIL_MEMORISE = 'arbre.email';

/**
 * Deux champs, jamais plus : une adresse, puis le code que l'email a apporté. Pas de mot de passe
 * à inventer, à retenir, à oublier — celui qui ouvre l'arbre n'a rien à prouver d'autre que son
 * adresse, et le code ne sert qu'une fois.
 */
export default function SignIn() {
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_MEMORISE) ?? '');
  const [code, setCode] = useState('');
  const [etape, setEtape] = useState<'adresse' | 'code'>('adresse');
  const [occuped, setOccuped] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const champCode = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (etape === 'code') champCode.current?.focus();
  }, [etape]);

  const demander = async () => {
    setOccuped(true);
    setErreur(null);
    const refus = await sendCode(email);
    setOccuped(false);
    if (refus) setErreur(refus);
    else {
      localStorage.setItem(EMAIL_MEMORISE, email.trim().toLowerCase());
      setCode('');
      setEtape('code');
    }
  };

  const entrer = async () => {
    setOccuped(true);
    setErreur(null);
    const refus = await checkCode(email, code);
    setOccuped(false);
    setErreur(refus);
  };

  return (
    <div className="signin">
      <form
        className="signin-card"
        onSubmit={(event) => {
          event.preventDefault();
          void (etape === 'adresse' ? demander() : entrer());
        }}
      >
        <div className="signin-brand">
          <span className="brand-mark" />
          Arbre de famille
        </div>

        {etape === 'adresse' ? (
          <>
            <h1>Qui ouvre l’arbre ?</h1>
            <p className="signin-hint">
              Écrivez votre adresse email. Vous y recevrez un code qui ne sert qu’une fois : rien à
              retenir, rien à inventer.
            </p>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="prenom@exemple.be"
              autoComplete="email"
              spellCheck={false}
              required
            />
            <button className="primary" type="submit" disabled={occuped || !email.includes('@')}>
              {occuped ? 'Un code part…' : 'Recevoir un code'}
            </button>
          </>
        ) : (
          <>
            <h1>Votre code</h1>
            <p className="signin-hint">
              Huit chiffres viennent d’être envoyés à <strong>{email.trim().toLowerCase()}</strong>.
              Le dernier email reçu est le bon : un code plus ancien ne fonctionne plus.
            </p>
            <input
              ref={champCode}
              className="signin-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder="00000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
            />
            <button className="primary" type="submit" disabled={occuped || code.length < 6}>
              {occuped ? 'On vérifie…' : 'Entrer dans l’arbre'}
            </button>
            <button className="link" type="button" onClick={() => setEtape('adresse')}>
              Ce n’est pas cette adresse ?
            </button>
          </>
        )}

        {erreur && <p className="signin-error">{erreur}</p>}
      </form>
    </div>
  );
}

/**
 * Rien de l'arbre ne se montre avant la session : les lignes ne sortent du serveur que pour un
 * compte invité, et une application qui afficherait son squelette en attendant ferait croire à un
 * arbre vide plutôt qu'à une porte fermée.
 */
export function Gated({ children }: { children: ReactNode }) {
  const { pending, session, member } = useAccount();

  if (pending) return <div className="signin signin-pending">Un instant…</div>;
  if (!session) return <SignIn />;
  if (!member) {
    return (
      <div className="signin">
        <form className="signin-card" onSubmit={(event) => event.preventDefault()}>
          <div className="signin-brand">
            <span className="brand-mark" />
            Arbre de famille
          </div>
          <h1>Vous n’êtes pas encore de la famille</h1>
          <p className="signin-hint">
            L’adresse <strong>{session.user.email}</strong> a bien ouvert une session, mais personne
            ne l’a invitée à regarder l’arbre. Demandez à Jules d’ajouter cette adresse.
          </p>
          <button className="primary" type="button" onClick={() => void signOut()}>
            Changer d’adresse
          </button>
        </form>
      </div>
    );
  }

  return <MemberProvider value={member}>{children}</MemberProvider>;
}
