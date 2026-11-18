import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import { fullName, lifeSpan } from './dates';
import type { Person, RelationType } from '../shared/types';

interface Props {
  person: Person;
  candidates: Person[];
  onClose: () => void;
  onAttached: (personId: string) => void;
}

const ROLE: Record<RelationType, string> = {
  child: 'Enfant de',
  parent: 'Parent de',
  partner: 'Conjoint de',
};

const ROLES: RelationType[] = ['child', 'parent', 'partner'];

/**
 * Rattache deux personnes que la base connaît déjà.
 *
 * Pas de création, pas d'union implicite : on nomme la personne et le lien, rien de plus.
 */
export default function AttachDialog({ person, candidates, onClose, onAttached }: Props) {
  const [type, setType] = useState<RelationType>('child');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => search.current?.focus(), 30);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates.slice(0, 8);
    return candidates
      .filter((other) =>
        `${other.givenNames} ${other.familyName} ${other.birthName ?? ''}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 8);
  }, [candidates, query]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.attachRelation(person.id, { type, ofPersonId: target.id });
      onAttached(person.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rattachement impossible');
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="dialog dialog-small" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="dialog-title">Rattacher {fullName(person)}</h2>
        <p className="dialog-text">
          Choisissez qui {fullName(person)} devient dans l’arbre. Aucune union n’est créée au
          passage : si les deux parents doivent être reliés, déclarez-les séparément.
        </p>

        <div className="field">
          <span>Ce que {fullName(person)} devient</span>
          <div className="segmented">
            {ROLES.map((role) => (
              <button
                key={role}
                type="button"
                className={type === role ? 'on' : ''}
                onClick={() => setType(role)}
              >
                {ROLE[role]}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>La personne concernée</span>
          <input
            ref={search}
            value={target ? fullName(target) : query}
            onChange={(e) => {
              setTarget(null);
              setQuery(e.target.value);
            }}
            placeholder="Rechercher un nom"
            autoComplete="off"
          />
        </label>

        {!target && results.length > 0 && (
          <div className="pick-list">
            {results.map((other) => (
              <button key={other.id} type="button" className="pick-row" onClick={() => setTarget(other)}>
                <span className="pick-name">{fullName(other)}</span>
                <span className="pick-dates">{lifeSpan(other)}</span>
              </button>
            ))}
          </div>
        )}

        {target && (
          <p className="pick-summary">
            <strong>{fullName(person)}</strong> devient {ROLE[type].toLowerCase()}{' '}
            <strong>{fullName(target)}</strong>
          </p>
        )}

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="primary" disabled={busy || !target}>
            {busy ? 'Rattachement…' : 'Rattacher'}
          </button>
        </div>
      </form>
    </div>
  );
}
