import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TreeCanvas, { type TreeCanvasHandle } from './TreeCanvas';
import PersonSheet from './PersonSheet';
import AddPersonDialog from './AddPersonDialog';
import { api } from './api';
import { buildLayout } from './treeLayout';
import { fullName, lifeSpan } from './dates';
import type { BackupInfo, GraphData, PersonDetail, RelationInput } from '../shared/types';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<TreeCanvasHandle>(null);

  const load = useCallback(async () => {
    try {
      const [data, state] = await Promise.all([api.graph(), api.state()]);
      setGraph(data);
      setBackup(state.backup);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les données');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const handleSetRoot = useCallback(
    async (id: string) => {
      await api.setRoot(id);
      await load();
      setToast('Souche de l’arbre modifiée');
    },
    [load],
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
      if (!selectedId || dialog || pendingDelete || menu) return;
      event.preventDefault();
      setPendingDelete(selectedId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, dialog, pendingDelete, menu]);

  const openMenu = useCallback((personId: string, x: number, y: number) => {
    setMenu({
      personId,
      x: Math.min(x, window.innerWidth - 230),
      y: Math.min(y, window.innerHeight - 240),
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

        <span className="backup-note">{backupLabel(backup)}</span>
        <button type="button" className="ghost" onClick={runBackup} disabled={backupBusy}>
          {backupBusy ? 'Sauvegarde…' : 'Sauvegarder'}
        </button>

        <button type="button" className="primary" onClick={() => setDialog({ relation: null })}>
          Ajouter une personne
        </button>
      </header>

      {error && <div className="banner-error">{error}</div>}

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
                onSelect={selectPerson}
                onContextMenu={openMenu}
              />
            )}
            <PersonSheet
              personId={selectedId}
              refreshKey={refreshKey}
              onSelect={selectPerson}
              onAdd={(relation, anchorName) => setDialog({ relation, anchorName })}
              onEdit={(person) => setDialog({ relation: null, editing: person })}
              onClose={() => setSelectedId(null)}
              onSetRoot={handleSetRoot}
              onDelete={(id) => setPendingDelete(id)}
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
