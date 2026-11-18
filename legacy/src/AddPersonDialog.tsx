import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import { fullName } from './dates';
import type { CreatePersonInput, Person, RelationInput, Sex } from '../shared/types';

interface Props {
  relation: RelationInput | null;
  anchorName?: string;
  /** Personnes qui peuvent devenir le second parent : unions déjà connues de l'ancrage. */
  otherParentCandidates?: Person[];
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
    address: string | null;
    phone: string | null;
    email: string | null;
    cemetery: string | null;
  } | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}

const RELATION_LABEL: Record<string, string> = {
  child: 'enfant de',
  partner: 'conjoint de',
  parent: 'parent de',
};

export default function AddPersonDialog({
  relation,
  anchorName,
  otherParentCandidates = [],
  editing,
  onClose,
  onSaved,
}: Props) {
  const [givenNames, setGivenNames] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [birthName, setBirthName] = useState('');
  const [nickname, setNickname] = useState('');
  const [sex, setSex] = useState<Sex>('?');
  const [living, setLiving] = useState(true);
  const [birthText, setBirthText] = useState('');
  const [deathText, setDeathText] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cemetery, setCemetery] = useState('');
  const [otherParentId, setOtherParentId] = useState('');
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
      setAddress(editing.address ?? '');
      setPhone(editing.phone ?? '');
      setEmail(editing.email ?? '');
      setCemetery(editing.cemetery ?? '');
    } else {
      setGivenNames('');
      setFamilyName(anchorName ? anchorName.split(' ').slice(-1)[0] ?? '' : '');
      setBirthName('');
      setNickname('');
      setSex('?');
      setLiving(true);
      setBirthText('');
      setDeathText('');
      setAddress('');
      setPhone('');
      setEmail('');
      setCemetery('');
      // Une seule union connue : on la pré-sélectionne, mais elle reste visible et modifiable.
      setOtherParentId(otherParentCandidates.length === 1 ? otherParentCandidates[0].id : '');
    }
    setError(null);
    setTimeout(() => firstField.current?.focus(), 30);
  }, [editing, anchorName, otherParentCandidates]);

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
          address: address || null,
          phone: phone || null,
          email: email || null,
          cemetery: cemetery || null,
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
          address: address || null,
          phone: phone || null,
          email: email || null,
          cemetery: cemetery || null,
          relation: relation ? { ...relation, otherParentId: otherParentId || null } : null,
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

        {!editing &&
          relation &&
          relation.type !== 'partner' &&
          otherParentCandidates.length > 0 && (
            <label className="field">
              <span>
                {relation.type === 'child'
                  ? 'Et l’autre parent est…'
                  : 'Ce parent forme un couple avec…'}
              </span>
              <select
                value={otherParentId}
                onChange={(e) => setOtherParentId(e.target.value)}
              >
                <option value="">Personne — on ne déclare pas d’union</option>
                {otherParentCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {fullName(candidate)}
                  </option>
                ))}
              </select>
            </label>
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

        <div className="field-row">
          <label className="field">
            <span>Adresse</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="12 rue des Lilas, 59000 Lille"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Téléphone</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="06 12 34 56 78"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="marie@exemple.fr"
              autoComplete="off"
            />
          </label>
        </div>

        {(!living || deathText.trim() !== '') && (
          <div className="field-row">
            <label className="field">
              <span>Cimetière</span>
              <input
                value={cemetery}
                onChange={(e) => setCemetery(e.target.value)}
                placeholder="Cimetière de l'Est, Lille"
                autoComplete="off"
              />
            </label>
          </div>
        )}

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
