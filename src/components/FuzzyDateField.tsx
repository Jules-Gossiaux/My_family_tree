import { useEffect, useRef, useState } from 'react';
import {
  composeFuzzyDate,
  parseFuzzyDate,
  type FuzzyDate,
} from '../domain/dates';

interface FuzzyDateFieldProps {
  label: string;
  value?: string;
  placeholder?: string;
  onChange: (value: string | undefined) => void;
}

const COLUMNS: Array<{
  key: keyof Omit<FuzzyDate, 'raw'>;
  label: string;
}> = [
  { key: 'qualifier', label: 'Qualificatif' },
  { key: 'day', label: 'Jour' },
  { key: 'month', label: 'Mois' },
  { key: 'year', label: 'Année' },
];

/**
 * Champ de date en texte libre, avec lecture/édition des quatre colonnes.
 * Le texte reste la source de vérité ; les colonnes se mettent à jour pendant
 * la saisie. Modifier une colonne recompose le texte.
 */
export default function FuzzyDateField({
  label,
  value,
  placeholder = 'vers 1890 · avant 1914 · 12 mars 1890',
  onChange,
}: FuzzyDateFieldProps) {
  const [draft, setDraft] = useState(value ?? '');
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(value ?? '');
  }, [value]);

  const parsed = parseFuzzyDate(draft);

  const setColumn = (
    key: keyof Omit<FuzzyDate, 'raw'>,
    next: string,
  ): void => {
    const composed = composeFuzzyDate({ ...parsed, [key]: next });
    setDraft(composed);
    onChange(composed || undefined);
  };

  return (
    <div className="field fuzzy-field">
      <span>{label}</span>
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          onChange(next || undefined);
        }}
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
          // Le texte saisi fait foi : on ne le réécrit jamais, même si les
          // quatre colonnes n'ont pas su tout interpréter (« baptisé le… »).
          if (draft !== (value ?? '')) onChange(draft || undefined);
          setDraft(draft);
        }}
      />
      <div className="fuzzy-columns" aria-label={`Date floue : ${label}`}>
        {COLUMNS.map((column) => (
          <label key={column.key} className="fuzzy-column">
            <span>{column.label}</span>
            <input
              value={parsed[column.key]}
              aria-label={`${label} — ${column.label}`}
              onChange={(event) => setColumn(column.key, event.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
