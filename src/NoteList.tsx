import { useEffect, useState } from 'react';
import { api } from './api';
import type { NoteRow } from '../shared/types';

/** « 14 mars 2026 » : une note se relit depuis le moment où elle a été écrite, pas à la minute près. */
function writtenOn(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'date inconnue';
  return date.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface Props {
  /** Ce que la note commente : la fiche donne la personne, mais un fait ou un fichier se note pareil. */
  targetType: string;
  targetId: string;
  notes: NoteRow[];
  /** Une note écrite, corrigée ou effacée : la fiche repart de la même image. */
  onChanged: () => void;
}

/**
 * La marge de ce que l'on sait sans le dater. Une note n'est pas un fait — ni date, ni preuve — et pas
 * une source non plus : elle garde la phrase d'un cousin, une présomption, une piste à vérifier.
 */
export default function NoteList({ targetType, targetId, notes, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Changer de fiche emporte le brouillon : une note pensée pour Bernard n'a rien à faire ailleurs.
  useEffect(() => {
    setAdding(false);
    setEditingId(null);
    setConfirmId(null);
    setDraft('');
    setError(null);
  }, [targetId]);

  const open = (text: string) => {
    setError(null);
    setDraft(text);
  };

  const close = () => {
    setAdding(false);
    setEditingId(null);
    setDraft('');
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) await api.updateNote(editingId, draft);
      else await api.createNote({ targetType, targetId, body: draft });
      close();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La note n’a pas été enregistrée.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (note: NoteRow) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteNote(note.id);
      setConfirmId(null);
      if (editingId === note.id) close();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La note n’a pas été supprimée.');
    } finally {
      setBusy(false);
    }
  };

  const editor = (
    <div className="note-form">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="ce qu’un cousin a raconté, une présomption, une piste à vérifier…"
        rows={3}
        disabled={busy}
      />
      <div className="note-form-foot">
        <button type="button" className="ghost" onClick={close} disabled={busy}>
          Annuler
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void submit()}
          disabled={busy || !draft.trim()}
        >
          {busy ? 'Enregistrement…' : editingId ? 'Enregistrer' : 'Ajouter'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="notes">
      {notes.length === 0 && !adding && (
        <p className="hint">
          Rien écrit en marge pour l'instant. Une note dit ce que l'on sait sans pouvoir le dater ni le
          prouver : ce qu'un neveu raconte, une présomption, une piste à reprendre.
        </p>
      )}

      {notes.map((note) => (
        <article key={note.id} className={`note-row${editingId === note.id ? ' is-editing' : ''}`}>
          {editingId === note.id ? (
            editor
          ) : (
            <>
              <p className="note-body">{note.body}</p>
              <p className="note-meta">écrite le {writtenOn(note.createdAt)}</p>
              <div className="note-actions">
                {confirmId === note.id ? (
                  <>
                    <span className="life-ask">Supprimer cette note ?</span>
                    <button
                      type="button"
                      className="danger-solid"
                      onClick={() => void remove(note)}
                      disabled={busy}
                    >
                      Supprimer
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setConfirmId(null)}
                      disabled={busy}
                    >
                      Garder
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setAdding(false);
                        open(note.body);
                        setEditingId(note.id);
                      }}
                      disabled={busy}
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      className="link danger"
                      onClick={() => setConfirmId(note.id)}
                      disabled={busy}
                    >
                      Retirer cette note
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </article>
      ))}

      {adding && editor}

      {!adding && !editingId && (
        <div className="actions">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              open('');
              setAdding(true);
            }}
          >
            + Une note de plus
          </button>
        </div>
      )}
      {error && <p className="dialog-error">{error}</p>}
    </div>
  );
}
