import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TreeCanvas, { type TreeCanvasHandle } from './TreeCanvas';
import PersonSheet from './PersonSheet';
import AddPersonDialog from './AddPersonDialog';
import AttachDialog from './AttachDialog';
import MediaInbox from './MediaInbox';
import SettingsDialog from './SettingsDialog';
import { api } from './api';
import { signOut, useMember } from './session';
import { buildLayout } from './treeLayout';
import { fullName, lifeSpan } from './dates';
import type {
  BackupInfo,
  GraphData,
  Person,
  PersonDetail,
  PlaceRow,
  RelationInput,
  SourceRow,
} from '../shared/types';

interface DialogState {
  relation: RelationInput | null;
  anchorName?: string;
  editing?: PersonDetail;
}

interface MenuState {
  personId: string;
  x: number;
  y: number;
}

function backupLabel(backup: BackupInfo | null): string {
  if (!backup) return 'aucune sauvegarde';
  const date = new Date(backup.createdAt);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `sauvegardé à ${time}` : `sauvegardé le ${date.toLocaleDateString('fr-BE')}`;
}

export default function App() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [attach, setAttach] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [dataDir, setDataDir] = useState('');
  const [dataDirFromEnv, setDataDirFromEnv] = useState(false);
  const [onServer, setOnServer] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [inbox, setInbox] = useState(false);
  const [unattached, setUnattached] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const canvas = useRef<TreeCanvasHandle>(null);
  const member = useMember();

  const load = useCallback(async () => {
    try {
      const [data, state, knownPlaces, knownSources] = await Promise.all([
        api.graph(),
        api.state(),
        api.places(),
        api.sources(),
      ]);
      setGraph(data);
      setPlaces(knownPlaces.places);
      setSources(knownSources.sources);
      setBackup(state.backup);
      setMeId(state.mePersonId);
      setWarnings(state.warnings ?? []);
      setUnattached(state.counts.mediaUnattached);
      setDataDir(state.dataDir);
      setDataDirFromEnv(state.dataDirFromEnv);
      setOnServer(state.onServer);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les données');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Une sauvegarde qui échoue trente minutes après le chargement de la page doit être dite à
  // l'écran : sans cette respiration, l'application afficherait « tout va bien » jusqu'au bout.
  useEffect(() => {
    const poll = async () => {
      try {
        const state = await api.state();
        setBackup(state.backup);
        setWarnings(state.warnings ?? []);
        setUnattached(state.counts.mediaUnattached);
      } catch {
        /* le serveur se ferme peut-être : le prochain clic le dira */
      }
    };
    const timer = window.setInterval(() => void poll(), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const layout = useMemo(() => (graph ? buildLayout(graph) : null), [graph]);

  const personById = useMemo(
    () => new Map((graph?.persons ?? []).map((person) => [person.id, person])),
    [graph],
  );

  const results = useMemo(() => {
    if (!graph || !query.trim()) return [];
    const needle = query.trim().toLowerCase();
    return graph.persons
      .filter((p) =>
        `${p.givenNames} ${p.familyName} ${p.birthName ?? ''}`.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [graph, query]);

  const selectPerson = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const focusAndSelect = useCallback((id: string) => {
    setSelectedId(id);
    canvas.current?.focusPerson(id);
  }, []);

  const handleSaved = useCallback(
    async (id: string) => {
      setDialog(null);
      await load();
      setSelectedId(id);
      setRefreshKey((key) => key + 1);
      window.setTimeout(() => canvas.current?.focusPerson(id), 60);
    },
    [load],
  );

  /**
   * Les personnes qui peuvent devenir le second parent de la nouvelle fiche. On ne les
   * propose que si l'union existe déjà ailleurs dans l'arbre : rien n'est jamais deviné.
   */
  const otherParentCandidates = useMemo<Person[]>(() => {
    if (!graph || !dialog?.relation || dialog.editing) return [];
    const { type, ofPersonId } = dialog.relation;
    if (type === 'partner') return [];

    if (type === 'child') {
      return graph.couples
        .map((couple) =>
          couple.partnerA === ofPersonId
            ? personById.get(couple.partnerB ?? '')
            : couple.partnerB === ofPersonId
              ? personById.get(couple.partnerA ?? '')
              : undefined,
        )
        .filter((person): person is Person => Boolean(person));
    }

    const parents = graph.parentChild
      .filter((link) => link.childId === ofPersonId)
      .map((link) => link.parentId);
    return graph.persons.filter((person) => parents.includes(person.id));
  }, [graph, dialog, personById]);

  const handleAttached = useCallback(
    async (id: string) => {
      setAttach(null);
      await load();
      setSelectedId(id);
      setRefreshKey((key) => key + 1);
      setToast('Lien ajouté à l’arbre');
      window.setTimeout(() => canvas.current?.focusPerson(id), 60);
    },
    [load],
  );

  /** Le graphe et la fiche ouverte doivent reprendre la même image après un changement de branche. */
  const reloadTree = useCallback(() => {
    setRefreshKey((key) => key + 1);
    return load();
  }, [load]);

  /**
   * Une branche neuve part de la personne visée et range toute sa descendance : c'est le geste qui
   * donne une ligne lisible en un clic. Le nom se corrige ensuite dans Réglages, comme la couleur.
   */
  const createBranchHere = useCallback(
    async (personId: string) => {
      const person = personById.get(personId);
      if (!person) return;
      const name = `Branche ${fullName(person)}`.trim();
      try {
        const { branch } = await api.createBranch({ name, rootPersonId: personId });
        await reloadTree();
        setToast(
          `${branch.name} créée — ${branch.personCount} case${branch.personCount > 1 ? 's' : ''} rangée${branch.personCount > 1 ? 's' : ''}. ` +
            'Son nom et sa couleur se règlent dans Réglages.',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'La branche n’a pas pu être créée');
      }
    },
    [personById, reloadTree],
  );

  const handleSetRoot = useCallback(
    async (id: string | null) => {
      await api.setRoot(id);
      await load();
      setToast(id ? 'Souche de l’arbre modifiée' : 'Plus de souche : l’arbre part de ses aïeux');
    },
    [load],
  );

  /**
   * « Moi » n'est pas la souche : la souche dit d'où l'on part, « moi » dit qui l'on est. Les deux
   * se règlent séparément, et le recentrage ne demande jamais de refaire le tour de l'arbre.
   */
  const handleSetMe = useCallback(
    async (id: string) => {
      const next: string | null = id === '' ? null : id;
      try {
        await api.setMe(next);
        setMeId(next);
        const who = next ? personById.get(next) : null;
        setToast(
          who
            ? `Vous êtes ${fullName(who)} — « Me recentrer » vous retrouve`
            : 'Plus personne désignée comme « moi » — la pastille se met en veille',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'La personne « moi » n’a pas pu être réglée');
      }
    },
    [personById],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const name = personById.get(pendingDelete);
    try {
      await api.deletePerson(pendingDelete);
      setPendingDelete(null);
      setSelectedId(null);
      setMenu(null);
      await load();
      setToast(name ? `${fullName(name)} supprimé` : 'Personne supprimée');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
      setPendingDelete(null);
    }
  }, [pendingDelete, personById, load]);

  const runBackup = useCallback(async () => {
    setBackupBusy(true);
    try {
      const info = await api.backup();
      setBackup(info);
      setToast('Sauvegarde créée');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sauvegarde impossible');
    } finally {
      setBackupBusy(false);
    }
  }, []);

  // Touche Suppr : supprime la personne sélectionnée, sauf si l'on est en train de saisir.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      ) {
        return;
      }
      if (!selectedId || dialog || pendingDelete || menu || attach || settings || inbox) return;
      event.preventDefault();
      setPendingDelete(selectedId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, dialog, pendingDelete, menu, attach, settings, inbox]);

  const openMenu = useCallback((personId: string, x: number, y: number) => {
    setMenu({
      personId,
      x: Math.min(x, window.innerWidth - 230),
      y: Math.min(y, window.innerHeight - 300),
    });
  }, []);

  const isEmpty = graph !== null && graph.persons.length === 0;
  const menuPerson = menu ? personById.get(menu.personId) : null;
  const deletePerson = pendingDelete ? personById.get(pendingDelete) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Arbre de famille</span>
        </div>

        {graph && (
          <span className="counts">
            {graph.persons.length} personne{graph.persons.length > 1 ? 's' : ''}
            {graph.couples.length > 0 &&
              ` · ${graph.couples.length} union${graph.couples.length > 1 ? 's' : ''}`}
          </span>
        )}

        <div className="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une personne"
            autoComplete="off"
          />
          {results.length > 0 && (
            <ul className="search-results">
              {results.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      focusAndSelect(person.id);
                    }}
                  >
                    <span className="result-name">{fullName(person)}</span>
                    <span className="result-dates">{lifeSpan(person)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {onServer ? (
          <span className="backup-note">enregistré à chaque modification</span>
        ) : (
          <>
            <span className="backup-note">{backupLabel(backup)}</span>
            <button type="button" className="ghost" onClick={runBackup} disabled={backupBusy}>
              {backupBusy ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
          </>
        )}

        <button
          type="button"
          className="ghost"
          onClick={() => setInbox(true)}
          title="Photos et documents en attente de rattachement"
        >
          Photos
          {unattached > 0 && <span className="badge">{unattached}</span>}
        </button>

        <button
          type="button"
          className="ghost"
          onClick={() => setSettings(true)}
          title={
            onServer
              ? 'Où vit l’arbre, sa souche, ses branches, lieux et sources'
              : 'Dossier de données, souche de l’arbre, copies et export'
          }
        >
          Réglages
        </button>

        {member && (
          <>
            <span
              className="who"
              title={member.canWrite ? 'Cette adresse peut modifier l’arbre' : 'Cette adresse lit l’arbre sans le modifier'}
            >
              {member.email}
            </span>
            <button
              type="button"
              className="ghost"
              onClick={() => void signOut()}
              title={`Quitter la session de ${member.email}`}
            >
              Quitter
            </button>
          </>
        )}

        <button type="button" className="primary" onClick={() => setDialog({ relation: null })}>
          Ajouter une personne
        </button>
      </header>

      {error && <div className="banner-error">{error}</div>}

      {warnings.length > 0 && !error && (
        <div className="banner-warn">
          {warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}

      <main className="main">
        {isEmpty ? (
          <div className="empty">
            <h1>L'arbre commence ici</h1>
            <p>
              Ajoutez la première personne — vous-même, ou le plus ancien ancêtre dont vous
              connaissez le nom. Toutes les branches viendront s'y rattacher.
            </p>
            <button type="button" className="primary" onClick={() => setDialog({ relation: null })}>
              Ajouter la première personne
            </button>
          </div>
        ) : (
          <>
            {layout && (
              <TreeCanvas
                ref={canvas}
                layout={layout}
                selectedId={selectedId}
                branches={graph?.branches ?? []}
                mePersonId={meId}
                onSelect={selectPerson}
                onContextMenu={openMenu}
              />
            )}
            <PersonSheet
              personId={selectedId}
              refreshKey={refreshKey}
              branches={graph?.branches ?? []}
              places={places}
              sources={sources}
              onSelect={selectPerson}
              onAdd={(relation, anchorName) => setDialog({ relation, anchorName })}
              onAttach={(personId) => setAttach(personId)}
              onEdit={(person) => setDialog({ relation: null, editing: person })}
              onClose={() => setSelectedId(null)}
              onSetRoot={handleSetRoot}
              onDelete={(id) => setPendingDelete(id)}
              onCreateBranch={(personId) => void createBranchHere(personId)}
              onChanged={reloadTree}
            />
          </>
        )}
      </main>

      {menu && (
        <>
          <div
            className="menu-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" onClick={() => { setSelectedId(menu.personId); setMenu(null); }}>
              Ouvrir la fiche
            </button>
            <button
              type="button"
              onClick={() => {
                setDialog({
                  relation: { type: 'child', ofPersonId: menu.personId },
                  anchorName: menuPerson ? fullName(menuPerson) : undefined,
                });
                setMenu(null);
              }}
            >
              Ajouter un enfant
            </button>
            <button
              type="button"
              onClick={() => {
                setDialog({
                  relation: { type: 'partner', ofPersonId: menu.personId },
                  anchorName: menuPerson ? fullName(menuPerson) : undefined,
                });
                setMenu(null);
              }}
            >
              Ajouter un conjoint
            </button>
            <button type="button" onClick={() => { void handleSetRoot(menu.personId); setMenu(null); }}>
              Faire la souche de l'arbre
            </button>
            <button
              type="button"
              onClick={() => { void handleSetMe(menu.personId); setMenu(null); }}
              title="La personne que vous êtes dans l'arbre : « Me recentrer » vous ramènera dessus"
            >
              C’est moi
            </button>
            <button
              type="button"
              onClick={() => {
                void createBranchHere(menu.personId);
                setMenu(null);
              }}
            >
              Créer une branche ici
            </button>
            <button
              type="button"
              onClick={() => {
                setAttach(menu.personId);
                setMenu(null);
              }}
            >
              Rattacher à une personne…
            </button>
            <div className="menu-sep" />
            <button
              type="button"
              className="danger"
              onClick={() => {
                setPendingDelete(menu.personId);
                setMenu(null);
              }}
            >
              Supprimer
            </button>
          </div>
        </>
      )}

      {pendingDelete && (
        <div className="overlay" onMouseDown={() => setPendingDelete(null)}>
          <div className="dialog dialog-small" onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="dialog-title">Supprimer cette personne ?</h2>
            <p className="dialog-text">
              {deletePerson ? (
                <>
                  <strong>{fullName(deletePerson)}</strong> sera retiré de l'arbre, avec ses liens
                  de parenté. Ses photos et ses notes restent dans la base.
                </>
              ) : (
                'Cette personne sera retirée de l’arbre.'
              )}
            </p>
            <div className="dialog-actions">
              <span className="hint-key">Action irréversible</span>
              <button type="button" className="ghost" onClick={() => setPendingDelete(null)}>
                Annuler
              </button>
              <button type="button" className="danger-solid" onClick={confirmDelete}>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <AddPersonDialog
          relation={dialog.relation}
          anchorName={dialog.anchorName}
          otherParentCandidates={otherParentCandidates}
          editing={
            dialog.editing
              ? {
                  id: dialog.editing.id,
                  givenNames: dialog.editing.givenNames,
                  familyName: dialog.editing.familyName,
                  birthName: dialog.editing.birthName,
                  sex: dialog.editing.sex,
                  living: dialog.editing.living,
                  birthText: dialog.editing.birth?.text ?? '',
                  deathText: dialog.editing.death?.text ?? '',
                  nickname: dialog.editing.nicknames[0] ?? '',
                }
              : null
          }
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}

      {attach && personById.get(attach) && (
        <AttachDialog
          person={personById.get(attach) as Person}
          candidates={(graph?.persons ?? []).filter((other) => other.id !== attach)}
          onClose={() => setAttach(null)}
          onAttached={handleAttached}
        />
      )}

      {settings && (
        <SettingsDialog
          dataDir={dataDir}
          dataDirFromEnv={dataDirFromEnv}
          onServer={onServer}
          rootPersonId={graph?.rootId ?? null}
          mePersonId={meId}
          persons={graph?.persons ?? []}
          branches={graph?.branches ?? []}
          places={places}
          sources={sources}
          onClose={() => setSettings(false)}
          onRootChange={handleSetRoot}
          onMeChange={handleSetMe}
          onChanged={reloadTree}
          onBackup={setBackup}
          onToast={setToast}
        />
      )}

      {inbox && (
        <MediaInbox
          persons={graph?.persons ?? []}
          onClose={() => setInbox(false)}
          onChanged={reloadTree}
          onToast={setToast}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
