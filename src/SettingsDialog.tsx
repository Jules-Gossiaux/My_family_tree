import { useEffect, useState } from 'react';
import { api } from './api';
import { saveFromServer } from './saveFile';
import { fullName } from './dates';
import type { BackupInfo, Person } from '../shared/types';

interface Props {
  dataDir: string;
  dataDirFromEnv: boolean;
  rootPersonId: string | null;
  persons: Person[];
  onClose: () => void;
  onRootChange: (personId: string) => void;
  onBackup: (info: BackupInfo) => void;
  onToast: (message: string) => void;
}

function size(bytes: number): string {
  const mo = bytes / 1024 / 1024;
  return mo >= 1
    ? `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 }).format(mo)} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} ko`;
}

function archiveDate(backup: BackupInfo): string {
  return new Date(backup.createdAt).toLocaleString('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Le nom porte le motif de l'archive : « session », « manuel », « avant-restauration ». */
function reason(name: string): string {
  const parts = name.replace(/^famille-/, '').replace(/\.zip$/, '').split('-');
  return parts.slice(4).join(' ') || 'archive';
}

/**
 * L'écran de fin de saisie : où vivent les données, de qui l'arbre part, et comment une copie
 * sort du disque. Trois choses que l'on ne regarde qu'une fois, mais qu'il faut pouvoir faire
 * sans fermer l'application ni ouvrir un terminal.
 */
export default function SettingsDialog({
  dataDir,
  dataDirFromEnv,
  rootPersonId,
  persons,
  onClose,
  onRootChange,
  onBackup,
  onToast,
}: Props) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [draftDir, setDraftDir] = useState('');
  const [dirNote, setDirNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'backup' | 'export' | 'copy' | 'dir' | null>(null);
  const [copyingName, setCopyingName] = useState<string | null>(null);

  const reloadBackups = async () => {
    try {
      const list = await api.backups();
      setBackups(list.backups);
    } catch {
      /* le dossier de sauvegardes peut être vide : la liste s'affiche simplement vide */
    }
  };

  useEffect(() => {
    void reloadBackups();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changeDir = async () => {
    if (!draftDir.trim() || busy) return;
    setBusy('dir');
    setError(null);
    setDirNote(null);
    try {
      const result = await api.setDataDir(draftDir);
      setDraftDir('');
      setDirNote(result.note);
      if (result.restartNeeded) onToast('Dossier enregistré : redémarrez pour l’ouvrir');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ce dossier n’est pas utilisable');
    } finally {
      setBusy(null);
    }
  };

  const runBackup = async () => {
    if (busy) return;
    setBusy('backup');
    setError(null);
    try {
      const info = await api.backup();
      onBackup(info);
      await reloadBackups();
      onToast('Sauvegarde créée');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sauvegarde impossible');
    } finally {
      setBusy(null);
    }
  };

  const save = async (url: string, name: string, whileBusy: 'export' | 'copy') => {
    if (busy) return;
    setBusy(whileBusy);
    setCopyingName(name);
    setError(null);
    try {
      const saved = await saveFromServer(url, name);
      if (saved) onToast(whileBusy === 'export' ? 'Arbre exporté en JSON' : 'Copie enregistrée');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copie impossible');
    } finally {
      setBusy(null);
      setCopyingName(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog dialog-settings" onMouseDown={(event) => event.stopPropagation()}>
        <h2 className="dialog-title">Réglages</h2>

        <div className="section">
          <h3 className="section-title">Dossier de données</h3>
          <p className="settings-value">{dataDir}</p>
          {dataDirFromEnv && (
            <p className="settings-note">
              Ce chemin vient de la variable <code>FAMILY_DATA_DIR</code> : elle prime sur le choix
              fait ici.
            </p>
          )}
          <div className="field-row align-end">
            <label className="field">
              <span>Changer pour</span>
              <input
                value={draftDir}
                onChange={(event) => setDraftDir(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void changeDir();
                }}
                placeholder="D:\Genealogie"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="ghost"
              onClick={changeDir}
              disabled={busy !== null || !draftDir.trim()}
            >
              {busy === 'dir' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          {dirNote && <p className="pick-summary">{dirNote}</p>}
        </div>

        <div className="section">
          <h3 className="section-title">Souche de l'arbre</h3>
          {persons.length === 0 ? (
            <p className="settings-note">Ajoutez d’abord une personne.</p>
          ) : (
            <>
              <select
                value={rootPersonId ?? ''}
                onChange={(event) => onRootChange(event.target.value)}
              >
                <option value="" disabled>
                  Aucune personne de référence
                </option>
                {persons.map((person) => (
                  <option key={person.id} value={person.id}>
                    {fullName(person)}
                  </option>
                ))}
              </select>
              <p className="settings-note">
                L’arbre et l’export partent de cette personne. Le bouton « Faire la souche de l’arbre
                » du menu d’une personne fait la même chose.
              </p>
            </>
          )}
        </div>

        <div className="section">
          <h3 className="section-title">Sauvegardes et export</h3>
          <p className="settings-note">
            L’application archive la base et les médias dans <code>sauvegardes\</code> et garde les
            vingt dernières copies. Une copie sur le même disque ne protège de rien : « Copier
            vers… » range l’archive sur un autre support, et l’export JSON se relit sans
            l’application.
          </p>
          <div className="actions">
            <button type="button" onClick={runBackup} disabled={busy !== null}>
              {busy === 'backup' ? 'Sauvegarde…' : 'Sauvegarder maintenant'}
            </button>
            <button
              type="button"
              onClick={() => save(api.exportJsonUrl, 'arbre.json', 'export')}
              disabled={busy !== null}
            >
              {busy === 'export' ? 'Export…' : 'Enregistrer l’arbre en JSON…'}
            </button>
          </div>
          {backups.length === 0 ? (
            <p className="settings-note">Aucune archive pour l’instant.</p>
          ) : (
            <ul className="file-list">
              {backups.map((backup) => (
                <li key={backup.name}>
                  <span className="file-name">{archiveDate(backup)}</span>
                  <span className="file-meta">
                    {reason(backup.name)} · {size(backup.size)}
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => save(api.backupFileUrl(backup.name), backup.name, 'copy')}
                    disabled={busy !== null}
                  >
                    {busy === 'copy' && copyingName === backup.name
                      ? 'Copie…'
                      : 'Copier vers…'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="settings-note">
            Recharger une archive ne se commande pas ici : l’application ne peut pas remplacer la
            base sur laquelle elle est assise. Fermez-la (la fenêtre ouverte par{' '}
            <code>start.bat</code>), double-cliquez <code>restore.bat</code> dans ce dossier,
            choisissez le numéro de l’archive et tapez OUI. Ce qui était en place est copié avant
            d’être remplacé, donc le voyage a un retour.
          </p>
        </div>

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <span className="hint-key">Fermer avec Échap</span>
          <button type="button" className="primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
