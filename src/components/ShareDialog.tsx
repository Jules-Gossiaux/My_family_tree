import { useState } from 'react';
import { createInvitation } from '../domain/supabase';
import type { Id } from '../domain/types';

interface ShareDialogProps {
  familyId: Id | null;
  familyName: string;
  canInvite: boolean;
  onClose: () => void;
  onExport: () => void;
  onGedcom: () => void;
  onPrint: () => void;
  onOpenCloud: () => void;
}

export default function ShareDialog({
  familyId,
  familyName,
  canInvite,
  onClose,
  onExport,
  onGedcom,
  onPrint,
  onOpenCloud,
}: ShareDialogProps) {
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!familyId) return;
    setBusy(true);
    setNotice(null);
    try {
      setToken(await createInvitation(familyId));
      setNotice('Jeton créé : il donne accès en modification et expire dans 90 jours.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Génération impossible.');
    } finally {
      setBusy(false);
    }
  };

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal share-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Partager et exporter l’arbre"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Partager et exporter</h2>
            <p>{familyName}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Fermer"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="modal-body share-body">
          {notice && <div className="dialog-notice is-info">{notice}</div>}

          <section className="cloud-section">
            <h3>Inviter un proche</h3>
            {canInvite ? (
              <>
                <p className="panel-note">
                  Un jeton permet de créer un compte puis d’accéder à cet arbre
                  avec le droit de le modifier.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-mini"
                  disabled={busy}
                  onClick={() => void generate()}
                >
                  Générer un jeton
                </button>
                {token && (
                  <input
                    className="cloud-token"
                    readOnly
                    value={token}
                    onFocus={(event) => event.target.select()}
                    aria-label="Jeton d’accès généré"
                  />
                )}
              </>
            ) : (
              <p className="panel-note">
                Seul un administrateur peut générer un jeton pour cet arbre.
              </p>
            )}
          </section>

          <section className="cloud-section">
            <h3>Exporter</h3>
            <div className="share-actions">
              <button type="button" className="drawer-item" onClick={() => run(onExport)}>
                Exporter en JSON
              </button>
              <button type="button" className="drawer-item" onClick={() => run(onGedcom)}>
                Exporter en GEDCOM
              </button>
              <button type="button" className="drawer-item" onClick={() => run(onPrint)}>
                Imprimer
              </button>
            </div>
          </section>

          <section className="cloud-section">
            <h3>Arbre</h3>
            <button
              type="button"
              className="drawer-item"
              onClick={() => run(onOpenCloud)}
            >
              Changer d’arbre
            </button>
          </section>
        </div>

        <footer className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
        </footer>
      </div>
    </div>
  );
}
