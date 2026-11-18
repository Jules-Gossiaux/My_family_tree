import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import DirectorySelect from './DirectorySelect';
import {
  addSource,
  deleteMedia,
  duplicateSource,
  linkMedia,
  mediaOfPerson,
  setPortrait,
  setPortraitCrop,
  unlinkMedia,
  updateMedia,
} from '../domain/directories';
import { mediaStore } from '../domain/mediaStore';
import { importFiles, prepareFiles } from '../domain/mediaInbox';
import {
  DEFAULT_PORTRAIT_CROP,
  type FamilyData,
  type Id,
  type Media,
  type PortraitCrop,
} from '../domain/types';

interface MediaGalleryProps {
  data: FamilyData;
  personId: Id;
  onChange: (next: FamilyData) => void;
  /** Incrémenté par le panneau pour ouvrir directement le sélecteur de fichiers. */
  uploadSignal?: number;
}

function isDirectUrl(key: string): boolean {
  return /^(data:|blob:|https?:)/i.test(key);
}

/** Galerie partagée, portrait désigné et réglage de cadrage par personne. */
export default function MediaGallery({ data, personId, onChange, uploadSignal }: MediaGalleryProps) {
  const person = data.persons.find((candidate) => candidate.id === personId);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    const run = async () => {
      const next: Record<string, string> = {};
      for (const medium of data.media) {
        if (next[medium.key]) continue;
        if (isDirectUrl(medium.key)) {
          next[medium.key] = medium.key;
          continue;
        }
        const blob = await mediaStore.get(medium.key);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        created.push(url);
        next[medium.key] = url;
      }
      if (cancelled) created.forEach((url) => URL.revokeObjectURL(url));
      else setUrls(next);
    };
    void run();
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [data.media]);

  useEffect(() => {
    if (uploadSignal && uploadSignal > 0) fileInputRef.current?.click();
  }, [uploadSignal]);

  if (!person) return null;
  const ownMedia = mediaOfPerson(data, personId);
  const portrait = ownMedia.find((medium) => medium.id === person.portraitMediaId);
  const crop: PortraitCrop = person.portraitCrop ?? DEFAULT_PORTRAIT_CROP;
  const sourceOptions = data.sources.map((source) => ({
    id: source.id,
    label: `${source.reference} — ${source.title}`,
  }));

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const prepared = await prepareFiles(files, data);
    const outcome = await importFiles(data, prepared, [personId]);
    onChange(outcome.data);
    const messages: string[] = [];
    if (outcome.added) messages.push(`${outcome.added} fichier(s) ajouté(s).`);
    if (outcome.duplicates) messages.push(`${outcome.duplicates} doublon(s) réutilisé(s).`);
    if (outcome.errors.length) messages.push(outcome.errors.join(' '));
    setError(messages.join(' ') || null);
  };

  const quickSource = (name: string): string | undefined => {
    if (duplicateSource(data, name)) {
      setError('Cette référence de source existe déjà.');
      return undefined;
    }
    const next = addSource(data, { reference: name, title: name, kind: 'other' });
    const created = next.sources.find((source) => source.reference === name);
    if (created) onChange(next);
    return created?.id;
  };

  const citeMedium = (medium: Media, sourceId: string | undefined) => {
    if (!sourceId) return;
    if (medium.citations.some((citation) => citation.sourceId === sourceId)) return;
    onChange(
      updateMedia(data, medium.id, {
        citations: [...medium.citations, { sourceId }],
      }),
    );
  };

  const remove = (medium: Media) => {
    if (!window.confirm(`Supprimer définitivement « ${medium.title || medium.fileName} » ?`)) return;
    void mediaStore.delete(medium.key);
    onChange(deleteMedia(data, medium.id));
  };

  return (
    <div className="gallery">
      <section className="portrait-editor">
        <h3>Portrait</h3>
        <div className="portrait-editor-body">
          <div className="portrait-preview">
            {portrait && urls[portrait.key] ? (
              <div
                className="portrait-preview-image"
                style={{
                  backgroundImage: `url("${urls[portrait.key]}")`,
                  backgroundPosition: `${crop.x * 100}% ${crop.y * 100}%`,
                  transform: `scale(${crop.zoom})`,
                }}
              />
            ) : (
              <span className="portrait-placeholder">Aucun portrait</span>
            )}
          </div>
          <div className="portrait-settings">
            {portrait ? (
              <>
                <p className="panel-note">
                  Cadrage propre à cette personne ; les autres personnes liées à
                  cette photo gardent le leur.
                </p>
                <label className="range-field">
                  <span>Zoom · {crop.zoom.toFixed(2)}×</span>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={crop.zoom}
                    onChange={(event) =>
                      onChange(
                        setPortraitCrop(data, personId, {
                          ...crop,
                          zoom: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="range-field">
                  <span>Cadrage horizontal · {Math.round(crop.x * 100)} %</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={crop.x}
                    onChange={(event) =>
                      onChange(
                        setPortraitCrop(data, personId, {
                          ...crop,
                          x: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="range-field">
                  <span>Cadrage vertical · {Math.round(crop.y * 100)} %</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={crop.y}
                    onChange={(event) =>
                      onChange(
                        setPortraitCrop(data, personId, {
                          ...crop,
                          y: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-mini"
                  onClick={() =>
                    onChange(setPortraitCrop(data, personId, DEFAULT_PORTRAIT_CROP))
                  }
                >
                  Recentrer
                </button>
              </>
            ) : (
              <p className="panel-note">
                Choisissez une photo de la galerie ci-dessous, puis ajustez son
                cadrage ici.
              </p>
            )}
          </div>
        </div>
      </section>

      {error && <div className="dialog-notice is-error">{error}</div>}

      <section className="gallery-upload">
        <label className="btn btn-primary">
          Ajouter des fichiers
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt"
            className="hidden-input"
            onChange={(event) => void handleFiles(event)}
          />
        </label>
        <DirectorySelect
          label="Lier un média existant"
          options={data.media
            .filter((medium) => !medium.personIds.includes(personId))
            .map((medium) => ({
              id: medium.id,
              label: medium.title || medium.fileName,
            }))}
          emptyLabel="Choisir un média…"
          onChange={(id) => {
            if (id) onChange(linkMedia(data, id, personId));
          }}
        />
      </section>

      <section className="gallery-grid">
        {ownMedia.length === 0 ? (
          <p className="panel-note">Aucune photo ni document rattaché.</p>
        ) : (
          ownMedia.map((medium) => (
            <article key={medium.id} className="gallery-card">
              <div className="gallery-thumb">
                {medium.kind === 'photo' && urls[medium.key] ? (
                  <img src={urls[medium.key]} alt={medium.title || medium.fileName} />
                ) : (
                  <span className="gallery-doc-icon">{medium.kind === 'photo' ? '?' : 'DOC'}</span>
                )}
              </div>
              <div className="gallery-card-body">
                <strong>{medium.title || medium.fileName}</strong>
                <span className="panel-note">{medium.fileName}</span>
                <span className="gallery-shared">{medium.personIds.length} personne(s)</span>
                <input
                  value={medium.title ?? ''}
                  placeholder="Titre du média"
                  onChange={(event) =>
                    onChange(updateMedia(data, medium.id, { title: event.target.value }))
                  }
                />
                <DirectorySelect
                  label="Source"
                  options={sourceOptions}
                  value={medium.citations[0]?.sourceId}
                  emptyLabel="Aucune source"
                  createLabel="Référence de la source"
                  onCreate={quickSource}
                  onChange={(id) => citeMedium(medium, id)}
                />
                <div className="gallery-actions">
                  <button
                    type="button"
                    className="btn btn-mini"
                    disabled={person.portraitMediaId === medium.id}
                    onClick={() => onChange(setPortrait(data, personId, medium.id))}
                  >
                    {person.portraitMediaId === medium.id ? 'Portrait actuel' : 'Comme portrait'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-mini"
                    onClick={() => onChange(unlinkMedia(data, medium.id, personId))}
                  >
                    Retirer
                  </button>
                  <button
                    type="button"
                    className="btn btn-mini btn-mini-danger"
                    onClick={() => remove(medium)}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
