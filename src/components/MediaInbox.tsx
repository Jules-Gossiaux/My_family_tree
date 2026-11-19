import { useEffect, useMemo, useRef, useState } from 'react';
import {
  importFiles,
  makeThumbnail,
  MAX_FILES_PER_BATCH,
  prepareFiles,
  type PreparedFile,
} from '../domain/mediaInbox';
import { mediaStore } from '../domain/mediaStore';
import { personChoiceLabel } from '../domain/personChoices';
import { linkMedia, mediaUsageLabel } from '../domain/directories';
import { type FamilyData, type Id, type Media } from '../domain/types';

interface MediaInboxProps {
  data: FamilyData;
  onChange: (next: FamilyData) => void;
}

type Target = { kind: 'person'; id: Id } | { kind: 'event'; id: Id };

export default function MediaInbox({ data, onChange }: MediaInboxProps) {
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<PreparedFile[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<Media | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<'all' | 'unattached'>('all');
  const visibleMedia = useMemo(
    () =>
      filter === 'unattached'
        ? data.media.filter((medium) => medium.personIds.length === 0)
        : data.media,
    [data.media, filter],
  );

  const unattached = useMemo(
    () => data.media.filter((medium) => medium.personIds.length === 0),
    [data.media],
  );

  useEffect(() => {
    if (!lightbox) {
      setLightboxUrl('');
      return;
    }
    let cancelled = false;
    let created = '';
    void (async () => {
      const url = /^(data:|blob:|https?:)/i.test(lightbox.key)
        ? lightbox.key
        : await mediaStore.get(lightbox.key).then((blob) =>
            blob ? URL.createObjectURL(blob) : '',
          );
      if (url.startsWith('blob:')) created = url;
      if (!cancelled) setLightboxUrl(url);
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [lightbox]);

  const prepare = async (files: File[]) => {
    if (files.length === 0) return;
    const prepared = await prepareFiles(files.slice(0, MAX_FILES_PER_BATCH), data);
    setPending(prepared);
    setNotice(
      files.length > MAX_FILES_PER_BATCH
        ? `${MAX_FILES_PER_BATCH} fichiers maximum par passe : les suivants ont été ignorés.`
        : null,
    );
    const images = prepared.filter((entry) => !entry.error && entry.kind === 'photo');
    const generated: Record<string, string> = {};
    for (const entry of images) {
      try {
        generated[entry.fingerprint] = await makeThumbnail(entry.file);
      } catch {
        // Vignette facultative : le média reste importable.
      }
    }
    setThumbs(generated);
  };

  const commit = async () => {
    const personIds = target?.kind === 'person' ? [target.id] : [];
    const eventId = target?.kind === 'event' ? target.id : undefined;
    const outcome = await importFiles(data, pending, personIds, eventId);
    onChange(outcome.data);
    const parts: string[] = [];
    if (outcome.added) parts.push(`${outcome.added} fichier(s) importé(s)`);
    if (outcome.duplicates) parts.push(`${outcome.duplicates} doublon(s) réutilisé(s)`);
    if (outcome.errors.length) parts.push(`${outcome.errors.length} erreur(s)`);
    setNotice(parts.join(' · ') || 'Aucun fichier importé.');
    setPending([]);
    setThumbs({});
  };

  const attachSelected = (to: Target) => {
    if (selected.size === 0) return;
    let next = data;
    for (const id of selected) {
      if (to.kind === 'person') next = linkMedia(next, id, to.id);
      else {
        next = {
          ...next,
          events: next.events.map((event) =>
            event.id === to.id && !event.mediaIds.includes(id)
              ? { ...event, mediaIds: [...event.mediaIds, id] }
              : event,
          ),
        };
      }
    }
    onChange(next);
    setNotice(`${selected.size} média(s) rattaché(s).`);
    setSelected(new Set());
  };

  const personTargets = data.persons;
  const eventTargets = data.events;

  return (
    <div className="media-inbox">
      <div className="modal-header">
        <h2>Photos et documents</h2>
        <p className="modal-subtitle">
          Glissez vos fichiers ici ou choisissez-les. Les doublons sont détectés
          par empreinte et réutilisés.
        </p>
      </div>

      <div
        className={`media-dropzone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void prepare(Array.from(event.dataTransfer.files));
        }}
      >
        <strong>Déposer des fichiers</strong>
        <span>
          JPEG, PNG, WebP, GIF, PDF · 40 fichiers par passe · 60 Mo par fichier
        </span>
        <button
          type="button"
          className="btn btn-primary btn-mini"
          onClick={() => fileInputRef.current?.click()}
        >
          Choisir des fichiers
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf"
          className="hidden-input"
          onChange={(event) => {
            void prepare(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>

      <label className="field">
        <span>Rattacher les fichiers importés à</span>
        <select
          value={target ? `${target.kind}:${target.id}` : ''}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) setTarget(null);
            else {
              const [kind, id] = value.split(':');
              setTarget({ kind: kind as Target['kind'], id });
            }
          }}
        >
          <option value="">Aucune liaison pour l’instant</option>
          <optgroup label="Personnes">
            {personTargets.map((person) => (
              <option key={person.id} value={`person:${person.id}`}>
                {personChoiceLabel(data, person)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Faits de vie">
            {eventTargets.map((event) => (
              <option key={event.id} value={`event:${event.id}`}>
                {event.title || event.type}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      {notice && <div className="dialog-notice">{notice}</div>}

      {pending.length > 0 && (
        <section className="media-pending">
          <h3>Fichiers en attente ({pending.length})</h3>
          <ul>
            {pending.map((entry) => (
              <li key={`${entry.file.name}-${entry.fingerprint}`}>
                {thumbs[entry.fingerprint] ? (
                  <img src={thumbs[entry.fingerprint]} alt="" />
                ) : (
                  <span className="media-file-icon">▣</span>
                )}
                <span className="media-file-name">{entry.file.name}</span>
                {entry.duplicateOf && (
                  <span className="media-badge">Doublon de {entry.duplicateOf.fileName}</span>
                )}
                {entry.error && <span className="media-error">{entry.error}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary" onClick={() => void commit()}>
            Importer la passe
          </button>
        </section>
      )}

      <section className="media-library">
        <div className="media-library-head">
          <h3>Photos et documents ({data.media.length})</h3>
          <div className="media-batch">
            <label className="field">
              <span>Afficher</span>
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as 'all' | 'unattached')
                }
              >
                <option value="all">Tous</option>
                <option value="unattached">Non rattachés ({unattached.length})</option>
              </select>
            </label>
          {selected.size > 0 && (
            <div className="media-batch">
              <span>{selected.size} sélectionné(s)</span>
              <select
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  const [kind, id] = value.split(':');
                  attachSelected({ kind: kind as Target['kind'], id });
                }}
              >
                <option value="">Rattacher à…</option>
                {personTargets.map((person) => (
                  <option key={person.id} value={`person:${person.id}`}>
                    {personChoiceLabel(data, person)}
                  </option>
                ))}
                {eventTargets.map((event) => (
                  <option key={event.id} value={`event:${event.id}`}>
                    {event.title || event.type}
                  </option>
                ))}
              </select>
            </div>
          )}
          </div>
        </div>
        {visibleMedia.length === 0 ? (
          <p className="panel-note">
            {filter === 'unattached'
              ? 'Tous les médias sont rattachés à au moins une personne ou un fait.'
              : 'Aucun média pour l’instant.'}
          </p>
        ) : (
          <div className="media-library-grid">
            {visibleMedia.map((medium) => (
              <article key={medium.id} className="media-library-item">
                <label className="media-select">
                  <input
                    type="checkbox"
                    checked={selected.has(medium.id)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(medium.id)) next.delete(medium.id);
                        else next.add(medium.id);
                        return next;
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="media-open"
                  onClick={() => setLightbox(medium)}
                >
                  {medium.kind === 'photo' ? 'Voir' : 'DOC'}
                </button>
                <strong>{medium.title || medium.fileName}</strong>
                <small>{mediaUsageLabel(data, medium)}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" onMouseDown={() => setLightbox(null)}>
          <div className="lightbox-inner" onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="lightbox-close"
              aria-label="Fermer"
              onClick={() => setLightbox(null)}
            >
              ×
            </button>
            {lightbox.kind === 'photo' && lightboxUrl ? (
              <img src={lightboxUrl} alt={lightbox.title || lightbox.fileName} />
            ) : (
              <a href={lightboxUrl || '#'} target="_blank" rel="noreferrer">
                Ouvrir {lightbox.fileName}
              </a>
            )}
            <div className="lightbox-caption">
              <strong>{lightbox.title || lightbox.fileName}</strong>
              <span>{mediaUsageLabel(data, lightbox)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
