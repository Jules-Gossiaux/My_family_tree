import { useEffect, useRef, useState } from 'react';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
  currentUser,
  listFamilies,
  signIn,
  signOut,
  signUp,
  supabaseConfigured,
  type CloudFamily,
} from '../domain/supabase';
import type { Id } from '../domain/types';

interface CloudGateProps {
  currentFamilyId: Id | null;
  localImport: { persons: number } | null;
  onReady: (familyId: Id) => Promise<void>;
  onImportLocal: (name: string) => Promise<void>;
  onDismissImport: () => void;
  onUserChange: (user: { id: Id; email: string } | null) => void;
  onClose?: () => void;
}

type CloudUser = { id: Id; email: string };
type AuthMode = 'signin' | 'signup';

export default function CloudGate({
  currentFamilyId,
  localImport,
  onReady,
  onImportLocal,
  onDismissImport,
  onUserChange,
  onClose,
}: CloudGateProps) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [families, setFamilies] = useState<CloudFamily[]>([]);
  const [tokenFamily, setTokenFamily] = useState<Id | null>(null);
  const [newFamily, setNewFamily] = useState('');
  const [invite, setInvite] = useState('');
  const [importName, setImportName] = useState('');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [busy, setBusy] = useState(false);
  const notifyUser = useRef(onUserChange);
  notifyUser.current = onUserChange;

  useEffect(() => {
    void currentUser().then(setUser);
  }, []);

  useEffect(() => {
    notifyUser.current?.(user);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void listFamilies().then(setFamilies);
  }, [user]);

  useEffect(() => {
    const admins = families.filter((family) => family.role === 'admin');
    setTokenFamily((current) =>
      admins.some((family) => family.id === current)
        ? current
        : (admins[0]?.id ?? null),
    );
  }, [families]);

  if (!supabaseConfigured) {
    return (
      <div className="modal-overlay">
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-header">
            <h2>Configuration en ligne requise</h2>
          </div>
          <div className="modal-body">
            <p className="panel-note">
              Cet arbre fonctionne uniquement en ligne. Définissez{' '}
              <code>VITE_SUPABASE_URL</code> et{' '}
              <code>VITE_SUPABASE_ANON_KEY</code>, puis relancez l’application.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  };

  const authenticate = () =>
    run(async () => {
      if (mode === 'signin') {
        await signIn(email, password);
        setUser(await currentUser());
        return;
      }
      await signUp(email, password);
      const created = await currentUser();
      if (created) {
        setUser(created);
        setNotice('Compte créé. Choisissez maintenant votre arbre.');
      } else {
        setNotice(
          'Compte créé. Vérifiez votre e-mail si nécessaire, puis connectez-vous.',
        );
      }
    });

  const openFamily = (familyId: Id) =>
    run(async () => {
      await onReady(familyId);
    });

  const createAndOpen = () =>
    run(async () => {
      const familyId = await createFamily(newFamily.trim());
      setNewFamily('');
      await onReady(familyId);
    });

  const joinWithToken = () =>
    run(async () => {
      const familyId = await acceptInvitation(invite);
      setInvite('');
      await onReady(familyId);
    });

  const importLocalTree = () =>
    run(async () => {
      await onImportLocal(importName.trim() || 'Arbre importé');
    });

  const generateToken = () =>
    run(async () => {
      if (!tokenFamily) return;
      setAccessToken(await createInvitation(tokenFamily));
    });

  const adminFamilies = families.filter((family) => family.role === 'admin');

  return (
    <div className="modal-overlay">
      <div className="modal cloud-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <h2>{user ? 'Quel arbre ouvrir ?' : 'Accéder à votre arbre'}</h2>
            <p>
              {user
                ? `Connecté en tant que ${user.email}`
                : 'Connectez-vous ou créez un compte pour retrouver votre arbre partagé.'}
            </p>
          </div>
          {user && (
            <button
              type="button"
              className="btn btn-mini"
              disabled={busy}
              onClick={() => {
                void signOut().then(() => {
                  setUser(null);
                  notifyUser.current?.(null);
                });
              }}
            >
              Se déconnecter
            </button>
          )}
        </div>

        <div className="modal-body cloud-body">
          {notice && <div className="dialog-notice is-info">{notice}</div>}

          {!user ? (
            <div className="cloud-auth">
              <div className="cloud-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signin'}
                  className={mode === 'signin' ? 'is-active' : ''}
                  onClick={() => {
                    setMode('signin');
                    setNotice(null);
                  }}
                >
                  Se connecter
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  className={mode === 'signup' ? 'is-active' : ''}
                  onClick={() => {
                    setMode('signup');
                    setNotice(null);
                  }}
                >
                  Créer un compte
                </button>
              </div>
              <label className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Mot de passe</span>
                <input
                  type="password"
                  autoComplete={
                    mode === 'signin' ? 'current-password' : 'new-password'
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void authenticate();
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary cloud-primary"
                disabled={busy || !email || password.length < 6}
                onClick={() => void authenticate()}
              >
                {mode === 'signin' ? 'Se connecter' : 'Créer un compte'}
              </button>
              <p className="panel-note cloud-privacy">
                Vos données sont enregistrées en ligne et visibles uniquement
                par les personnes que vous invitez.
              </p>
            </div>
          ) : (
            <>
              {localImport && (
                <section className="cloud-section cloud-import">
                  <h3>Ancien arbre sur cet appareil</h3>
                  <p className="panel-note">
                    {localImport.persons} personne
                    {localImport.persons > 1 ? 's' : ''} trouvée
                    {localImport.persons > 1 ? 's' : ''}. Importez-le une seule
                    fois dans un nouvel arbre en ligne.
                  </p>
                  <div className="cloud-inline">
                    <input
                      value={importName}
                      placeholder="Nom de l’arbre importé"
                      onChange={(event) => setImportName(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-mini btn-primary"
                      disabled={busy}
                      onClick={() => void importLocalTree()}
                    >
                      Importer et ouvrir
                    </button>
                    <button
                      type="button"
                      className="btn btn-mini"
                      disabled={busy}
                      onClick={onDismissImport}
                    >
                      Ignorer
                    </button>
                  </div>
                </section>
              )}

              <section className="cloud-section">
                <h3>Vos arbres</h3>
                {families.length === 0 ? (
                  <p className="panel-note">
                    Aucun arbre pour le moment. Créez-en un ou rejoignez un
                    proche avec un jeton.
                  </p>
                ) : (
                  <div className="cloud-family-list">
                    {families.map((family) => (
                      <button
                        key={family.id}
                        type="button"
                        className="cloud-family-choice"
                        disabled={busy}
                        onClick={() => openFamily(family.id)}
                      >
                        <span>
                          <strong>{family.name}</strong>
                          {family.id === currentFamilyId && <em>actuel</em>}
                        </span>
                        <small>{family.role}</small>
                        <span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="cloud-section">
                <h3>Créer un nouvel arbre</h3>
                <p className="panel-note">
                  Vous en devenez l’administrateur et pourrez inviter vos
                  proches.
                </p>
                <div className="cloud-inline">
                  <input
                    value={newFamily}
                    placeholder="Nom du nouvel arbre"
                    onChange={(event) => setNewFamily(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && newFamily.trim()) {
                        void createAndOpen();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-mini btn-primary"
                    disabled={busy || !newFamily.trim()}
                    onClick={() => void createAndOpen()}
                  >
                    Créer et ouvrir
                  </button>
                </div>
              </section>

              <section className="cloud-section">
                <h3>Rejoindre un arbre</h3>
                <p className="panel-note">
                  Un proche vous a donné un jeton ? Saisissez-le ci-dessous.
                </p>
                <div className="cloud-inline">
                  <input
                    value={invite}
                    placeholder="Jeton d’invitation"
                    onChange={(event) => setInvite(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && invite.trim()) {
                        void joinWithToken();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-mini"
                    disabled={busy || !invite.trim()}
                    onClick={() => void joinWithToken()}
                  >
                    Rejoindre
                  </button>
                </div>
              </section>

              {adminFamilies.length > 0 && (
                <section className="cloud-section">
                  <h3>Inviter un proche</h3>
                  <p className="panel-note">
                    Seul un administrateur peut générer un jeton. La personne
                    crée son compte, saisit ce jeton et accède à l’arbre.
                  </p>
                  <div className="cloud-inline">
                    <select
                      value={tokenFamily ?? ''}
                      onChange={(event) => {
                        setTokenFamily(event.target.value as Id);
                        setAccessToken(null);
                      }}
                      aria-label="Arbre pour lequel générer un jeton"
                    >
                      {adminFamilies.map((family) => (
                        <option key={family.id} value={family.id}>
                          {family.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-mini"
                      disabled={busy || !tokenFamily}
                      onClick={() => void generateToken()}
                    >
                      Générer un jeton
                    </button>
                  </div>
                  {accessToken && (
                    <input
                      className="cloud-token"
                      readOnly
                      value={accessToken}
                      onFocus={(event) => event.target.select()}
                      aria-label="Jeton d’accès généré"
                    />
                  )}
                </section>
              )}
            </>
          )}
        </div>

        {onClose && user && (
          <footer className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Retour à l’arbre
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
