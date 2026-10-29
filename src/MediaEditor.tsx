import { useEffect, useState } from 'react';
import { api } from './api';
import type { Media, MediaKind } from '../shared/types';

interface Props {
  media: Media;
  onSaved: () => void;
}

const KINDS: { value: MediaKind; label: string }[] = [
  { value: 'photo', label: 'Photo' },
  { value: 'document', label: 'Document' },
];

/**
 * Ce que l'image dit d'elle-même : une légende, une date telle qu'on la lit dessus, un type d'acte.
 * La date se corrige en texte libre parce qu'un acte scanné porte souvent « le 3 juin 1870 » ou
 * simplement « 1870 » — et qu'une date incertaine saisie comme une date certaine serait un mensonge.
 */
export default function MediaEditor({ media, onSaved }: Props) {
  const [caption, setCaption] = useState(media.caption ?? '');
  const [dateText, setDateText] = useState(media.date?.text ?? '');
  const [documentType, setDocumentType] = useState(media.documentType ?? '');
  const [kind, setKind] = useState<MediaKind>(media.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCaption(media.caption ?? '');
    setDateText(media.date?.text ?? '');
    setDocumentType(media.documentType ?? '');
    setKind(media.kind);
    setError(null);
  }, [media]);

  const dirty =
    caption !== (media.caption ?? '') ||
    dateText !== (media.date?.text ?? '') ||
    documentType !== (media.documentType ?? '') ||
    kind !== media.kind;

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await api.patchMedia(media.id, {
        caption: caption.trim() || null,
        dateText: dateText.trim() || null,
        documentType: kind === 'document' ? documentType.trim() || null : null,
        kind,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La correction n’a pas été enregistrée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="media-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="field">
        <span>Légende</span>
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="Qui est dessus, où, pourquoi"
        />
      </label>
      <label className="field">
        <span>Date lue sur le fichier</span>
        <input
          value={dateText}
          onChange={(event) => setDateText(event.target.value)}
          placeholder="1911, 3 juin 1870, vers 1900…"
        />
      </label>
      {kind === 'document' && (
        <label className="field">
          <span>Type d’acte</span>
          <input
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
            placeholder="naissance, mariage, décès, lettre…"
          />
        </label>
      )}
      <div className="media-edit-foot">
        <div className="segmented">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={kind === option.value ? 'on' : ''}
              onClick={() => setKind(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="submit" className="primary" disabled={!dirty || busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
      {error && <p className="dialog-error">{error}</p>}
    </form>
  );
}
