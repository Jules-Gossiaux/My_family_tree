import { useState } from 'react';
import {
  FILIATION_TYPES,
  LINK_LABELS,
  UNION_STATUSES,
  UNION_STATUS_LABELS,
  eventLabelFor,
  personLabel,
  slotOfPartner,
  unionPartnerIds,
  type FamilyData,
  type Id,
  type LinkType,
  type NewPersonInput,
  type Person,
  type Union,
  type UnionMetaInput,
  type UnionSlot,
} from '../domain/types';
import { getPerson, relationsOf, unionsOfPerson } from '../domain/operations';
import { placeLabelOf, addPlace } from '../domain/directories';
import { eventsOfPerson } from '../domain/lifeEvents';
import { now } from '../domain/id';
import type { FiliationConflict } from '../domain/conflicts';
import { GENDER_LABELS } from '../utils/format';
import FuzzyDateField from './FuzzyDateField';
import DirectorySelect from './DirectorySelect';
import MediaGallery from './MediaGallery';
import type { AddKind } from './PersonFormDialog';

interface SidePanelProps {
  data: FamilyData;
  selectedId: Id | null;
  conflicts: FiliationConflict[];
  onUpdate: (patch: Partial<NewPersonInput>) => void;
  onAdd: (kind: AddKind) => void;
  onDelete: () => void;
  onClose: () => void;
  onResolveConflict: (childId: Id, keepUnionId: Id) => void;
  onUpdateUnion: (unionId: Id, patch: Partial<UnionMetaInput>) => void;
  onUpdateChildLink: (
    unionId: Id,
    childId: Id,
    slot: UnionSlot,
    link: LinkType,
  ) => void;
  onRemoveChildLink: (unionId: Id, childId: Id) => void;
  onRemoveUnion: (unionId: Id) => void;
  onSelectPerson: (id: Id) => void;
  onChange: (next: FamilyData) => void;
  onOpenDirectories: () => void;
  onOpenEvent: (eventId?: Id) => void;
  onDeleteEvent: (eventId: Id) => void;
}

type Tab = 'fiche' | 'facts' | 'gallery';

const ACTIONS: Array<{ kind: AddKind; label: string; symbol: string }> = [
  { kind: 'parent', label: 'Ajouter un parent', symbol: '↑' },
  { kind: 'sibling', label: 'Ajouter un frère / une sœur', symbol: '↔' },
  { kind: 'child', label: 'Ajouter un enfant', symbol: '↓' },
  { kind: 'spouse', label: 'Ajouter un conjoint', symbol: '◇' },
];

export default function SidePanel({
  data,
  selectedId,
  conflicts,
  onUpdate,
  onAdd,
  onDelete,
  onClose,
  onResolveConflict,
  onUpdateUnion,
  onUpdateChildLink,
  onRemoveChildLink,
  onRemoveUnion,
  onSelectPerson,
  onChange,
  onOpenDirectories,
  onOpenEvent,
  onDeleteEvent,
}: SidePanelProps) {
  const [tab, setTab] = useState<Tab>('fiche');
  const person = selectedId ? getPerson(data, selectedId) : undefined;
  const relations = selectedId ? relationsOf(data, selectedId) : undefined;
  const unions = selectedId ? unionsOfPerson(data, selectedId) : [];
  const events = person ? eventsOfPerson(data, person.id) : [];

  const nameOf = (id: Id | null): string => {
    if (!id) return 'Non renseigné';
    const found = getPerson(data, id);
    return found ? personLabel(found) : 'Inconnu';
  };

  const patchPerson = (patch: Partial<Person>) => {
    if (!person) return;
    onChange({
      ...data,
      persons: data.persons.map((candidate) =>
        candidate.id === person.id
          ? { ...candidate, ...patch, updatedAt: now() }
          : candidate,
      ),
    });
  };

  const createPlace = (name: string): string | undefined => {
    const next = addPlace(data, { name, kind: 'city' });
    const created = next.places.find((place) => place.name === name);
    if (created) onChange(next);
    return created?.id;
  };

  const placeOptions = data.places.map((place) => ({
    id: place.id,
    label: placeLabelOf(data, place.id),
  }));

  return (
    <aside className="side-panel">
      <div className="panel-header">
        <div>
          <span className="panel-eyebrow">
            {person ? 'Fiche personne' : 'Arbre'}
          </span>
          <h2>{person ? personLabel(person) : 'Vue d’ensemble'}</h2>
        </div>
        {person && (
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fermer la fiche"
          >
            ×
          </button>
        )}
      </div>

      {conflicts.length > 0 && (
        <div className="conflict-banner">
          <div>
            <strong>
              {conflicts.length} filiation{conflicts.length > 1 ? 's' : ''} en
              double
            </strong>
            <p>
              {nameOf(conflicts[0].childId)} est rattaché(e) à plusieurs unions
              par un lien biologique. À vous de préciser lequel est le bon.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              onResolveConflict(
                conflicts[0].childId,
                conflicts[0].entries[0].union.id,
              )
            }
          >
            Résoudre…
          </button>
        </div>
      )}

      {person && relations ? (
        <>
          <div className="panel-tabs">
            <button
              type="button"
              className={tab === 'fiche' ? 'is-active' : ''}
              onClick={() => setTab('fiche')}
            >
              Fiche
            </button>
            <button
              type="button"
              className={tab === 'facts' ? 'is-active' : ''}
              onClick={() => setTab('facts')}
            >
              Faits de vie ({events.length})
            </button>
            <button
              type="button"
              className={tab === 'gallery' ? 'is-active' : ''}
              onClick={() => setTab('gallery')}
            >
              Galerie
            </button>
          </div>

          <div className="panel-scroll">
            {tab === 'fiche' && (
              <>
                <section className="panel-section">
                  <h3>Informations</h3>
                  <div className="form-grid">
                    <label className="field">
                      <span>Prénom</span>
                      <input
                        value={person.firstName}
                        onChange={(event) =>
                          onUpdate({ firstName: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Nom</span>
                      <input
                        value={person.lastName}
                        onChange={(event) =>
                          onUpdate({ lastName: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Genre</span>
                      <select
                        value={person.gender}
                        onChange={(event) =>
                          onUpdate({
                            gender: event.target.value as NewPersonInput['gender'],
                          })
                        }
                      >
                        {(
                          Object.keys(GENDER_LABELS) as Array<
                            NewPersonInput['gender']
                          >
                        ).map((gender) => (
                          <option key={gender} value={gender}>
                            {GENDER_LABELS[gender]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <FuzzyDateField
                      label="Naissance"
                      value={person.birthDate}
                      onChange={(birthDate) => onUpdate({ birthDate })}
                    />
                    <FuzzyDateField
                      label="Décès"
                      value={person.deathDate}
                      onChange={(deathDate) => onUpdate({ deathDate })}
                    />
                    <p className="panel-note field-full">
                      Ces dates restent sur la fiche et créent aussi un fait de
                      vie par défaut, que vous pouvez enrichir dans l’onglet
                      « Faits de vie ».
                    </p>
                    <label className="field field-full">
                      <span>Notes libres</span>
                      <textarea
                        rows={3}
                        value={person.notes ?? ''}
                        placeholder="Souvenirs, précisions…"
                        onChange={(event) => onUpdate({ notes: event.target.value })}
                      />
                    </label>
                  </div>
                </section>

                <section className="panel-section">
                  <h3>Coordonnées</h3>
                  <div className="form-grid">
                    <label className="field field-full">
                      <span>Adresse</span>
                      <input
                        value={person.address ?? ''}
                        placeholder="Adresse postale"
                        onChange={(event) =>
                          onUpdate({ address: event.target.value })
                        }
                      />
                    </label>
                    <DirectorySelect
                      label="Lieu de résidence"
                      options={placeOptions}
                      value={person.addressPlaceId}
                      emptyLabel="Lieu non renseigné"
                      createLabel="Nom du nouveau lieu"
                      onCreate={createPlace}
                      onChange={(id) => patchPerson({ addressPlaceId: id })}
                    />
                    <label className="field">
                      <span>Téléphone</span>
                      <input
                        value={person.phone ?? ''}
                        placeholder="06 …"
                        onChange={(event) => onUpdate({ phone: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>E-mail</span>
                      <input
                        type="email"
                        value={person.email ?? ''}
                        placeholder="prenom@exemple.fr"
                        onChange={(event) => onUpdate({ email: event.target.value })}
                      />
                    </label>
                    {person.deathDate?.trim() ? (
                      <>
                        <label className="field field-full">
                          <span>Cimetière</span>
                          <input
                            value={person.cemetery ?? ''}
                            placeholder="Lieu de sépulture"
                            onChange={(event) =>
                              onUpdate({ cemetery: event.target.value })
                            }
                          />
                        </label>
                        <DirectorySelect
                          label="Lieu de sépulture"
                          options={placeOptions}
                          value={person.cemeteryPlaceId}
                          emptyLabel="Lieu non renseigné"
                          createLabel="Nom du nouveau lieu"
                          onCreate={createPlace}
                          onChange={(id) => patchPerson({ cemeteryPlaceId: id })}
                        />
                      </>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-mini"
                    onClick={onOpenDirectories}
                  >
                    Gérer les lieux et les sources
                  </button>
                </section>

                <section className="panel-section">
                  <h3>Ajouter un lien</h3>
                  <div className="action-list">
                    {ACTIONS.map((action) => (
                      <button
                        key={action.kind}
                        type="button"
                        className="action-button"
                        onClick={() => onAdd(action.kind)}
                      >
                        <span className="action-symbol">{action.symbol}</span>
                        <span>{action.label}</span>
                        <span className="action-plus">+</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="panel-section">
                  <h3>Unions &amp; filiations</h3>
                  {unions.length === 0 ? (
                    <p className="panel-note">
                      Aucune union pour l’instant. Ajoutez un parent, un enfant ou
                      un conjoint pour commencer.
                    </p>
                  ) : (
                    <div className="union-list">
                      {unions.map((union) => (
                        <UnionCard
                          key={union.id}
                          union={union}
                          selectedId={person.id}
                          nameOf={nameOf}
                          onUpdateUnion={onUpdateUnion}
                          onUpdateChildLink={onUpdateChildLink}
                          onRemoveChildLink={onRemoveChildLink}
                          onRemoveUnion={onRemoveUnion}
                          onSelectPerson={onSelectPerson}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section className="panel-section">
                  <h3>Dans l’arbre</h3>
                  <div className="relation-chips">
                    <span>{relations.parents.length} parent(s)</span>
                    <span>{relations.spouses.length} conjoint(s)</span>
                    <span>{relations.siblings.length} frère(s) / sœur(s)</span>
                    <span>{relations.children.length} enfant(s)</span>
                  </div>
                </section>

                <section className="panel-section panel-footer">
                  <button type="button" className="btn btn-danger" onClick={onDelete}>
                    Supprimer cette personne
                  </button>
                  <p className="panel-note">
                    La suppression retire aussi ses liens, sans supprimer les autres
                    membres de la famille.
                  </p>
                </section>
              </>
            )}

            {tab === 'facts' && (
              <>
                <section className="panel-section">
                  <div className="event-section-head">
                    <h3>Faits de vie</h3>
                    <button
                      type="button"
                      className="btn btn-mini btn-primary"
                      onClick={() => onOpenEvent()}
                    >
                      + Ajouter
                    </button>
                  </div>
                  {events.length === 0 ? (
                    <p className="panel-note">
                      Aucun fait de vie. Les dates de naissance et de décès
                      saisies dans la fiche apparaissent automatiquement ici.
                    </p>
                  ) : (
                    <div className="fact-list">
                      {events.map((event) => {
                        const linked = event.participants
                          .map((participant) => nameOf(participant.personId))
                          .join(', ');
                        return (
                          <article key={event.id} className="fact-card">
                            <header>
                              <strong>{event.title || eventLabelFor(event.type)}</strong>
                              <span>{event.date || 'Date non renseignée'}</span>
                            </header>
                            <p>{linked}</p>
                            {event.placeId && (
                              <p className="fact-place">{placeLabelOf(data, event.placeId)}</p>
                            )}
                            {event.notes && <p className="panel-note">{event.notes}</p>}
                            <div className="fact-meta">
                              <span>{event.citations.length} source(s)</span>
                              <span>{event.mediaIds.length} document(s)</span>
                            </div>
                            <div className="gallery-actions">
                              <button
                                type="button"
                                className="btn btn-mini"
                                onClick={() => onOpenEvent(event.id)}
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                className="btn btn-mini btn-mini-danger"
                                onClick={() => onDeleteEvent(event.id)}
                              >
                                Supprimer
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
                <section className="panel-section">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onOpenDirectories}
                  >
                    Lieux &amp; sources déclarés
                  </button>
                </section>
              </>
            )}

            {tab === 'gallery' && (
              <section className="panel-section">
                <MediaGallery data={data} personId={person.id} onChange={onChange} />
              </section>
            )}
          </div>
        </>
      ) : (
        <div className="panel-scroll panel-overview">
          <div className="overview-stats">
            <div>
              <strong>{data.persons.length}</strong>
              <span>personnes</span>
            </div>
            <div>
              <strong>{data.unions.length}</strong>
              <span>unions</span>
            </div>
            <div>
              <strong>{data.events.length}</strong>
              <span>faits de vie</span>
            </div>
            <div>
              <strong>{data.places.length + data.sources.length}</strong>
              <span>notices</span>
            </div>
          </div>
          <p>
            Cliquez sur une personne de l’arbre pour ouvrir sa fiche, modifier
            ses informations, préciser la nature de chaque filiation et ajouter
            un parent, un frère ou une sœur, un enfant ou un conjoint.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOpenDirectories}
          >
            Gérer les lieux et les sources
          </button>
          <h3>Légende</h3>
          <ul className="legend">
            <li>
              <span className="legend-line" /> Filiation biologique
            </li>
            <li>
              <span className="legend-line legend-adoptive" /> Lien adoptif
            </li>
            <li>
              <span className="legend-line legend-legal" /> Lien légal / non
              renseigné
            </li>
            <li>
              <span className="legend-line legend-line-accent" /> Lien vers une
              union (atténué = union ancienne)
            </li>
            <li>
              <span className="legend-diamond" /> Union ; beau-parent = aucune
              branche vers l’enfant
            </li>
          </ul>
          <h3>Principe de placement</h3>
          <p>
            Les générations occupent des couches horizontales, les unions sont
            des points d’ancrage et les fratries partagent une barre commune.
            Aucune racine ni personne centrale : la vue est la même pour tous
            les membres de la famille.
          </p>
          <p className="panel-note">
            Les données et les fichiers restent dans ce navigateur. Exportez le
            JSON pour conserver une copie complète.
          </p>
        </div>
      )}
    </aside>
  );
}

interface UnionCardProps {
  union: Union;
  selectedId: Id;
  nameOf: (id: Id | null) => string;
  onUpdateUnion: (unionId: Id, patch: Partial<UnionMetaInput>) => void;
  onUpdateChildLink: (
    unionId: Id,
    childId: Id,
    slot: UnionSlot,
    link: LinkType,
  ) => void;
  onRemoveChildLink: (unionId: Id, childId: Id) => void;
  onRemoveUnion: (unionId: Id) => void;
  onSelectPerson: (id: Id) => void;
}

function UnionCard({
  union,
  selectedId,
  nameOf,
  onUpdateUnion,
  onUpdateChildLink,
  onRemoveChildLink,
  onRemoveUnion,
  onSelectPerson,
}: UnionCardProps) {
  const partners = unionPartnerIds(union);
  const isPartner = slotOfPartner(union, selectedId) !== null;
  const others = partners.filter((id) => id !== selectedId);
  const title = isPartner
    ? others.length > 0
      ? `Union avec ${others.map((id) => nameOf(id)).join(', ')}`
      : 'Union · second parent non renseigné'
    : `Filiation · ${partners.length > 0 ? partners.map(nameOf).join(' & ') : 'parents non renseignés'}`;

  return (
    <article className="union-card">
      <header className="union-card-head">
        <strong>{title}</strong>
        <div className="union-badges">
          <span className={`union-badge${union.isCurrent ? '' : ' is-former'}`}>
            {union.isCurrent ? 'Actuelle' : 'Ancienne'}
          </span>
          <span className="union-badge">
            {UNION_STATUS_LABELS[union.status]}
          </span>
        </div>
      </header>

      <div className="union-meta">
        <label className="field">
          <span>Statut</span>
          <select
            value={union.status}
            onChange={(event) =>
              onUpdateUnion(union.id, {
                status: event.target.value as Union['status'],
              })
            }
          >
            {UNION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {UNION_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Actuelle</span>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={union.isCurrent}
              onChange={(event) =>
                onUpdateUnion(union.id, { isCurrent: event.target.checked })
              }
            />
            <span>{union.isCurrent ? 'Oui' : 'Non'}</span>
          </label>
        </label>
        <FuzzyDateField
          label="Début"
          value={union.startDate}
          onChange={(startDate) => onUpdateUnion(union.id, { startDate })}
        />
        <FuzzyDateField
          label="Fin"
          value={union.endDate}
          onChange={(endDate) => onUpdateUnion(union.id, { endDate })}
        />
      </div>

      <div className="union-children">
        <h4>Enfants rattachés ({union.children.length})</h4>
        {union.children.length === 0 && (
          <p className="panel-note">Aucun enfant rattaché à cette union.</p>
        )}
        {union.children.map((child) => (
          <div key={child.childId} className="child-link-row">
            <button
              type="button"
              className="link-person"
              onClick={() => onSelectPerson(child.childId)}
            >
              {nameOf(child.childId)}
            </button>
            <div className="link-selects">
              <label className="field">
                <span>{nameOf(union.partnerAId)} → enfant</span>
                <select
                  value={child.linkA}
                  onChange={(event) =>
                    onUpdateChildLink(
                      union.id,
                      child.childId,
                      'A',
                      event.target.value as LinkType,
                    )
                  }
                >
                  {FILIATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {LINK_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{nameOf(union.partnerBId)} → enfant</span>
                <select
                  value={child.linkB}
                  onChange={(event) =>
                    onUpdateChildLink(
                      union.id,
                      child.childId,
                      'B',
                      event.target.value as LinkType,
                    )
                  }
                >
                  {FILIATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {LINK_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="link-remove"
              title="Retirer ce lien (la personne reste dans l’arbre)"
              onClick={() => onRemoveChildLink(union.id, child.childId)}
            >
              Retirer ce lien
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="link-remove union-remove"
        onClick={() => onRemoveUnion(union.id)}
      >
        Supprimer cette union
      </button>
    </article>
  );
}
