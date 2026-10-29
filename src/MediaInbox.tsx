import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import MediaEditor from './MediaEditor';
import MediaLightbox from './MediaLightbox';
import { kindOf, prepareUpload, takenOf } from './thumbnails';
import { formatDate, fullName, lifeSpan } from './dates';
import type { Media, Person } from '../shared/types';

interface Props {
  persons: Person[];
  onClose: () => void;
  onChanged: () => void;
  onToast: (message: string) => void;
}

interface Upload {
  name: string;
  state: 'en cours' | 'fait' | 'doublon' | 'échec';
  message?: string;
}

const MAX_PER_GO = 40;

/**
 * Le bac d'entrée : tout ce qui est arrivé dans le dossier sans savoir à qui parler.
 *
 * On dépose d'abord, on rattache ensuite — c'est l'ordre réel d'une boîte à chaussures. Le
 * rattachement par lot existe parce qu'une photo de mariage porte souvent dix noms et que les
 * saisir un par un est le meilleur moyen d'abandonner le projet.
 */
export default function MediaInbox({ persons, onClose, onChanged, onToast }: Props) {
  const [unattached, setUnattached] = useState<Media[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<Person | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const { media } = await api.unattachedMedia();
      setUnattached(media);
      setSelected((current) => current.filter((id) => media.some((m) => m.id === id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le bac d’entrée n’a pas pu être lu.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (viewer !== null) setViewer(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, viewer]);

  const importFiles = useCallback(
    async (files: File[]) => {
      const batch = files.slice(0, MAX_PER_GO);
      if (!batch.length) return;
      if (files.length > batch.length) {
        setError(`${files.length} fichiers : on n'en traite que ${batch.length} à la fois.`);
      }
      setUploads(batch.map((file) => ({ name: file.name, state: 'en cours' as const })));

      for (const [index, file] of batch.entries()) {
        const mark = (entry: Upload) =>
          setUploads((current) => current.map((one, i) => (i === index ? entry : one)));
        try {
          const prepared = await prepareUpload(file);
          const { media, deduped } = await api.uploadMedia(file, {
            kind: kindOf(file),
            taken: takenOf(file) || null,
            width: prepared.width,
            height: prepared.height,
          });
          if (!deduped && prepared.thumb) await api.uploadThumbnail(media.id, prepared.thumb);
          mark({ name: file.name, state: deduped ? 'doublon' : 'fait' });
        } catch (err) {
          mark({
            name: file.name,
            state: 'échec',
            message: err instanceof Error ? err.message : 'import impossible',
          });
        }
      }

      await reload();
      onChanged();
    },
    [onChanged, reload],
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = persons.filter(
      (person) =>
        !needle || `${person.givenNames} ${person.familyName} ${person.birthName ?? ''}`.toLowerCase().includes(needle),
    );
    return pool.slice(0, 8);
  }, [persons, query]);

  const attach = async () => {
    if (!target || !selected.length || busy) return;
    setBusy(true);
    setError(null);
    const count = selected.length;
    try {
      for (const id of selected) await api.attachMedia(id, [target.id]);
      setTarget(null);
      setQuery('');
      await reload();
      onChanged();
      onToast(`${count} média${count > 1 ? 's' : ''} rattaché${count > 1 ? 's' : ''} à ${fullName(target)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le rattachement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    setBusy(true);
    setError(null);
    const count = selected.length;
    try {
      for (const id of selected) await api.deleteMedia(id);
      setSelected([]);
      setConfirmDelete(false);
      await reload();
      onChanged();
      onToast(`${count} média${count > 1 ? 's' : ''} supprimé${count > 1 ? 's' : ''} du dossier`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((one) => one !== id) : [...current, id]));

  // Le lecteur suit l'identifiant, jamais la place dans la grille : recharger le bac pendant qu'une
  // fiche est ouverte ne doit pas le faire sauter sur une photo voisine.
  const viewedIndex = viewer === null ? -1 : unattached.findIndex((media) => media.id === viewer);
  const viewed = viewedIndex >= 0 ? unattached[viewedIndex] : null;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog dialog-inbox"
        onMouseDown={(event) => event.stopPropagation()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void importFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <h2 className="dialog-title">Bac d’entrée</h2>
        <p className="dialog-context">
          {unattached.length === 0
            ? 'Rien à rattacher : chaque média du dossier porte déjà un nom.'
            : `${unattached.length} média${unattached.length > 1 ? 's' : ''} en attente de visage.`}
        </p>

        <div className={`dropzone${dragging ? ' is-dragging' : ''}`}>
          <p>
            Déposez ici vos scans et photos, ou{' '}
            <button type="button" className="link" onClick={() => input.current?.click()}>
              choisissez des fichiers
            </button>
            . L’original est rangé tel quel, jamais retouché.
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            onChange={(event) => {
              void importFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        </div>

        {uploads.length > 0 && (
          <ul className="upload-list">
            {uploads.map((entry, index) => (
              <li
                key={`${entry.name}-${index}`}
                className={`upload-item is-${
                  entry.state === 'en cours' ? 'busy' : entry.state === 'fait' ? 'done' : entry.state === 'doublon' ? 'dup' : 'fail'
                }`}
              >
                <span className="upload-name">{entry.name}</span>
                <span className="upload-state">{entry.state === 'échec' ? entry.message : entry.state}</span>
              </li>
            ))}
          </ul>
        )}

        {unattached.length > 0 && (
          <div className="media-grid">
            {unattached.map((media) => (
              <div key={media.id} className={`media-tile${selected.includes(media.id) ? ' is-selected' : ''}`}>
                <button
                  type="button"
                  className="media-open"
                  onClick={() => setViewer(media.id)}
                  title={media.caption || 'Ouvrir'}
                >
                  {media.hasThumb ? (
                    <img src={api.mediaUrl(media.id, 'thumb')} alt="" loading="lazy" />
                  ) : (
                    <span className="media-placeholder">{media.kind === 'photo' ? 'photo' : 'document'}</span>
                  )}
                </button>
                <label className="media-pick">
                  <input
                    type="checkbox"
                    checked={selected.includes(media.id)}
                    onChange={() => toggle(media.id)}
                  />
                  <span>{media.caption || formatDate(media.date) || 'date inconnue'}</span>
                </label>
              </div>
            ))}
          </div>
        )}

        {selected.length > 0 && (
          <div className="inbox-attach">
            <p className="dialog-text">
              <strong>{selected.length}</strong> média{selected.length > 1 ? 's' : ''} sélectionné
              {selected.length > 1 ? 's' : ''}.
            </p>

            <label className="field">
              <span>Qui est dessus</span>
              <input
                value={target ? fullName(target) : query}
                onChange={(event) => {
                  setTarget(null);
                  setQuery(event.target.value);
                }}
                placeholder="Rechercher une personne"
                autoComplete="off"
              />
            </label>

            {!target && results.length > 0 && (
              <div className="pick-list">
                {results.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="pick-row"
                    onClick={() => {
                      setTarget(person);
                      setQuery('');
                    }}
                  >
                    <span className="pick-name">{fullName(person)}</span>
                    <span className="pick-dates">{lifeSpan(person)}</span>
                  </button>
                ))}
              </div>
            )}

            {target && <p className="pick-summary">Rattacher la sélection à <strong>{fullName(target)}</strong></p>}

            <div className="actions">
              <button type="button" className="primary" onClick={() => void attach()} disabled={!target || busy}>
                {busy ? 'Rattachement…' : 'Rattacher'}
              </button>
              <button
                type="button"
                className={confirmDelete ? 'danger-solid' : 'ghost'}
                onClick={() => (confirmDelete ? void removeSelected() : setConfirmDelete(true))}
                disabled={busy}
              >
                {confirmDelete ? 'Confirmer la suppression' : 'Supprimer la sélection'}
              </button>
              {confirmDelete && (
                <button type="button" className="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Renoncer
                </button>
              )}
            </div>
            <p className="settings-note">
              Supprimer efface le fichier du dossier des médias, pas seulement son signalement : cette
              demande est la seule de l’application qui détruise une image.
            </p>
          </div>
        )}

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <span className="hint-key">Fermer avec Échap</span>
          <button type="button" className="ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>

      {viewed && (
        <MediaLightbox
          items={unattached}
          index={viewedIndex}
          onIndex={(index) => setViewer(unattached[index]?.id ?? null)}
          onClose={() => setViewer(null)}
        >
          <MediaEditor
            media={viewed}
            onSaved={() => {
              void reload();
              onChanged();
            }}
          />
        </MediaLightbox>
      )}
    </div>
  );
}
