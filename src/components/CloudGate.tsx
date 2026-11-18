import { useEffect, useRef, useState } from 'react';
import {
  acceptInvitation,
  createFamily,
  currentUser,
  listFamilies,
  signIn,
  signOut,
  signUp,
  supabaseConfigured,
  type CloudFamily,
} from '../domain/supabase';
import type { FamilyData, Id } from '../domain/types';

interface CloudGateProps {
  localData: FamilyData;
  onReady: (familyId: Id) => Promise<void>;
  onCancel: () => void;
  onUserChange?: (user: { id: Id; email: string } | null) => void;
}

type CloudUser = { id: Id; email: string };

export default function CloudGate({
  localData,
  onReady,
  onCancel,
  onUserChange,
}: CloudGateProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [families, setFamilies] = useState<CloudFamily[]>([]);
  const [selected, setSelected] = useState<Id | null>(null);
  const [newFamily, setNewFamily] = useState('');
  const [invite, setInvite] = useState('');
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
    void listFamilies().then((items) => {
      setFamilies(items);
      setSelected((current) => current ?? items[0]?.id ?? null);
    });
  }, [user]);

  if (!supabaseConfigured) {
    return (
      <div className="modal-overlay">
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-header">
            <h2>Cloud non configuré</h2>
          </div>
          <div className="modal-body">
            <p className="panel-note">
              Définissez <code>VITE_SUPABASE_URL</code> et{' '}
              <code>VITE_SUPABASE_ANON_KEY</code>, puis relancez l’application
              pour activer les comptes et le stockage en ligne.
            </p>
          </div>
          <footer className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={onCancel}>
              Rester en local
            </button>
          </footer>
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

  return (
    <div className="modal-overlay">
      <div className="modal cloud-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>Arbre en ligne</h2>
          <p className="modal-subtitle">
            Chaque personne connectée aura son propre marqueur « Moi ». Les
            données familiales restent partagées selon les rôles.
          </p>
        </div>
        <div className="modal-body cloud-body">
          {notice && <div className="dialog-notice is-error">{notice}</div>}

          {!user ? (
            <div className="cloud-auth">
              <label className="field">
                <span>E-mail</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Mot de passe</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div className="cloud-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !email || password.length < 6}
                  onClick={() =>
                    void run(async () => {
                      await signIn(email, password);
                      setUser(await currentUser());
                    })
                  }
                >
                  Se connecter
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !email || password.length < 6}
                  onClick={() =>
                    void run(async () => {
                      await signUp(email, password);
                      setNotice('Compte créé. Vérifiez votre e-mail si nécessaire.');
                    })
                  }
                >
                  Créer un compte
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="panel-note">Connecté : {user.email}</p>
              <section className="cloud-section">
                <h3>Votre arbre</h3>
                {families.length === 0 ? (
                  <p className="panel-note">
                    Aucun arbre partagé. Créez-en un pour commencer.
                  </p>
                ) : (
                  <div className="cloud-family-list">
                    {families.map((family) => (
                      <label key={family.id} className="cloud-family">
                        <input
                          type="radio"
                          name="family"
                          checked={selected === family.id}
                          onChange={() => setSelected(family.id)}
                        />
                        <span>{family.name}</span>
                        <small>{family.role}</small>
                      </label>
                    ))}
                  </div>
                )}
                <div className="cloud-new">
                  <input
                    value={newFamily}
                    placeholder="Nom du nouvel arbre"
                    onChange={(event) => setNewFamily(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-mini btn-primary"
                    disabled={busy || !newFamily.trim()}
                    onClick={() =>
                      void run(async () => {
                        const id = await createFamily(newFamily.trim());
                        setFamilies(await listFamilies());
                        setSelected(id);
                        setNewFamily('');
                      })
                    }
                  >
                    Créer
                  </button>
                </div>
              </section>

              <section className="cloud-section">
                <h3>Invitation reçue</h3>
                <div className="cloud-new">
                  <input
                    value={invite}
                    placeholder="Jeton d’invitation"
                    onChange={(event) => setInvite(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-mini"
                    disabled={busy || !invite.trim()}
                    onClick={() =>
                      void run(async () => {
                        const id = await acceptInvitation(invite);
                        setFamilies(await listFamilies());
                        setSelected(id);
                        setInvite('');
                      })
                    }
                  >
                    Rejoindre
                  </button>
                </div>
              </section>

              <p className="panel-note">
                Votre arbre local ({localData.persons.length} personne
                {localData.persons.length > 1 ? 's' : ''}) reste intact. La
                première synchronisation écrira ce document dans l’arbre choisi
                ; assurez-vous d’avoir exporté une sauvegarde si un arbre existe
                déjà en ligne.
              </p>
            </>
          )}
        </div>
        <footer className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Rester en local
          </button>
          {user && (
            <button
              type="button"
              className="btn"
              onClick={() => void signOut().then(() => setUser(null))}
            >
              Se déconnecter
            </button>
          )}
          {user && selected && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onReady(selected);
                })
              }
            >
              Ouvrir cet arbre en ligne
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
