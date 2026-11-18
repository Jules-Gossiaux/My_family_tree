import { useState } from 'react';
import {
  addPlace,
  addSource,
  deletePlace,
  deleteSource,
  duplicateSource,
  placeUsage,
  renamePlace,
  renameSource,
  sourceUsage,
} from '../domain/directories';
import {
  PLACE_KINDS,
  PLACE_KIND_LABELS,
  SOURCE_KINDS,
  SOURCE_KIND_LABELS,
  type FamilyData,
  type Id,
  type PlaceKind,
  type SourceKind,
} from '../domain/types';

interface DirectoryDialogProps {
  data: FamilyData;
  onChange: (next: FamilyData) => void;
  onClose: () => void;
}

type Tab = 'places' | 'sources';

interface Notice {
  kind: 'error' | 'info';
  text: string;
}

/** Gestionnaire des lieux et sources déclarés : renommer propage, supprimer vérifie. */
export default function DirectoryDialog({
  data,
  onChange,
  onClose,
}: DirectoryDialogProps) {
  const [tab, setTab] = useState<Tab>('places');
  const [editing, setEditing] = useState<Id | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [placeDraft, setPlaceDraft] = useState({
    name: '',
    kind: 'city' as PlaceKind,
    parentId: '',
    notes: '',
  });
  const [sourceDraft, setSourceDraft] = useState({
    reference: '',
    title: '',
    kind: 'civil' as SourceKind,
    url: '',
    notes: '',
  });
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});

  const createPlaceNow = () => {
    if (!placeDraft.name.trim()) {
      setNotice({ kind: 'error', text: 'Donnez un nom au lieu.' });
      return;
    }
    onChange(
      addPlace(data, {
        name: placeDraft.name,
        kind: placeDraft.kind,
        parentId: placeDraft.parentId || undefined,
        notes: placeDraft.notes,
      }),
    );
    setPlaceDraft({ name: '', kind: 'city', parentId: '', notes: '' });
    setNotice(null);
  };

  const createSourceNow = () => {
    if (!sourceDraft.reference.trim()) {
      setNotice({ kind: 'error', text: 'La référence de la source est obligatoire.' });
      return;
    }
    if (duplicateSource(data, sourceDraft.reference)) {
      setNotice({ kind: 'error', text: 'Cette référence existe déjà. Renommez l’autre notice d’abord.' });
      return;
    }
    onChange(
      addSource(data, {
        reference: sourceDraft.reference,
        title: sourceDraft.title || sourceDraft.reference,
        kind: sourceDraft.kind,
        url: sourceDraft.url,
        notes: sourceDraft.notes,
      }),
    );
    setSourceDraft({ reference: '', title: '', kind: 'civil', url: '', notes: '' });
    setNotice(null);
  };

  const beginEdit = (id: Id, values: Record<string, string>) => {
    setEditing(id);
    setEditDraft(values);
    setNotice(null);
  };

  const saveEdit = () => {
    if (!editing) return;
    if (tab === 'places') {
      const place = data.places.find((item) => item.id === editing);
      if (!place) return;
      if (editDraft.parentId === editing) {
        setNotice({ kind: 'error', text: 'Un lieu ne peut pas être son propre parent.' });
        return;
      }
      onChange(
        renamePlace(data, editing, {
          name: editDraft.name ?? place.name,
          kind: (editDraft.kind ?? place.kind) as PlaceKind,
          parentId: editDraft.parentId || undefined,
          notes: editDraft.notes ?? place.notes,
        }),
      );
    } else {
      const source = data.sources.find((item) => item.id === editing);
      if (!source) return;
      if (duplicateSource(data, editDraft.reference ?? source.reference, editing)) {
        setNotice({ kind: 'error', text: 'Cette référence est déjà utilisée par une autre source.' });
        return;
      }
      onChange(
        renameSource(data, editing, {
          reference: editDraft.reference ?? source.reference,
          title: editDraft.title ?? source.title,
          kind: (editDraft.kind ?? source.kind) as SourceKind,
          url: editDraft.url ?? source.url,
          notes: editDraft.notes ?? source.notes,
        }),
      );
    }
    setEditing(null);
    setNotice({ kind: 'info', text: 'Notice mise à jour : toutes les citations suivent.' });
  };

  const remove = (id: Id) => {
    const usage =
      tab === 'places' ? placeUsage(data, id) : sourceUsage(data, id);
    if (usage.length > 0) {
      setNotice({
        kind: 'error',
        text: `Suppression refusée : encore cité ${usage.length} fois (${usage
          .slice(0, 3)
          .map((item) => `${item.kind} · ${item.label}`)
          .join(' ; ')}${usage.length > 3 ? '…' : ''}).`,
      });
      return;
    }
    const label =
      tab === 'places'
        ? data.places.find((item) => item.id === id)?.name
        : data.sources.find((item) => item.id === id)?.reference;
    if (!window.confirm(`Supprimer définitivement « ${label} » ?`)) return;
    onChange(tab === 'places' ? deletePlace(data, id) : deleteSource(data, id));
    setEditing(null);
    setNotice(null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal directory-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Lieux et sources"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2>Lieux &amp; sources</h2>
            <p>Les notices sont partagées : renommer propage, supprimer vérifie les citations.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className="modal-tabs">
          <button
            type="button"
            className={tab === 'places' ? 'is-active' : ''}
            onClick={() => {
              setTab('places');
              setEditing(null);
              setNotice(null);
            }}
          >
            Lieux ({data.places.length})
          </button>
          <button
            type="button"
            className={tab === 'sources' ? 'is-active' : ''}
            onClick={() => {
              setTab('sources');
              setEditing(null);
              setNotice(null);
            }}
          >
            Sources ({data.sources.length})
          </button>
        </div>

        {notice && <div className={`dialog-notice is-${notice.kind}`}>{notice.text}</div>}

        <div className="directory-list">
          {tab === 'places' ? (
            data.places.length === 0 ? (
              <p className="panel-note">Aucun lieu déclaré.</p>
            ) : (
              data.places.map((place) => {
                const usage = placeUsage(data, place.id);
                const isEditing = editing === place.id;
                return (
                  <article key={place.id} className="directory-row">
                    {isEditing ? (
                      <div className="directory-edit">
                        <label className="field">
                          <span>Nom</span>
                          <input
                            value={editDraft.name ?? place.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>Type</span>
                          <select
                            value={editDraft.kind ?? place.kind}
                            onChange={(e) => setEditDraft({ ...editDraft, kind: e.target.value })}
                          >
                            {PLACE_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {PLACE_KIND_LABELS[kind]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Lieu parent</span>
                          <select
                            value={editDraft.parentId ?? place.parentId ?? ''}
                            onChange={(e) => setEditDraft({ ...editDraft, parentId: e.target.value })}
                          >
                            <option value="">Aucun</option>
                            {data.places
                              .filter((item) => item.id !== place.id)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button type="button" className="btn btn-primary" onClick={saveEdit}>
                          Enregistrer
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="directory-row-main">
                          <strong>{place.name}</strong>
                          <span className="directory-tag">{PLACE_KIND_LABELS[place.kind]}</span>
                          {place.parentId && (
                            <span className="directory-tag">
                              dans {data.places.find((p) => p.id === place.parentId)?.name ?? '…'}
                            </span>
                          )}
                        </div>
                        <div className="directory-row-actions">
                          <span className="directory-usage">{usage.length} citation(s)</span>
                          <button
                            type="button"
                            className="btn btn-mini"
                            onClick={() =>
                              beginEdit(place.id, {
                                name: place.name,
                                kind: place.kind,
                                parentId: place.parentId ?? '',
                                notes: place.notes ?? '',
                              })
                            }
                          >
                            Renommer
                          </button>
                          <button type="button" className="btn btn-mini btn-mini-danger" onClick={() => remove(place.id)}>
                            Supprimer
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })
            )
          ) : data.sources.length === 0 ? (
            <p className="panel-note">Aucune source déclarée.</p>
          ) : (
            data.sources.map((source) => {
              const usage = sourceUsage(data, source.id);
              const isEditing = editing === source.id;
              return (
                <article key={source.id} className="directory-row">
                  {isEditing ? (
                    <div className="directory-edit">
                      <label className="field">
                        <span>Référence</span>
                        <input
                          value={editDraft.reference ?? source.reference}
                          onChange={(e) => setEditDraft({ ...editDraft, reference: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Titre</span>
                        <input
                          value={editDraft.title ?? source.title}
                          onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Type</span>
                        <select
                          value={editDraft.kind ?? source.kind}
                          onChange={(e) => setEditDraft({ ...editDraft, kind: e.target.value })}
                        >
                          {SOURCE_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {SOURCE_KIND_LABELS[kind]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="button" className="btn btn-primary" onClick={saveEdit}>
                        Enregistrer
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="directory-row-main">
                        <strong>{source.reference}</strong>
                        <span>{source.title}</span>
                        <span className="directory-tag">{SOURCE_KIND_LABELS[source.kind]}</span>
                      </div>
                      <div className="directory-row-actions">
                        <span className="directory-usage">{usage.length} citation(s)</span>
                        <button
                          type="button"
                          className="btn btn-mini"
                          onClick={() =>
                            beginEdit(source.id, {
                              reference: source.reference,
                              title: source.title,
                              kind: source.kind,
                              url: source.url ?? '',
                              notes: source.notes ?? '',
                            })
                          }
                        >
                          Renommer
                        </button>
                        <button type="button" className="btn btn-mini btn-mini-danger" onClick={() => remove(source.id)}>
                          Supprimer
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })
          )}
        </div>

        <section className="directory-create">
          <h3>{tab === 'places' ? 'Déclarer un lieu' : 'Déclarer une source'}</h3>
          {tab === 'places' ? (
            <div className="form-grid">
              <label className="field field-full">
                <span>Nom du lieu</span>
                <input
                  value={placeDraft.name}
                  onChange={(e) => setPlaceDraft({ ...placeDraft, name: e.target.value })}
                  placeholder="Saint-Malo, Brest, hôpital…"
                />
              </label>
              <label className="field">
                <span>Type</span>
                <select
                  value={placeDraft.kind}
                  onChange={(e) => setPlaceDraft({ ...placeDraft, kind: e.target.value as PlaceKind })}
                >
                  {PLACE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {PLACE_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Dans</span>
                <select
                  value={placeDraft.parentId}
                  onChange={(e) => setPlaceDraft({ ...placeDraft, parentId: e.target.value })}
                >
                  <option value="">Aucun lieu parent</option>
                  {data.places.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-primary" onClick={createPlaceNow}>
                Ajouter le lieu
              </button>
            </div>
          ) : (
            <div className="form-grid">
              <label className="field">
                <span>Référence / cote</span>
                <input
                  value={sourceDraft.reference}
                  onChange={(e) => setSourceDraft({ ...sourceDraft, reference: e.target.value })}
                  placeholder="AD 22, 3E 123, vue 12"
                />
              </label>
              <label className="field">
                <span>Titre</span>
                <input
                  value={sourceDraft.title}
                  onChange={(e) => setSourceDraft({ ...sourceDraft, title: e.target.value })}
                  placeholder="Acte de naissance"
                />
              </label>
              <label className="field">
                <span>Type</span>
                <select
                  value={sourceDraft.kind}
                  onChange={(e) => setSourceDraft({ ...sourceDraft, kind: e.target.value as SourceKind })}
                >
                  {SOURCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {SOURCE_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field-full">
                <span>URL</span>
                <input
                  value={sourceDraft.url}
                  onChange={(e) => setSourceDraft({ ...sourceDraft, url: e.target.value })}
                  placeholder="https://…"
                />
              </label>
              <button type="button" className="btn btn-primary" onClick={createSourceNow}>
                Ajouter la source
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
