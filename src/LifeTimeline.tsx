import { useEffect, useState } from 'react';
import { api } from './api';
import { formatDate } from './dates';
import type { EventInput, EventRow } from '../shared/types';

/** Les mêmes types que le serveur connaît : la valeur s'écrit sans accent, le libellé en français. */
const TYPES: { value: string; label: string }[] = [
  { value: 'naissance', label: 'Naissance' },
  { value: 'bapteme', label: 'Baptême' },
  { value: 'deces', label: 'Décès' },
  { value: 'inhumation', label: 'Inhumation' },
  { value: 'profession', label: 'Profession' },
  { value: 'residence', label: 'Résidence' },
  { value: 'autre', label: 'Autre' },
];

const CONFIDENCES: { value: string; label: string }[] = [
  { value: 'certain', label: 'certain' },
  { value: 'probable', label: 'probable' },
  { value: 'douteux', label: 'douteux' },
];

interface Draft {
  type: string;
  dateText: string;
  description: string;
  confidence: string;
}

function draftOf(event: EventRow | null): Draft {
  return {
    type: event?.type ?? 'autre',
    dateText: event?.date?.text ?? '',
    description: event?.description ?? '',
    confidence: event?.confidence ?? 'probable',
  };
}

function toInput(draft: Draft): EventInput {
  return {
    type: draft.type,
    dateText: draft.dateText.trim() || null,
    description: draft.description.trim() || null,
    confidence: draft.confidence,
  };
}

function EventForm({
  draft,
  busy,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (next: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <form
      className="life-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="life-form-top">
        <label className="field">
          <span>Fait</span>
          <select
            value={draft.type}
            onChange={(event) => onChange({ ...draft, type: event.target.value })}
            disabled={busy}
          >
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input
            value={draft.dateText}
            onChange={(event) => onChange({ ...draft, dateText: event.target.value })}
            placeholder="1912, 3 juin 1870, vers 1900…"
            disabled={busy}
          />
        </label>
      </div>
      <label className="field">
        <span>Ce qui s'est passé</span>
        <input
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          placeholder="modiste, rue de Lille, émigré en 1913…"
          disabled={busy}
        />
      </label>
      <div className="life-form-foot">
        <div className="segmented">
          {CONFIDENCES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={draft.confidence === option.value ? 'on' : ''}
              onClick={() => onChange({ ...draft, confidence: option.value })}
              disabled={busy}
              title="Un acte prouvé, une présomption, ou ce qu'un neveu raconte"
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
      <p className="settings-note">
        Une date que l'ordinateur ne sait pas lire reste écrite telle quelle : aucune année n'est
        inventée.
      </p>
    </form>
  );
}

interface Props {
  personId: string;
  events: EventRow[];
  /** Un fait écrit ou effacé : la fiche et l'arbre repartent de la même ligne. */
  onChanged: () => void;
}

/**
 * La vie d'une personne dans l'ordre où elle s'est déroulée. La date de naissance et le décès sont
 * ici, pas ailleurs : la saisie rapide du dossier « Modifier » écrit la même ligne, sinon un fait
 * aurait deux dates selon l'endroit où on l'a tapé.
 */
export default function LifeTimeline({ personId, events, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Changer de fiche ferme l'éditeur : un brouillon tapé pour Bernard n'a rien à faire sur la vie
  // de celui qui s'ouvre ensuite.
  useEffect(() => {
    setAdding(false);
    setEditingId(null);
    setConfirmId(null);
    setError(null);
  }, [personId]);

  const openNew = () => {
    setEditingId(null);
    setConfirmId(null);
    setDraft(draftOf(null));
    setError(null);
    setAdding(true);
  };

  const openEdit = (event: EventRow) => {
    setAdding(false);
    setDraft(draftOf(event));
    setError(null);
    setEditingId(event.id);
  };

  const close = () => {
    setAdding(false);
    setEditingId(null);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) await api.updateEvent(editingId, toInput(draft));
      else await api.createEvent({ personId, ...toInput(draft) });
      close();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le fait n’a pas été enregistré.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (event: EventRow) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteEvent(event.id);
      setConfirmId(null);
      if (editingId === event.id) close();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le fait n’a pas été supprimé.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="life">
      {events.length === 0 && !adding && (
        <p className="hint">
          Rien de daté ici pour l'instant. Un fait se saisit en français libre : « vers 1912 », « avant
          mars 1870 », « on ne sait pas ».
        </p>
      )}

      {events.length > 0 && (
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id} className={`life-row${editingId === event.id ? ' is-editing' : ''}`}>
              <span className="life-dot" />
              {editingId === event.id ? (
                <EventForm
                  draft={draft}
                  busy={busy}
                  onChange={setDraft}
                  onSubmit={() => void submit()}
                  onCancel={close}
                  submitLabel="Enregistrer"
                />
              ) : (
                <>
                  <div className="life-line">
                    <span className="life-label">{event.label}</span>
                    <span className="life-date">{formatDate(event.date) || 'date inconnue'}</span>
                    {event.place && <span className="life-place">{event.place}</span>}
                  </div>
                  {event.description && <p className="life-desc">{event.description}</p>}
                  <p className="life-meta">
                    <span className={`life-conf is-${event.confidence}`}>{event.confidence}</span>
                    {event.source && (
                      <span className="life-source" title={event.sourceKind ?? undefined}>
                        {event.source}
                      </span>
                    )}
                    {event.mediaCount > 0 && (
                      <span className="life-media">
                        {event.mediaCount} fichier{event.mediaCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </p>
                  <div className="life-actions">
                    {confirmId === event.id ? (
                      <>
                        <span className="life-ask">Supprimer ce fait ?</span>
                        <button
                          type="button"
                          className="danger-solid"
                          onClick={() => void remove(event)}
                          disabled={busy}
                        >
                          Supprimer
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setConfirmId(null)}
                          disabled={busy}
                        >
                          Garder
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="ghost" onClick={() => openEdit(event)}>
                          Modifier
                        </button>
                        <button
                          type="button"
                          className="link danger"
                          onClick={() => setConfirmId(event.id)}
                          disabled={busy}
                        >
                          Retirer ce fait
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {adding && (
        <EventForm
          draft={draft}
          busy={busy}
          onChange={setDraft}
          onSubmit={() => void submit()}
          onCancel={close}
          submitLabel="Ajouter"
        />
      )}

      {!adding && (
        <div className="actions">
          <button type="button" className="ghost" onClick={openNew}>
            + Un fait de plus
          </button>
        </div>
      )}
      {error && <p className="dialog-error">{error}</p>}
    </div>
  );
}
