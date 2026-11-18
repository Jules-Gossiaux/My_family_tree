import { useEffect, useState } from 'react';
import {
  FILIATION_TYPES,
  LINK_DESCRIPTIONS,
  LINK_LABELS,
  UNION_STATUSES,
  UNION_STATUS_LABELS,
  type Id,
  type LinkType,
  type NewPersonInput,
  type UnionMetaInput,
  type UnionStatus,
} from '../domain/types';
import { GENDER_LABELS } from '../utils/format';
import FuzzyDateField from './FuzzyDateField';

export type AddKind = 'first' | 'parent' | 'sibling' | 'child' | 'spouse';

export interface DialogConfig {
  kind: AddKind;
  personId?: Id;
}

export interface SelectOption {
  id: Id;
  label: string;
}

export interface RelationOptions {
  /** `null` = forcer une nouvelle union parentale ; `undefined` = auto. */
  unionId?: Id | null;
  linkType: LinkType;
  unionMeta?: Partial<UnionMetaInput>;
}

export type DialogResult =
  | ({ mode: 'new'; input: NewPersonInput } & RelationOptions)
  | ({ mode: 'existing'; personId: Id } & RelationOptions);

interface PersonFormDialogProps {
  config: DialogConfig;
  contextName: string;
  hint: string;
  existingOptions: SelectOption[];
  unionOptions: SelectOption[];
  onSubmit: (result: DialogResult) => void;
  onCancel: () => void;
}

const TITLES: Record<AddKind, string> = {
  first: 'Créer la première personne',
  parent: 'Ajouter un parent',
  sibling: 'Ajouter un frère ou une sœur',
  child: 'Ajouter un enfant',
  spouse: 'Ajouter un conjoint',
};

const SUBMIT_LABELS: Record<AddKind, string> = {
  first: 'Créer la personne',
  parent: 'Ajouter le parent',
  sibling: 'Ajouter à la fratrie',
  child: 'Ajouter l’enfant',
  spouse: 'Ajouter le conjoint',
};

const LINK_KINDS: AddKind[] = ['parent', 'sibling', 'child'];

export default function PersonFormDialog({
  config,
  contextName,
  hint,
  existingOptions,
  unionOptions,
  onSubmit,
  onCancel,
}: PersonFormDialogProps) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [form, setForm] = useState<NewPersonInput>({
    firstName: '',
    lastName: '',
    gender: 'unspecified',
  });
  const [existingId, setExistingId] = useState('');
  const [unionId, setUnionId] = useState(() =>
    unionOptions.length === 1 ? unionOptions[0].id : '',
  );
  const [linkType, setLinkType] = useState<LinkType>('biological');
  const [status, setStatus] = useState<UnionStatus>('partnered');
  const [isCurrent, setIsCurrent] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');

  const canLinkExisting = config.kind !== 'first' && existingOptions.length > 0;
  const showLinkKind = LINK_KINDS.includes(config.kind);
  const showUnionMeta = config.kind === 'spouse';

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const canSubmit =
    mode === 'existing' && canLinkExisting
      ? existingId !== ''
      : form.firstName.trim() !== '' || form.lastName.trim() !== '';

  const submit = () => {
    if (!canSubmit) {
      setError(
        mode === 'existing'
          ? 'Choisissez une personne dans la liste.'
          : 'Renseignez au moins un prénom ou un nom.',
      );
      return;
    }

    const options: RelationOptions = {
      unionId:
        unionOptions.length === 0 ? undefined : unionId === '' ? null : unionId,
      linkType: showLinkKind ? linkType : 'biological',
      unionMeta: showUnionMeta
        ? {
            status,
            isCurrent,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          }
        : undefined,
    };

    if (mode === 'existing' && canLinkExisting) {
      onSubmit({ mode: 'existing', personId: existingId, ...options });
      return;
    }
    onSubmit({
      mode: 'new',
      input: {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        gender: form.gender,
        birthDate: form.birthDate || undefined,
        deathDate: form.deathDate || undefined,
        address: form.address?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        email: form.email?.trim() || undefined,
        cemetery: form.cemetery?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      },
      ...options,
    });
  };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[config.kind]}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{TITLES[config.kind]}</h2>
          {config.kind !== 'first' && (
            <p className="modal-context">Lié à {contextName}</p>
          )}
        </div>

        {canLinkExisting && (
          <div className="mode-switch" role="tablist" aria-label="Type d’ajout">
            <button
              type="button"
              className={mode === 'new' ? 'is-active' : ''}
              onClick={() => {
                setMode('new');
                setError('');
              }}
            >
              Nouvelle personne
            </button>
            <button
              type="button"
              className={mode === 'existing' ? 'is-active' : ''}
              onClick={() => {
                setMode('existing');
                setError('');
              }}
            >
              Personne existante
            </button>
          </div>
        )}

        <p className="modal-hint">
          {mode === 'existing'
            ? 'Reliez deux personnes déjà présentes dans l’arbre : c’est ainsi que se représentent un mariage entre cousins ou un rattachement découvert plus tard. Les liens qui créeraient un cycle sont exclus de la liste.'
            : hint}
        </p>

        {mode === 'existing' && canLinkExisting ? (
          <label className="field field-full">
            <span>Choisir une personne</span>
            <select
              value={existingId}
              onChange={(event) => setExistingId(event.target.value)}
            >
              <option value="">— Sélectionner —</option>
              {existingOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="form-grid">
            <label className="field">
              <span>Prénom</span>
              <input
                autoFocus
                value={form.firstName}
                placeholder="Prénom"
                onChange={(event) =>
                  setForm({ ...form, firstName: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit();
                }}
              />
            </label>
            <label className="field">
              <span>Nom</span>
              <input
                value={form.lastName}
                placeholder="Nom de famille"
                onChange={(event) =>
                  setForm({ ...form, lastName: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit();
                }}
              />
            </label>
            <label className="field">
              <span>Genre</span>
              <select
                value={form.gender}
                onChange={(event) =>
                  setForm({
                    ...form,
                    gender: event.target.value as NewPersonInput['gender'],
                  })
                }
              >
                {(
                  Object.keys(GENDER_LABELS) as Array<NewPersonInput['gender']>
                ).map((gender) => (
                  <option key={gender} value={gender}>
                    {GENDER_LABELS[gender]}
                  </option>
                ))}
              </select>
            </label>
            <FuzzyDateField
              label="Naissance"
              value={form.birthDate}
              onChange={(birthDate) => setForm({ ...form, birthDate })}
            />
            <FuzzyDateField
              label="Décès"
              value={form.deathDate}
              onChange={(deathDate) => setForm({ ...form, deathDate })}
            />
            <label className="field">
              <span>Téléphone</span>
              <input
                value={form.phone ?? ''}
                placeholder="06 …"
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>E-mail</span>
              <input
                type="email"
                value={form.email ?? ''}
                placeholder="prenom@exemple.fr"
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </label>
            <label className="field field-full">
              <span>Adresse</span>
              <input
                value={form.address ?? ''}
                placeholder="Adresse postale"
                onChange={(event) =>
                  setForm({ ...form, address: event.target.value })
                }
              />
            </label>
            {form.deathDate?.trim() ? (
              <label className="field field-full">
                <span>Cimetière</span>
                <input
                  value={form.cemetery ?? ''}
                  placeholder="Lieu de sépulture"
                  onChange={(event) =>
                    setForm({ ...form, cemetery: event.target.value })
                  }
                />
              </label>
            ) : null}
            <label className="field field-full">
              <span>Note (optionnelle)</span>
              <textarea
                rows={2}
                value={form.notes ?? ''}
                placeholder="Une précision à conserver…"
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </label>
          </div>
        )}

        {unionOptions.length > 1 && (
          <label className="field field-full union-select">
            <span>Rattacher l’enfant à</span>
            <select
              value={unionId}
              onChange={(event) => setUnionId(event.target.value)}
            >
              <option value="">Nouvelle union parentale</option>
              {unionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {showLinkKind && (
          <div className="extra-fields">
            <label className="field field-full">
              <span>Nature du lien de filiation</span>
              <select
                value={linkType}
                onChange={(event) =>
                  setLinkType(event.target.value as LinkType)
                }
              >
                {FILIATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {LINK_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-help">{LINK_DESCRIPTIONS[linkType]}</p>
          </div>
        )}

        {showUnionMeta && (
          <div className="extra-fields">
            <h3>Informations sur l’union</h3>
            <div className="form-grid">
              <label className="field">
                <span>Statut</span>
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as UnionStatus)
                  }
                >
                  {UNION_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {UNION_STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Union actuelle ?</span>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={isCurrent}
                    onChange={(event) => setIsCurrent(event.target.checked)}
                  />
                  <span>
                    {isCurrent ? 'Conjoint actuel' : 'Ancienne union'}
                  </span>
                </label>
              </label>
              <FuzzyDateField
                label="Début de l’union"
                value={startDate}
                onChange={(value) => setStartDate(value ?? '')}
              />
              <FuzzyDateField
                label="Fin de l’union"
                value={endDate}
                onChange={(value) => setEndDate(value ?? '')}
              />
            </div>
            <p className="field-help">
              Une personne peut avoir plusieurs unions. Cocher « conjoint
              actuel » marque les autres unions de cette personne comme
              anciennes ; tout reste modifiable dans sa fiche.
            </p>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            {mode === 'existing'
              ? 'Créer le lien'
              : SUBMIT_LABELS[config.kind]}
          </button>
        </div>
      </div>
    </div>
  );
}
