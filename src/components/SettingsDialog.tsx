import { useEffect, useState } from 'react';
import { personChoiceLabel } from '../domain/personChoices';
import { personLabel, type FamilyData, type Id } from '../domain/types';
import {
  createBranch,
  memberCountOf,
  type Branch,
  type ViewSettings,
} from '../domain/settings';

interface SettingsDialogProps {
  data: FamilyData;
  settings: ViewSettings;
  onChange: (settings: ViewSettings) => void;
  /** Si fourni, précrée une branche démarrant sur cette personne. */
  branchStartId?: Id | null;
  onClose: () => void;
}

const PERSON_OPTIONS = (data: FamilyData) =>
  [...data.persons].sort((a, b) =>
    personLabel(a).localeCompare(personLabel(b), 'fr'),
  );

export default function SettingsDialog({
  data,
  settings,
  onChange,
  branchStartId,
  onClose,
}: SettingsDialogProps) {
  const [newBranchName, setNewBranchName] = useState('');
  const persons = PERSON_OPTIONS(data);

  useEffect(() => {
    if (!branchStartId) return;
    const source = data.persons.find((person) => person.id === branchStartId);
    if (!source) return;
    const existing = settings.branches.find(
      (branch) => branch.startPersonId === branchStartId,
    );
    if (existing) return;
    const branch = createBranch(`Branche de ${personLabel(source)}`, settings.branches);
    onChange({
      ...settings,
      branches: [
        ...settings.branches,
        { ...branch, startPersonId: branchStartId, memberIds: [branchStartId] },
      ],
    });
    // Une seule précréation par ouverture du dialogue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchStartId]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const selectPerson = (id: Id | undefined): string => id ?? '';
  const onSelectPerson = (value: string): Id | undefined => value || undefined;

  const updateBranch = (id: Id, patch: Partial<Branch>) =>
    onChange({
      ...settings,
      branches: settings.branches.map((branch) =>
        branch.id === id ? { ...branch, ...patch } : branch,
      ),
    });

  const toggleMember = (branch: Branch, personId: Id) =>
    updateBranch(branch.id, {
      memberIds: branch.memberIds.includes(personId)
        ? branch.memberIds.filter((member) => member !== personId)
        : [...branch.memberIds, personId],
    });

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Réglages de l’arbre"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Réglages de lecture</h2>
          <p className="modal-subtitle">
            Ces réglages sont personnels : ils ne modifient pas les données
            familiales partagées.
          </p>
        </div>

        <div className="modal-body settings-body">
          <section className="settings-section">
            <h3>Vos repères</h3>
            <div className="form-grid">
              <label className="field">
                <span>C’est moi</span>
                <select
                  value={selectPerson(settings.meId)}
                  onChange={(event) =>
                    onChange({ ...settings, meId: onSelectPerson(event.target.value) })
                  }
                >
                  <option value="">Aucun</option>
                  {persons.map((person) => (
                    <option key={person.id} value={person.id}>
                      {personChoiceLabel(data, person)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Personne de référence</span>
                <select
                  value={selectPerson(settings.referenceId)}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      referenceId: onSelectPerson(event.target.value),
                    })
                  }
                >
                  <option value="">Aucune</option>
                  {persons.map((person) => (
                    <option key={person.id} value={person.id}>
                      {personChoiceLabel(data, person)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="panel-note">
              La personne de référence détermine seulement où la vue se pose à
              l’ouverture : l’arbre reste global et identique pour tous. Le
              marqueur « Moi » est propre à chaque compte.
            </p>
          </section>

          <section className="settings-section">
            <h3>Branches</h3>
            <p className="panel-note">
              Des étiquettes colorées, sans racine imposée : une personne peut
              appartenir à plusieurs branches et aucune n’est propriétaire
              exclusive d’une branche.
            </p>
            <div className="branch-new">
              <input
                value={newBranchName}
                placeholder="Nom de la branche"
                onChange={(event) => setNewBranchName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newBranchName.trim()) {
                    onChange({
                      ...settings,
                      branches: [
                        ...settings.branches,
                        createBranch(newBranchName, settings.branches),
                      ],
                    });
                    setNewBranchName('');
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-mini btn-primary"
                disabled={!newBranchName.trim()}
                onClick={() => {
                  onChange({
                    ...settings,
                    branches: [
                      ...settings.branches,
                      createBranch(newBranchName, settings.branches),
                    ],
                  });
                  setNewBranchName('');
                }}
              >
                Ajouter
              </button>
            </div>

            {settings.branches.length === 0 ? (
              <p className="panel-note">Aucune branche définie.</p>
            ) : (
              <ul className="branch-list">
                {settings.branches.map((branch) => (
                  <li key={branch.id} className="branch-item">
                    <div className="branch-item-head">
                      <input
                        type="color"
                        aria-label={`Couleur de ${branch.name}`}
                        value={branch.color}
                        onChange={(event) =>
                          updateBranch(branch.id, { color: event.target.value })
                        }
                      />
                      <input
                        className="branch-name"
                        value={branch.name}
                        aria-label="Nom de la branche"
                        onChange={(event) =>
                          updateBranch(branch.id, { name: event.target.value })
                        }
                      />
                      <span className="branch-count">
                        {memberCountOf(settings, branch.id)} membre(s)
                      </span>
                      <button
                        type="button"
                        className="btn btn-mini"
                        onClick={() =>
                          onChange({
                            ...settings,
                            branches: settings.branches.filter(
                              (candidate) => candidate.id !== branch.id,
                            ),
                          })
                        }
                      >
                        Supprimer
                      </button>
                    </div>
                    <label className="field">
                      <span>Personne de départ (facultatif)</span>
                      <select
                        value={selectPerson(branch.startPersonId)}
                        onChange={(event) =>
                          updateBranch(branch.id, {
                            startPersonId: onSelectPerson(event.target.value),
                          })
                        }
                      >
                        <option value="">Aucune</option>
                        {persons.map((person) => (
                          <option key={person.id} value={person.id}>
                            {personChoiceLabel(data, person)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="branch-members">
                      {persons.length === 0 ? (
                        <span className="panel-note">Ajoutez d’abord une personne.</span>
                      ) : (
                        persons.map((person) => (
                          <label key={person.id} className="branch-member">
                            <input
                              type="checkbox"
                              checked={branch.memberIds.includes(person.id)}
                              onChange={() => toggleMember(branch, person.id)}
                            />
                            <span>{personChoiceLabel(data, person)}</span>
                          </label>
                        ))
                      )}
                    </div>
                </li>
              ))}
            </ul>
            )}
          </section>
        </div>

        <footer className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Terminé
          </button>
        </footer>
      </div>
    </div>
  );
}
