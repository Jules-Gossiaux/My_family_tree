import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { formatDate, fullName, initials, lifeSpan } from './dates';
import type { Person, PersonDetail, RelationInput } from '../shared/types';

interface Props {
  personId: string | null;
  refreshKey: number;
  onSelect: (personId: string) => void;
  onAdd: (relation: RelationInput, anchorName: string) => void;
  onEdit: (person: PersonDetail) => void;
  onClose: () => void;
  onSetRoot: (personId: string) => void;
}

function RelationRow({ person, onSelect }: { person: Person; onSelect: (id: string) => void }) {
  return (
    <button type="button" className="rel-row" onClick={() => onSelect(person.id)}>
      <span className="rel-avatar">{initials(person)}</span>
      <span className="rel-main">
        <span className="rel-name">{fullName(person)}</span>
        <span className="rel-dates">{lifeSpan(person)}</span>
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      {children}
    </section>
  );
}

export default function PersonSheet({
  personId,
  refreshKey,
  onSelect,
  onAdd,
  onEdit,
  onClose,
  onSetRoot,
}: Props) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!personId) {
      setPerson(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .person(personId)
      .then((data) => {
        if (!cancelled) setPerson(data);
      })
      .catch(() => {
        if (!cancelled) setPerson(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personId, refreshKey]);

  if (!personId) {
    return (
      <aside className="sheet sheet-empty">
        <p className="hint">
          Cliquez sur une personne dans l'arbre pour ouvrir son dossier de vie.
        </p>
      </aside>
    );
  }

  if (!person || loading) {
    return <aside className="sheet" />;
  }

  const name = fullName(person);
  const span = lifeSpan(person);
  const birth = formatDate(person.birth);
  const death = formatDate(person.death);

  return (
    <aside className="sheet">
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>

      <header className="sheet-header">
        <div className="avatar">{initials(person)}</div>
        <div className="sheet-id">
          <h2 className="sheet-name">{name}</h2>
          {person.birthName && <p className="sheet-nick">née {person.birthName}</p>}
          {person.nicknames.length > 0 && (
            <p className="sheet-nick">« {person.nicknames.join(' », « ')} »</p>
          )}
          <p className="sheet-dates">
            {span || 'dates inconnues'}
            {!person.living && <span className="tag-dead">décédé</span>}
          </p>
        </div>
      </header>

      <div className="actions">
        <button type="button" onClick={() => onAdd({ type: 'child', ofPersonId: person.id }, name)}>
          + Enfant
        </button>
        <button
          type="button"
          onClick={() => onAdd({ type: 'partner', ofPersonId: person.id }, name)}
        >
          + Conjoint
        </button>
        <button type="button" onClick={() => onAdd({ type: 'parent', ofPersonId: person.id }, name)}>
          + Parent
        </button>
        <button type="button" className="ghost" onClick={() => onEdit(person)}>
          Modifier
        </button>
      </div>

      <Section title="Vie">
        <dl className="facts">
          <div>
            <dt>Naissance</dt>
            <dd>{birth || '—'}</dd>
          </div>
          <div>
            <dt>Décès</dt>
            <dd>{death || '—'}</dd>
          </div>
        </dl>
      </Section>

      {person.parents.length > 0 && (
        <Section title={person.parents.length > 1 ? 'Parents' : 'Parent'}>
          {person.parents.map((p) => (
            <RelationRow key={p.id} person={p} onSelect={onSelect} />
          ))}
        </Section>
      )}

      {person.partners.length > 0 && (
        <Section title={person.partners.length > 1 ? 'Unions' : 'Union'}>
          {person.partners.map((p) => (
            <RelationRow key={p.id} person={p} onSelect={onSelect} />
          ))}
        </Section>
      )}

      {person.siblings.length > 0 && (
        <Section title="Fratrie">
          {person.siblings.map((p) => (
            <RelationRow key={p.id} person={p} onSelect={onSelect} />
          ))}
        </Section>
      )}

      {person.children.length > 0 && (
        <Section title={person.children.length > 1 ? 'Enfants' : 'Enfant'}>
          {person.children.map((p) => (
            <RelationRow key={p.id} person={p} onSelect={onSelect} />
          ))}
        </Section>
      )}

      <footer className="sheet-footer">
        <button type="button" className="link" onClick={() => onSetRoot(person.id)}>
          Faire de cette personne la souche de l'arbre
        </button>
      </footer>
    </aside>
  );
}
