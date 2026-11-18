import { useState } from 'react';
import DirectorySelect from './DirectorySelect';
import FuzzyDateField from './FuzzyDateField';
import {
  addSource,
  addPlace,
  duplicateSource,
} from '../domain/directories';
import { addEvent, updateEvent } from '../domain/lifeEvents';
import {
  EVENT_LABELS,
  EVENT_TYPES,
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  personLabel,
  unionPartnerIds,
  type EventType,
  type FamilyData,
  type Id,
  type LifeEventInput,
  type SourceCitation,
} from '../domain/types';

interface EventDialogProps {
  data: FamilyData;
  eventId?: Id;
  onChange: (next: FamilyData) => void;
  onDelete?: (eventId: Id) => void;
  onClose: () => void;
}

function labelOfUnion(data: FamilyData, unionId: Id): string {
  const union = data.unions.find((candidate) => candidate.id === unionId);
  if (!union) return 'Union inconnue';
  const names = unionPartnerIds(union).map((id) => {
    const person = data.persons.find((candidate) => candidate.id === id);
    return person ? personLabel(person) : '?';
  });
  return names.length > 0 ? names.join(' & ') : 'Parents non renseignés';
}

/** Éditeur d'un fait de vie partagé entre une ou plusieurs personnes. */
export default function EventDialog({
  data,
  eventId,
  onChange,
  onDelete,
  onClose,
}: EventDialogProps) {
  const existing = eventId ? data.events.find((event) => event.id === eventId) : undefined;
  const [type, setType] = useState<EventType>(existing?.type ?? 'other');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing?.date);
  const [placeId, setPlaceId] = useState(existing?.placeId);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [participants, setParticipants] = useState(
    existing?.participants ?? [],
  );
  const [citations, setCitations] = useState<SourceCitation[]>(
    existing?.citations ?? [],
  );
  const [mediaIds, setMediaIds] = useState<Id[]>(existing?.mediaIds ?? []);
  const [unionId, setUnionId] = useState(existing?.unionId ?? '');
  const [error, setError] = useState<string | null>(null);

  const placeOptions = data.places.map((place) => ({ id: place.id, label: place.name }));
  const sourceOptions = data.sources.map((source) => ({
    id: source.id,
    label: `${source.reference} — ${source.title}`,
  }));

  const createPlace = (name: string): string | undefined => {
    const next = addPlace(data, { name, kind: 'city' });
    const created = next.places.find((place) => place.name === name);
    if (created) onChange(next);
    return created?.id;
  };

  const createSource = (name: string): string | undefined => {
    if (duplicateSource(data, name)) {
      setError('Cette référence de source existe déjà.');
      return undefined;
    }
    const next = addSource(data, { reference: name, title: name, kind: 'other' });
    const created = next.sources.find((source) => source.reference === name);
    if (created) onChange(next);
    return created?.id;
  };

  const save = () => {
    if (participants.length === 0 || participants.some((p) => !p.personId)) {
      setError('Un fait de vie doit être rattaché à au moins une personne.');
      return;
    }
    const input: LifeEventInput = {
      type,
      title,
      date,
      placeId,
      notes,
      participants,
      citations,
      mediaIds,
      unionId: unionId || undefined,
    };
    onChange(existing ? updateEvent(data, existing.id, input) : addEvent(data, input));
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal event-modal"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Modifier un fait de vie' : 'Ajouter un fait de vie'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2>{existing ? 'Modifier le fait de vie' : 'Nouveau fait de vie'}</h2>
            <p>Un même fait peut concerner plusieurs personnes, un lieu et plusieurs sources.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className="modal-body">
          {error && <div className="dialog-notice is-error">{error}</div>}

          <div className="form-grid">
            <label className="field">
              <span>Type de fait</span>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as EventType)}
              >
                {EVENT_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {EVENT_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Titre (facultatif)</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={EVENT_LABELS[type]}
              />
            </label>
            <FuzzyDateField label="Date du fait" value={date} onChange={setDate} />
            <DirectorySelect
              label="Lieu"
              options={placeOptions}
              value={placeId}
              emptyLabel="Lieu non renseigné"
              createLabel="Nom du nouveau lieu"
              onCreate={createPlace}
              onChange={setPlaceId}
            />
            <label className="field field-full">
              <span>Notes</span>
              <textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Circonstances, mentions du registre…"
              />
            </label>
          </div>

          <section className="event-section">
            <div className="event-section-head">
              <h3>Personnes concernées</h3>
              <button
                type="button"
                className="btn btn-mini"
                onClick={() =>
                  setParticipants([...participants, { personId: '', role: 'témoin' }])
                }
              >
                + Ajouter
              </button>
            </div>
            {participants.map((participant, index) => (
              <div key={index} className="event-participant">
                <label className="field">
                  <span>Personne</span>
                  <select
                    value={participant.personId}
                    onChange={(event) =>
                      setParticipants(
                        participants.map((item, i) =>
                          i === index ? { ...item, personId: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    <option value="">Choisir…</option>
                    {data.persons.map((person) => (
                      <option key={person.id} value={person.id}>
                        {personLabel(person)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Rôle</span>
                  <select
                    value={participant.role}
                    onChange={(event) =>
                      setParticipants(
                        participants.map((item, i) =>
                          i === index ? { ...item, role: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    {PARTICIPANT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {PARTICIPANT_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-mini btn-mini-danger"
                  onClick={() =>
                    setParticipants(participants.filter((_, i) => i !== index))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </section>

          <section className="event-section">
            <div className="event-section-head">
              <h3>Sources</h3>
              <button
                type="button"
                className="btn btn-mini"
                onClick={() => setCitations([...citations, { sourceId: '' }])}
              >
                + Citer
              </button>
            </div>
            {citations.map((citation, index) => (
              <div key={index} className="event-citation">
                <DirectorySelect
                  label="Notice"
                  options={sourceOptions}
                  value={citation.sourceId}
                  emptyLabel="Choisir une source…"
                  createLabel="Référence de la source"
                  onCreate={createSource}
                  onChange={(id) =>
                    setCitations(
                      citations.map((item, i) =>
                        i === index ? { ...item, sourceId: id ?? '' } : item,
                      ),
                    )
                  }
                />
                <label className="field">
                  <span>Page / vue / folio</span>
                  <input
                    value={citation.detail ?? ''}
                    onChange={(event) =>
                      setCitations(
                        citations.map((item, i) =>
                          i === index ? { ...item, detail: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="vue 12, fol. 34r"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-mini btn-mini-danger"
                  onClick={() => setCitations(citations.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </div>
            ))}
          </section>

          <section className="event-section">
            <h3>Documents rattachés</h3>
            <div className="media-check-list">
              {data.media.length === 0 ? (
                <p className="panel-note">Aucun média dans la famille pour l’instant.</p>
              ) : (
                data.media.map((medium) => (
                  <label key={medium.id} className="media-check">
                    <input
                      type="checkbox"
                      checked={mediaIds.includes(medium.id)}
                      onChange={(event) =>
                        setMediaIds(
                          event.target.checked
                            ? [...mediaIds, medium.id]
                            : mediaIds.filter((id) => id !== medium.id),
                        )
                      }
                    />
                    <span>{medium.title || medium.fileName}</span>
                  </label>
                ))
              )}
            </div>
            <label className="field">
              <span>Union liée (facultatif)</span>
              <select value={unionId} onChange={(event) => setUnionId(event.target.value)}>
                <option value="">Aucune</option>
                {data.unions.map((union) => (
                  <option key={union.id} value={union.id}>
                    {labelOfUnion(data, union.id)}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </div>

        <footer className="modal-footer">
          {existing && onDelete && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                onDelete(existing.id);
                onClose();
              }}
            >
              Supprimer ce fait
            </button>
          )}
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Enregistrer
          </button>
        </footer>
      </div>
    </div>
  );
}
