import { useState } from 'react';

export interface SelectOption {
  id: string;
  label: string;
}

interface DirectorySelectProps {
  label: string;
  options: SelectOption[];
  value?: string;
  emptyLabel?: string;
  createLabel?: string;
  onCreate?: (name: string) => string | undefined;
  onChange: (id: string | undefined) => void;
}

/**
 * Sélecteur de répertoire avec création en place. La création ne fusionne
 * jamais un homonyme : elle renvoie l'identifiant de la notice créée.
 */
export default function DirectorySelect({
  label,
  options,
  value,
  emptyLabel = 'Aucun',
  createLabel = 'Créer',
  onCreate,
  onChange,
}: DirectorySelectProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  const submit = () => {
    if (!onCreate || !draft.trim()) return;
    const created = onCreate(draft.trim());
    if (created) onChange(created);
    setDraft('');
    setCreating(false);
  };

  return (
    <div className="directory-select">
      <div className="directory-select-row">
        <label className="field">
          <span>{label}</span>
          <select
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value || undefined)}
          >
            <option value="">{emptyLabel}</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {onCreate && (
          <button
            type="button"
            className="btn btn-mini"
            onClick={() => setCreating((current) => !current)}
            title={createLabel}
          >
            {creating ? '×' : '+'}
          </button>
        )}
      </div>
      {creating && (
        <div className="directory-select-create">
          <input
            autoFocus
            value={draft}
            placeholder={createLabel}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
              if (event.key === 'Escape') setCreating(false);
            }}
          />
          <button type="button" className="btn btn-mini" onClick={submit}>
            Créer
          </button>
        </div>
      )}
    </div>
  );
}
