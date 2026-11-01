import { useEffect, useState } from 'react';
import { api } from './api';
import { saveFromServer } from './saveFile';
import { fullName } from './dates';
import type { BackupInfo, Branch, Person, PlaceRow, SourceInput, SourceRow } from '../shared/types';

interface Props {
  dataDir: string;
  dataDirFromEnv: boolean;
  rootPersonId: string | null;
  mePersonId: string | null;
  persons: Person[];
  branches: Branch[];
  places: PlaceRow[];
  sources: SourceRow[];
  onClose: () => void;
  onRootChange: (personId: string) => void;
  onMeChange: (personId: string) => void;
  /**
   * Une branche, un lieu ou une source a bougé : l'arbre, la fiche et les compteurs repartent de la
   * même image.
   */
  onChanged: () => void;
  onBackup: (info: BackupInfo) => void;
  onToast: (message: string) => void;
}

/** Un compte, au singulier s'il ne vaut qu'un. */
function count(total: number, word: string): string {
  return `${total} ${word}${total > 1 ? 's' : ''}`;
}

/** Les cinq genres connus de la base, stockés sans accent et dits en français ici. */
const KINDS: { value: string; label: string }[] = [
  { value: 'acte', label: 'Acte' },
  { value: 'photo', label: 'Photo' },
  { value: 'temoignage', label: 'Témoignage' },
  { value: 'web', label: 'Site web' },
  { value: 'livre', label: 'Livre' },
];

const RELIABILITIES: { value: string; label: string }[] = [
  { value: 'certain', label: 'certaine' },
  { value: 'probable', label: 'probable' },
  { value: 'douteux', label: 'douteuse' },
];

function size(bytes: number): string {
  const mo = bytes / 1024 / 1024;
  return mo >= 1
    ? `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 }).format(mo)} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} ko`;
}

function archiveDate(backup: BackupInfo): string {
  return new Date(backup.createdAt).toLocaleString('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Le nom porte le motif de l'archive : « session », « manuel », « avant-restauration ». */
function reason(name: string): string {
  const parts = name.replace(/^famille-/, '').replace(/\.zip$/, '').split('-');
  return parts.slice(4).join(' ') || 'archive';
}

/**
 * Une ligne de branche : ce qu'elle porte comme nom, comme teinte, de qui elle part, et ce qu'on en
 * fait. Tout se corrige ici, y compris le nom que la création a posé à la hâte depuis l'arbre.
 */
function BranchRow({
  branch,
  persons,
  onChanged,
  onToast,
}: {
  branch: Branch;
  persons: Person[];
  onChanged: () => void;
  onToast: (message: string) => void;
}) {
  const [name, setName] = useState(branch.name);
  const [color, setColor] = useState(branch.color);
  const [rootId, setRootId] = useState(branch.rootPersonId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'range' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Le graphe peut revenir d'en dessous (une personne rangée entre-temps) : la ligne se remet à jour,
  // mais seulement quand ce n'est pas ce que l'on est en train d'écrire.
  useEffect(() => {
    setName(branch.name);
    setColor(branch.color);
    setRootId(branch.rootPersonId ?? '');
  }, [branch.name, branch.color, branch.rootPersonId]);

  const dirty =
    name.trim() !== branch.name ||
    color.toLowerCase() !== branch.color.toLowerCase() ||
    rootId !== (branch.rootPersonId ?? '');

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await api.updateBranch(branch.id, { name, color, rootPersonId: rootId || null });
      onChanged();
      onToast(`Branche « ${name.trim()} » enregistrée`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La branche n’a pas pu être enregistrée');
    } finally {
      setBusy(null);
    }
  };

  const range = async () => {
    setBusy('range');
    setError(null);
    try {
      const { assigned } = await api.branchDescendants(branch.id);
      onChanged();
      onToast(
        assigned === 0
          ? 'Personne de plus : les descendants étaient déjà rangés ailleurs'
          : `${assigned} personne${assigned > 1 ? 's' : ''} rangée${assigned > 1 ? 's' : ''} sous ${branch.name}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le rangement a échoué');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      await api.deleteBranch(branch.id);
      onChanged();
      setConfirming(false);
      const freed = branch.personCount;
      onToast(
        `Branche « ${branch.name} » supprimée — ${freed} personne${freed > 1 ? 's' : ''} rendue${freed > 1 ? 's' : ''} au hors-classe`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="branch-row">
      <span className="branch-main">
        <input
          className="branch-color"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          aria-label={`Couleur de la branche ${branch.name}`}
        />
        <input
          className="branch-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
          spellCheck={false}
          aria-label="Nom de la branche"
        />
        <select
          value={rootId}
          onChange={(event) => setRootId(event.target.value)}
          aria-label="Personne dont part la branche"
        >
          <option value="">Sans tête de ligne</option>
          {persons.map((person) => (
            <option key={person.id} value={person.id}>
              {fullName(person)}
            </option>
          ))}
        </select>
        <span className="branch-meta">
          {branch.personCount} case{branch.personCount > 1 ? 's' : ''}
        </span>
      </span>

      <span className="branch-side">
        <button type="button" className="ghost" onClick={save} disabled={busy !== null || !dirty || !name.trim()}>
          {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={range}
          disabled={busy !== null || !branch.rootPersonId}
          title={
            branch.rootPersonId
              ? 'Ranger aussi les descendants de la tête de ligne, ceux qui n’ont pas encore de branche'
              : 'Choisissez d’abord une personne dont la branche part'
          }
        >
          {busy === 'range' ? 'Rangement…' : 'Ranger ses descendants'}
        </button>
        {confirming ? (
          <>
            <button type="button" className="danger-solid" onClick={remove} disabled={busy !== null}>
              Confirmer
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ghost"
            onClick={() => setConfirming(true)}
            title="Effacer la branche : les personnes redeviennent sans teinte, rien n’est supprimé"
          >
            Supprimer
          </button>
        )}
      </span>

      {error && <p className="dialog-error">{error}</p>}
    </li>
  );
}

/**
 * Une ligne de lieu : le nom tel qu'il est écrit sur les actes, ce qui s'y est déjà passé, et ce
 * qu'on en fait. Un lieu ne s'ajoute pas ici — il entre par le fait qui l'a vu.
 */
function PlaceEntry({
  place,
  onChanged,
  onToast,
}: {
  place: PlaceRow;
  onChanged: () => void;
  onToast: (message: string) => void;
}) {
  const [name, setName] = useState(place.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Le nom peut avoir bougé sous la main, par un fait écrit dans une autre fiche : on le suit,
  // mais seulement quand ce n'est pas ce que l'on est en train d'écrire.
  useEffect(() => {
    setName(place.name);
  }, [place.name]);

  const clean = name.trim();
  const dirty = clean !== place.name;

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await api.updatePlace(place.id, clean);
      onChanged();
      onToast(`Lieu « ${place.name} » renommé « ${clean} »`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le lieu n’a pas pu être renommé');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      const { events, media } = await api.deletePlace(place.id);
      onChanged();
      setConfirming(false);
      const still = events + media;
      onToast(
        still === 0
          ? `Lieu « ${place.name} » effacé — rien ne pointait ici`
          : `Lieu « ${place.name} » effacé — ${count(events, 'fait')}${
              media > 0 ? ` et ${count(media, 'fichier')}` : ''
            } ${still > 1 ? 'restent' : 'reste'} sans lieu`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="branch-row">
      <span className="branch-main">
        <input
          className="branch-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
          spellCheck={false}
          aria-label={`Nom du lieu ${place.name}`}
        />
        <span className="branch-meta">
          {count(place.eventCount, 'fait')}
          {place.mediaCount > 0 && ` · ${count(place.mediaCount, 'fichier')}`}
        </span>
      </span>

      <span className="branch-side">
        <button
          type="button"
          className="ghost"
          onClick={save}
          disabled={busy !== null || !dirty || !clean}
        >
          {busy === 'save' ? 'Enregistrement…' : 'Renommer'}
        </button>
        {confirming ? (
          <>
            <button type="button" className="danger-solid" onClick={remove} disabled={busy !== null}>
              Confirmer
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ghost"
            onClick={() => setConfirming(true)}
            title="Effacer ce nom : les faits et les fichiers qui y pointaient restent, ils deviennent simplement sans lieu"
          >
            Supprimer
          </button>
        )}
      </span>

      {error && <p className="dialog-error">{error}</p>}
    </li>
  );
}

/**
 * Une ligne de source : ce qui la désigne — sa référence — son genre, sa fiabilité, et ce qui la
 * cite. Elle ne s'efface pas tant qu'un fait la nomme : la retirer laisserait le fait sans source,
 * sans que rien ne l'ait dit.
 */
function SourceEntry({
  source,
  onChanged,
  onToast,
}: {
  source: SourceRow;
  onChanged: () => void;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<SourceInput>({
    kind: source.kind,
    reference: source.reference ?? '',
    reliability: source.reliability,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Une référence corrigée dans une autre fiche, ou un genre changé ici : la ligne suit la base,
  // mais seulement quand ce n'est pas ce que l'on est en train d'écrire.
  useEffect(() => {
    setDraft({ kind: source.kind, reference: source.reference ?? '', reliability: source.reliability });
  }, [source.kind, source.reference, source.reliability]);

  const reference = (draft.reference ?? '').trim();
  const dirty =
    reference !== (source.reference ?? '') ||
    draft.kind !== source.kind ||
    (draft.reliability ?? '') !== source.reliability;

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await api.updateSource(source.id, { ...draft, reference });
      onChanged();
      onToast(`Source « ${reference} » enregistrée`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La source n’a pas pu être enregistrée');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      await api.deleteSource(source.id);
      onChanged();
      setConfirming(false);
      onToast(`Source « ${source.reference ?? ''} » effacée — plus aucun fait ne la cite`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
    } finally {
      setBusy(null);
    }
  };

  const cited = source.eventCount + source.mediaCount;

  return (
    <li className="branch-row">
      <span className="branch-main">
        <select
          className="source-kind"
          value={draft.kind}
          onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
          aria-label={`Genre de la source ${source.reference ?? ''}`}
          disabled={busy !== null}
        >
          {KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
        <input
          className="branch-name"
          value={draft.reference ?? ''}
          onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
          placeholder="cote, titre, adresse…"
          spellCheck={false}
          aria-label="Référence de la source"
        />
        <select
          className="source-reliability"
          value={draft.reliability}
          onChange={(event) => setDraft({ ...draft, reliability: event.target.value })}
          aria-label="Fiabilité de la source"
          title="Ce que vaut la source en elle-même : un acte original, un registre, une mémoire de famille"
          disabled={busy !== null}
        >
          {RELIABILITIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="branch-meta">
          {count(source.eventCount, 'fait cité')}
          {source.mediaCount > 0 && ` · ${count(source.mediaCount, 'fichier')}`}
        </span>
      </span>

      <span className="branch-side">
        <button
          type="button"
          className="ghost"
          onClick={save}
          disabled={busy !== null || !dirty || !reference}
        >
          {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {confirming ? (
          <>
            <button type="button" className="danger-solid" onClick={remove} disabled={busy !== null}>
              Confirmer
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ghost"
            onClick={() => setConfirming(true)}
            disabled={cited > 0}
            title={
              cited > 0
                ? `Encore citée par ${count(source.eventCount, 'fait')}${
                    source.mediaCount > 0 ? ` et ${count(source.mediaCount, 'fichier')}` : ''
                  } : enlevez-la d'abord de chaque fait qui la cite`
                : 'Effacer cette source : rien ne la cite, aucun fait ne bouge'
            }
          >
            Supprimer
          </button>
        )}
      </span>

      {error && <p className="dialog-error">{error}</p>}
    </li>
  );
}

/**
 * L'écran de fin de saisie : où vivent les données, de qui l'arbre part, quelles branches le
 * colorent, quels lieux et quelles sources se corrigent, et comment une copie sort du disque.
 */
export default function SettingsDialog({
  dataDir,
  dataDirFromEnv,
  rootPersonId,
  mePersonId,
  persons,
  branches,
  places,
  sources,
  onClose,
  onRootChange,
  onMeChange,
  onChanged,
  onBackup,
  onToast,
}: Props) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [draftDir, setDraftDir] = useState('');
  const [draftBranch, setDraftBranch] = useState('');
  const [draftSource, setDraftSource] = useState('');
  const [draftKind, setDraftKind] = useState('acte');
  const [dirNote, setDirNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'backup' | 'export' | 'copy' | 'dir' | 'branch' | 'source' | null>(null);
  const [copyingName, setCopyingName] = useState<string | null>(null);

  const reloadBackups = async () => {
    try {
      const list = await api.backups();
      setBackups(list.backups);
    } catch {
      /* le dossier de sauvegardes peut être vide : la liste s'affiche simplement vide */
    }
  };

  useEffect(() => {
    void reloadBackups();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changeDir = async () => {
    if (!draftDir.trim() || busy) return;
    setBusy('dir');
    setError(null);
    setDirNote(null);
    try {
      const result = await api.setDataDir(draftDir);
      setDraftDir('');
      setDirNote(result.note);
      if (result.restartNeeded) onToast('Dossier enregistré : redémarrez pour l’ouvrir');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ce dossier n’est pas utilisable');
    } finally {
      setBusy(null);
    }
  };

  const addBranch = async () => {
    if (!draftBranch.trim() || busy) return;
    setBusy('branch');
    setError(null);
    try {
      const { branch } = await api.createBranch({ name: draftBranch });
      setDraftBranch('');
      onChanged();
      onToast(`Branche « ${branch.name} » ajoutée — sa couleur se règle sur sa ligne`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La branche n’a pas pu être ajoutée');
    } finally {
      setBusy(null);
    }
  };

  const addSource = async () => {
    if (!draftSource.trim() || busy) return;
    setBusy('source');
    setError(null);
    try {
      const { source } = await api.createSource({ kind: draftKind, reference: draftSource });
      setDraftSource('');
      onChanged();
      onToast(`Source « ${source.reference ?? ''} » ajoutée — sa fiabilité se règle sur sa ligne`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La source n’a pas pu être ajoutée');
    } finally {
      setBusy(null);
    }
  };

  const runBackup = async () => {
    if (busy) return;
    setBusy('backup');
    setError(null);
    try {
      const info = await api.backup();
      onBackup(info);
      await reloadBackups();
      onToast('Sauvegarde créée');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sauvegarde impossible');
    } finally {
      setBusy(null);
    }
  };

  const save = async (url: string, name: string, whileBusy: 'export' | 'copy') => {
    if (busy) return;
    setBusy(whileBusy);
    setCopyingName(name);
    setError(null);
    try {
      const saved = await saveFromServer(url, name);
      if (saved) onToast(whileBusy === 'export' ? 'Arbre exporté en JSON' : 'Copie enregistrée');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copie impossible');
    } finally {
      setBusy(null);
      setCopyingName(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog dialog-settings" onMouseDown={(event) => event.stopPropagation()}>
        <h2 className="dialog-title">Réglages</h2>

        <div className="section">
          <h3 className="section-title">Dossier de données</h3>
          <p className="settings-value">{dataDir}</p>
          {dataDirFromEnv && (
            <p className="settings-note">
              Ce chemin vient de la variable <code>FAMILY_DATA_DIR</code> : elle prime sur le choix
              fait ici.
            </p>
          )}
          <div className="field-row align-end">
            <label className="field">
              <span>Changer pour</span>
              <input
                value={draftDir}
                onChange={(event) => setDraftDir(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void changeDir();
                }}
                placeholder="D:\Genealogie"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="ghost"
              onClick={changeDir}
              disabled={busy !== null || !draftDir.trim()}
            >
              {busy === 'dir' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          {dirNote && <p className="pick-summary">{dirNote}</p>}
        </div>

        <div className="section">
          <h3 className="section-title">Souche de l'arbre</h3>
          {persons.length === 0 ? (
            <p className="settings-note">Ajoutez d’abord une personne.</p>
          ) : (
            <>
              <select
                value={rootPersonId ?? ''}
                onChange={(event) => onRootChange(event.target.value)}
              >
                <option value="" disabled>
                  Aucune personne de référence
                </option>
                {persons.map((person) => (
                  <option key={person.id} value={person.id}>
                    {fullName(person)}
                  </option>
                ))}
              </select>
              <p className="settings-note">
                L’arbre et l’export partent de cette personne. Le bouton « Faire la souche de l’arbre
                » du menu d’une personne fait la même chose.
              </p>
            </>
          )}
        </div>

        <div className="section">
          <h3 className="section-title">Moi dans l’arbre</h3>
          {persons.length === 0 ? (
            <p className="settings-note">Ajoutez d’abord une personne.</p>
          ) : (
            <>
              <select value={mePersonId ?? ''} onChange={(event) => onMeChange(event.target.value)}>
                <option value="">Personne n’est « moi »</option>
                {persons.map((person) => (
                  <option key={person.id} value={person.id}>
                    {fullName(person)}
                  </option>
                ))}
              </select>
              <p className="settings-note">
                La pastille « Me recentrer », en haut de l’arbre, saute sur cette personne. Ce n’est pas la
                souche : la souche dit d’où l’on part, « moi » dit qui l’on cherche. Le menu d’une personne
                — « C’est moi » — règle la même chose, et revenir au premier choix de cette liste le retire.
              </p>
            </>
          )}
        </div>

        <div className="section">
          <h3 className="section-title">Branches</h3>
          <p className="settings-note">
            Une branche porte un nom et une teinte : les cases de la même ligne se reconnaissent du
            premier coup d’œil. Une personne n’en porte qu’une. Le menu d’une personne — « Créer une
            branche ici » — en pose une qui part de elle et range ses descendants ; cette liste-là
            change les noms, les couleurs et les têtes de ligne.
          </p>

          {branches.length === 0 ? (
            <p className="settings-note">Aucune branche pour l’instant.</p>
          ) : (
            <ul className="branch-list">
              {branches.map((branch) => (
                <BranchRow
                  key={branch.id}
                  branch={branch}
                  persons={persons}
                  onChanged={onChanged}
                  onToast={onToast}
                />
              ))}
            </ul>
          )}

          <div className="field-row align-end">
            <label className="field">
              <span>En ajouter une</span>
              <input
                value={draftBranch}
                onChange={(event) => setDraftBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addBranch();
                }}
                placeholder="Branche Gossiaux"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="ghost"
              onClick={addBranch}
              disabled={busy !== null || !draftBranch.trim()}
            >
              {busy === 'branch' ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </div>

        <div className="section">
          <h3 className="section-title">Lieux</h3>
          <p className="settings-note">
            Un lieu entre par le fait qui l'a vu, et un nom déjà écrit se propose pendant la frappe :
            « Roubaix » tapé trois fois ne fait qu'une ligne. Cette liste répare les noms — renommer
            suit les faits et les fichiers qui pointaient ici, effacer les rend à un lieu inconnu
            sans rien effacer d'eux. Deux orthographes d'un même lieu ne se fusionnent pas encore.
          </p>

          {places.length === 0 ? (
            <p className="settings-note">
              Aucun lieu pour l'instant : écrivez-en un dans le champ « Lieu » d'un fait de vie.
            </p>
          ) : (
            <ul className="branch-list">
              {places.map((place) => (
                <PlaceEntry key={place.id} place={place} onChanged={onChanged} onToast={onToast} />
              ))}
            </ul>
          )}
        </div>

        <div className="section">
          <h3 className="section-title">Sources</h3>
          <p className="settings-note">
            Une source se déclare ici, puis se choisit sur un fait : c'est ce qui permet de dire, trois
            générations plus tard, d'où vient tel acte. Elle se désigne par sa référence — une cote, un
            titre, une adresse — et une même référence ne se déclare pas deux fois. Tant qu'un fait la
            cite, elle ne s'efface pas : le bouton se refuse tant qu'il reste une citation à retirer.
          </p>

          {sources.length === 0 ? (
            <p className="settings-note">
              Aucune source pour l'instant : un fait s'écrit déjà sans elle, et la première se déclare
              ci-dessous.
            </p>
          ) : (
            <ul className="branch-list">
              {sources.map((source) => (
                <SourceEntry key={source.id} source={source} onChanged={onChanged} onToast={onToast} />
              ))}
            </ul>
          )}

          <div className="field-row align-end">
            <label className="field">
              <span>En déclarer une</span>
              <input
                value={draftSource}
                onChange={(event) => setDraftSource(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addSource();
                }}
                placeholder="AD du Nord, 3E 142/12 — acte de naissance de 1870"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="field source-kind-pick">
              <span>Genre</span>
              <select value={draftKind} onChange={(event) => setDraftKind(event.target.value)}>
                {KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ghost"
              onClick={addSource}
              disabled={busy !== null || !draftSource.trim()}
            >
              {busy === 'source' ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </div>

        <div className="section">
          <h3 className="section-title">Sauvegardes et export</h3>
          <p className="settings-note">
            L’application archive la base et les médias dans <code>sauvegardes\</code> et garde les
            vingt dernières copies. Une copie sur le même disque ne protège de rien : « Copier
            vers… » range l’archive sur un autre support, et l’export JSON se relit sans
            l’application.
          </p>
          <div className="actions">
            <button type="button" onClick={runBackup} disabled={busy !== null}>
              {busy === 'backup' ? 'Sauvegarde…' : 'Sauvegarder maintenant'}
            </button>
            <button
              type="button"
              onClick={() => save(api.exportJsonUrl, 'arbre.json', 'export')}
              disabled={busy !== null}
            >
              {busy === 'export' ? 'Export…' : 'Enregistrer l’arbre en JSON…'}
            </button>
          </div>
          {backups.length === 0 ? (
            <p className="settings-note">Aucune archive pour l’instant.</p>
          ) : (
            <ul className="file-list">
              {backups.map((backup) => (
                <li key={backup.name}>
                  <span className="file-name">{archiveDate(backup)}</span>
                  <span className="file-meta">
                    {reason(backup.name)} · {size(backup.size)}
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => save(api.backupFileUrl(backup.name), backup.name, 'copy')}
                    disabled={busy !== null}
                  >
                    {busy === 'copy' && copyingName === backup.name
                      ? 'Copie…'
                      : 'Copier vers…'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="settings-note">
            Recharger une archive ne se commande pas ici : l’application ne peut pas remplacer la
            base sur laquelle elle est assise. Fermez-la (la fenêtre ouverte par{' '}
            <code>start.bat</code>), double-cliquez <code>restore.bat</code> dans ce dossier,
            choisissez le numéro de l’archive et tapez OUI. Ce qui était en place est copié avant
            d’être remplacé, donc le voyage a un retour.
          </p>
        </div>

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <span className="hint-key">Fermer avec Échap</span>
          <button type="button" className="primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
