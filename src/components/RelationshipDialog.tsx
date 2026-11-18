import { useMemo, useState } from 'react';
import { personLabel, type FamilyData, type Id } from '../domain/types';
import { relationshipBetween } from '../domain/relationship';

interface RelationshipDialogProps {
  data: FamilyData;
  initialId?: Id | null;
  onClose: () => void;
}

export default function RelationshipDialog({
  data,
  initialId,
  onClose,
}: RelationshipDialogProps) {
  const [from, setFrom] = useState<Id | null>(initialId ?? null);
  const [to, setTo] = useState<Id | null>(null);

  const options = useMemo(
    () =>
      [...data.persons].sort((a, b) =>
        personLabel(a).localeCompare(personLabel(b), 'fr'),
      ),
    [data.persons],
  );

  const result = useMemo(
    () => (from && to ? relationshipBetween(data, from, to) : null),
    [data, from, to],
  );

  const name = (id: Id) => {
    const person = data.persons.find((candidate) => candidate.id === id);
    return person ? personLabel(person) : 'Inconnu';
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Calculer un lien de parenté"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Quel est le lien ?</h2>
          <p className="modal-subtitle">
            Choisissez deux personnes : le chemin le plus court est calculé dans
            l’arbre, filiations et alliances comprises.
          </p>
        </div>
        <div className="modal-body relationship-form">
          <label className="field">
            <span>De</span>
            <select value={from ?? ''} onChange={(event) => setFrom(event.target.value || null)}>
              <option value="">— Choisir —</option>
              {options.map((person) => (
                <option key={person.id} value={person.id}>
                  {personLabel(person)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>À</span>
            <select value={to ?? ''} onChange={(event) => setTo(event.target.value || null)}>
              <option value="">— Choisir —</option>
              {options.map((person) => (
                <option key={person.id} value={person.id}>
                  {personLabel(person)}
                </option>
              ))}
            </select>
          </label>

          {from && to && (
            <div className="relationship-result">
              {result ? (
                <>
                  <strong>{result.label}</strong>
                  <p className="panel-note">
                    {name(from)} → {result.steps.join(' → ')} → {name(to)}
                  </p>
                </>
              ) : (
                <p className="panel-note">
                  Aucun lien trouvé entre ces deux personnes dans l’arbre actuel.
                </p>
              )}
            </div>
          )}
        </div>
        <footer className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fermer
          </button>
        </footer>
      </div>
    </div>
  );
}
