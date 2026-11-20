import { useEffect, useState } from 'react';
import {
  deleteFamily,
  familyMemberCount,
  leaveFamily,
  listFamilyMembers,
  type CloudFamily,
  type CloudFamilyMember,
} from '../domain/supabase';
import type { Id } from '../domain/types';

interface FamilyActionDialogProps {
  family: CloudFamily;
  currentUserId: Id;
  onClose: () => void;
  onExport: () => void;
  onDone: (familyId: Id, action: 'deleted' | 'left') => void;
}

type Mode = 'delete' | 'leave';

export default function FamilyActionDialog({
  family,
  currentUserId,
  onClose,
  onExport,
  onDone,
}: FamilyActionDialogProps) {
  const [count, setCount] = useState<number | null>(null);
  const [members, setMembers] = useState<CloudFamilyMember[]>([]);
  const [successor, setSuccessor] = useState<Id | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = family.role === 'admin';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const total = await familyMemberCount(family.id);
        if (cancelled) return;
        setCount(total);
        setMode(total === 1 ? 'delete' : isAdmin ? null : 'leave');
        if (isAdmin && total > 1) {
          const all = await listFamilyMembers(family.id);
          if (cancelled) return;
          const others = all.filter((member) => member.id !== currentUserId);
          setMembers(others);
          setSuccessor(others[0]?.id ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setNotice(
            error instanceof Error ? error.message : 'Informations indisponibles.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [family.id, isAdmin, currentUserId]);

  const confirm = async () => {
    if (!mode) return;
    setBusy(true);
    setNotice(null);
    try {
      if (mode === 'delete') {
        // Un admin supprime l'arbre ; le dernier membre le supprime en partant.
        if (isAdmin) await deleteFamily(family.id);
        else await leaveFamily(family.id);
        onDone(family.id, 'deleted');
        return;
      }
      if (isAdmin && !successor) {
        throw new Error('Choisissez le membre qui deviendra administrateur.');
      }
      await leaveFamily(family.id, successor ?? undefined);
      onDone(family.id, 'left');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Action impossible.');
      setBusy(false);
    }
  };

  const disabled =
    busy ||
    count === null ||
    (mode === 'delete' && confirmName.trim() !== family.name) ||
    (mode === 'leave' && isAdmin && !successor);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal family-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Action sur l’arbre ${family.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{family.name}</h2>
            <p>Votre rôle : {family.role}</p>
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

        <div className="modal-body family-action-body">
          {notice && <div className="dialog-notice is-error">{notice}</div>}

          {count === null ? (
            <p className="panel-note">Chargement des informations…</p>
          ) : (
            <>
              <p className="panel-note">
                {count === 1
                  ? 'Vous êtes le seul membre de cet arbre : le quitter revient à le supprimer.'
                  : `Cet arbre compte ${count} membres.`}
              </p>

              {isAdmin && count > 1 && (
                <div className="family-action-choices">
                  <button
                    type="button"
                    className={`drawer-item${mode === 'leave' ? ' is-active' : ''}`}
                    onClick={() => setMode('leave')}
                  >
                    Quitter l’arbre
                  </button>
                  <button
                    type="button"
                    className={`drawer-item drawer-item-danger${mode === 'delete' ? ' is-active' : ''}`}
                    onClick={() => setMode('delete')}
                  >
                    Supprimer définitivement
                  </button>
                </div>
              )}

              {mode === 'leave' && (
                <section className="cloud-section">
                  <h3>Quitter l’arbre</h3>
                  {isAdmin ? (
                    <>
                      <p className="panel-note">
                        Vous êtes admin : choisissez qui prendra le relais.
                      </p>
                      <label className="field">
                        <span>Nouvel administrateur</span>
                        <select
                          value={successor ?? ''}
                          onChange={(event) =>
                            setSuccessor(event.target.value as Id)
                          }
                        >
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.email || 'Membre'} · {member.role} · depuis{' '}
                              {new Date(member.joinedAt).toLocaleDateString()}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <p className="panel-note">
                      Les autres membres conservent l’arbre et leurs données.
                    </p>
                  )}
                </section>
              )}

              {mode === 'delete' && (
                <section className="cloud-section">
                  <h3>Supprimer définitivement</h3>
                  <p className="panel-note">
                    Le document, les invitations, les médias et tous les membres
                    seront supprimés. Cette action est irréversible.
                  </p>
                  <button
                    type="button"
                    className="btn btn-mini"
                    onClick={onExport}
                  >
                    Exporter une sauvegarde avant de supprimer
                  </button>
                  <label className="field family-confirm">
                    <span>Tapez le nom de l’arbre pour confirmer</span>
                    <input
                      value={confirmName}
                      placeholder={family.name}
                      onChange={(event) => setConfirmName(event.target.value)}
                    />
                  </label>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className={`btn ${
              mode === 'delete' ? 'btn-danger-confirm' : 'btn-primary'
            }`}
            disabled={disabled}
            onClick={() => void confirm()}
          >
            {mode === 'delete'
              ? 'Supprimer définitivement'
              : 'Confirmer mon départ'}
          </button>
        </footer>
      </div>
    </div>
  );
}
