import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import type { CreatePersonInput, RelationInput, Sex } from '../shared/types';

interface Props {
  relation: RelationInput | null;
  anchorName?: string;
  editing?: {
    id: string;
    givenNames: string;
    familyName: string;
    birthName: string | null;
    sex: Sex;
    living: boolean;
    birthText: string;
    deathText: string;
    nickname: string;
  } | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}

const RELATION_LABEL: Record<string, string> = {
  child: 'enfant de',
  partner: 'conjoint de',
  parent: 'parent de',
};

export default function AddPersonDialog({ relation, anchorName, editing, onClose, onSaved }: Props) {
  const [givenNames, setGivenNames] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [birthName, setBirthName] = useState('');
  const [nickname, setNickname] = useState('');
  const [sex, setSex] = useState<Sex>('?');
  const [living, setLiving] = useState(true);
  const [birthText, setBirthText] = useState('');
  const [deathText, setDeathText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setGivenNames(editing.givenNames);
      setFamilyName(editing.familyName);
      setBirthName(editing.birthName ?? '');
      setNickname(editing.nickname);
      setSex(editing.sex);
      setLiving(editing.living);
      setBirthText(editing.birthText);
      setDeathText(editing.deathText);
    } else {
      setGivenNames('');
      setFamilyName(anchorName ? anchorName.split(' ').slice(-1)[0] ?? '' : '');
      setBirthName('');
      setNickname('');
      setSex('?');
      setLiving(true);
      setBirthText('');
      setDeathText('');
    }
    setError(null);
    setTimeout(() => firstField.current?.focus(), 30);
  }, [editing, anchorName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!givenNames.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.updatePerson(editing.id, {
          givenNames,
          familyName,
          birthName: birthName || null,
          sex,
          living,
          birthText,
          deathText,
          nickname,
        });
        onSaved(editing.id);
      } else {
        const input: CreatePersonInput = {
          givenNames,
          familyName,
          birthName: birthName || null,
          sex,
          living,
          birthText,
          deathText,
          relation,
        };
        const created = await api.createPerson(input);
        onSaved(created.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’enregistrement');
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="dialog-title">
          {editing ? 'Modifier la personne' : 'Nouvelle personne'}
        </h2>
        {!editing && relation && anchorName && (
          <p className="dialog-context">
            {RELATION_LABEL[relation.type]} <strong>{anchorName}</strong>
          </p>
        )}

        <div className="field-row">
          <label className="field">
            <span>Prénoms</span>
            <input
              ref={firstField}
              value={givenNames}
              onChange={(e) => setGivenNames(e.target.value)}
              placeholder="Marie Louise"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Nom</span>
            <input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="Dubois"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Nom de naissance</span>
            <input
              value={birthName}
              onChange={(e) => setBirthName(e.target.value)}
              placeholder="si différent"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Surnom</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Tata Michèle"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Naissance</span>
            <input
              value={birthText}
              onChange={(e) => setBirthText(e.target.value)}
              placeholder="1923 · vers 1920 · avant 1900"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Décès</span>
            <input
              value={deathText}
              onChange={(e) => setDeathText(e.target.value)}
              placeholder="2004"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="field-row align-end">
          <div className="field">
            <span>Sexe</span>
            <div className="segmented">
              {(['F', 'M', 'X', '?'] as Sex[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={sex === value ? 'on' : ''}
                  onClick={() => setSex(value)}
                >
                  {value === '?' ? '?' : value}
                </button>
              ))}
            </div>
          </div>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={living}
              onChange={(e) => setLiving(e.target.checked)}
            />
            <span>En vie</span>
          </label>
        </div>

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <span className="hint-key">Entrée pour enregistrer · Échap pour annuler</span>
          <button type="button" className="ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="primary" disabled={busy || !givenNames.trim()}>
            {editing ? 'Enregistrer' : 'Ajouter'}
          </button>
        </div>
      </form>
    </div>
  );
}
