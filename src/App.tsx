import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TreeCanvas, { type TreeCanvasHandle } from './TreeCanvas';
import PersonSheet from './PersonSheet';
import AddPersonDialog from './AddPersonDialog';
import { api } from './api';
import { buildLayout } from './treeLayout';
import { fullName, lifeSpan } from './dates';
import type { GraphData, PersonDetail, RelationInput } from '../shared/types';

interface DialogState {
  relation: RelationInput | null;
  anchorName?: string;
  editing?: PersonDetail;
}

export default function App() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<TreeCanvasHandle>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.graph();
      setGraph(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les données');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const layout = useMemo(() => (graph ? buildLayout(graph) : null), [graph]);

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
    },
    [load],
  );

  const isEmpty = graph !== null && graph.persons.length === 0;

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
            {graph.couples.length > 0 && ` · ${graph.couples.length} union${graph.couples.length > 1 ? 's' : ''}`}
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

        <button
          type="button"
          className="primary"
          onClick={() => setDialog({ relation: null })}
        >
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
            <button
              type="button"
              className="primary"
              onClick={() => setDialog({ relation: null })}
            >
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
            />
          </>
        )}
      </main>

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
    </div>
  );
}
