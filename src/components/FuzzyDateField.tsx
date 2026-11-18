import { useEffect, useRef, useState } from 'react';

interface FuzzyDateFieldProps {
  label: string;
  value?: string;
  placeholder?: string;
  onChange: (value: string | undefined) => void;
}

/**
 * Champ de date en texte libre. Le texte saisi fait foi ; l'analyse floue
 * reste dans `domain/dates.ts` pour un usage interne (frise, tri), sans
 * afficher de colonnes à l'utilisateur.
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

  return (
    <label className="field fuzzy-field">
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
          if (draft !== (value ?? '')) onChange(draft || undefined);
          setDraft(draft);
        }}
      />
    </label>
  );
}
