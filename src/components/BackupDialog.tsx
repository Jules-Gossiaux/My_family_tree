import { useEffect, useState } from 'react';
import {
  formatBackupDate,
  type BackupSummary,
} from '../domain/repository';

interface BackupDialogProps {
  backups: BackupSummary[];
  onRestore: (id: string) => void;
  onExport: () => void;
  onClose: () => void;
}

export default function BackupDialog({
  backups,
  onRestore,
  onExport,
  onClose,
}: BackupDialogProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2 id="backup-title">Sauvegardes</h2>
            <p className="modal-subtitle">
              Une copie est enregistrée automatiquement avant chaque modification.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Fermer"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          {backups.length === 0 ? (
            <p className="panel-note">
              Aucune copie pour l’instant. Elles apparaîtront dès que vous
              modifierez l’arbre.
            </p>
          ) : (
            <ul className="backup-list">
              {backups.map((backup) => (
                <li key={backup.id} className="backup-item">
                  <div className="backup-info">
                    <strong>{formatBackupDate(backup.savedAt)}</strong>
                    <span>
                      {backup.persons} personne{backup.persons > 1 ? 's' : ''} ·{' '}
                      {backup.unions} union{backup.unions > 1 ? 's' : ''}
                    </span>
                  </div>
                  {confirmId === backup.id ? (
                    <div className="backup-confirm">
                      <button
                        type="button"
                        className="btn btn-mini btn-primary"
                        onClick={() => {
                          onRestore(backup.id);
                          setConfirmId(null);
                        }}
                      >
                        Confirmer
                      </button>
                      <button
                        type="button"
                        className="btn btn-mini"
                        onClick={() => setConfirmId(null)}
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-mini"
                      onClick={() => setConfirmId(backup.id)}
                    >
                      Restaurer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="panel-note">
            Restaurer remplace l’état actuel ; l’état remplacé devient à son tour
            une copie de secours. Exportez aussi régulièrement un fichier JSON
            complet pour le conserver hors du navigateur.
          </p>
        </div>

        <footer className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          <button type="button" className="btn btn-primary" onClick={onExport}>
            Exporter la sauvegarde complète
          </button>
        </footer>
      </section>
    </div>
  );
}
