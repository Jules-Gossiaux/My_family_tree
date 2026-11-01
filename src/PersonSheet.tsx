import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from './api';
import LifeTimeline from './LifeTimeline';
import MediaEditor from './MediaEditor';
import MediaLightbox from './MediaLightbox';
import { kindOf, prepareUpload, takenOf } from './thumbnails';
import { formatDate, fullName, initials, lifeSpan } from './dates';
import type {
  Branch,
  Media,
  Person,
  PersonDetail,
  PlaceRow,
  RelationInput,
  SourceRow,
} from '../shared/types';

interface Props {
  personId: string | null;
  refreshKey: number;
  branches: Branch[];
  /** Les lieux connus de la base, proposés pendant la saisie d'un fait. */
  places: PlaceRow[];
  /** Les sources déclarées dans Réglages, qu'un fait peut citer. */
  sources: SourceRow[];
  onSelect: (personId: string) => void;
  onAdd: (relation: RelationInput, anchorName: string) => void;
  onAttach: (personId: string) => void;
  onEdit: (person: PersonDetail) => void;
  onClose: () => void;
  onSetRoot: (personId: string) => void;
  onDelete: (personId: string) => void;
  onCreateBranch: (personId: string) => void;
  /** Un fait de la vie, une branche ou un média a bougé : l'arbre, les compteurs et la fiche repartent de la même image. */
  onChanged: () => void;
}

function RelationRow({ person, onSelect }: { person: Person; onSelect: (id: string) => void }) {
  return (
    <button type="button" className="rel-row" onClick={() => onSelect(person.id)}>
      <span className="rel-avatar">{initials(person)}</span>
      <span className="rel-main">
        <span className="rel-name">{fullName(person)}</span>
        <span className="rel-dates">{lifeSpan(person)}</span>
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      {children}
    </section>
  );
}

/** Autant de fichiers qu'on en accepte dans le bac : au-delà, la page n'est plus une page. */
const MAX_PER_GO = 40;

export default function PersonSheet({
  personId,
  refreshKey,
  branches,
  places,
  sources,
  onSelect,
  onAdd,
  onAttach,
  onEdit,
  onClose,
  onSetRoot,
  onDelete,
  onCreateBranch,
  onChanged,
}: Props) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!personId) {
      setPerson(null);
      return;
    }
    let cancelled = false;
    api
      .person(personId)
      .then((data) => {
        if (!cancelled) setPerson(data);
      })
      .catch(() => {
        if (!cancelled) setPerson(null);
      });
    return () => {
      cancelled = true;
    };
  }, [personId, refreshKey]);

  useEffect(() => {
    setViewer(null);
    setNotice(null);
    setMediaError(null);
  }, [personId]);

  /**
   * Une photo importée d'ici porte immédiatement le nom de la personne ouverte : c'est le geste
   * le plus court, et le seul qui évite de ressortir le bac d'entrée pour un seul cliché.
   */
  const importFiles = async (files: File[]) => {
    const batch = files.slice(0, MAX_PER_GO);
    if (!batch.length || !personId || uploading) return;
    setUploading(true);
    setMediaError(null);
    setNotice(null);
    if (files.length > batch.length) {
      setMediaError(`${files.length} fichiers : on n'en traite que ${batch.length} à la fois.`);
    }
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    for (const file of batch) {
      try {
        const prepared = await prepareUpload(file);
        const { media, deduped } = await api.uploadMedia(file, {
          kind: kindOf(file),
          taken: takenOf(file) || null,
          width: prepared.width,
          height: prepared.height,
        });
        // Un doublon est déjà dans le dossier avec sa vignette : rien de plus à écrire.
        if (!deduped && prepared.thumb) await api.uploadThumbnail(media.id, prepared.thumb);
        await api.attachMedia(media.id, [personId]);
        if (deduped) duplicates += 1;
        else imported += 1;
      } catch (err) {
        failed += 1;
        setMediaError(err instanceof Error ? err.message : 'Import impossible.');
      }
    }
    const parts: string[] = [];
    if (imported) parts.push(`${imported} fichier${imported > 1 ? 's' : ''} ajouté${imported > 1 ? 's' : ''}`);
    if (duplicates) parts.push(`${duplicates} déjà dans le dossier`);
    if (failed) parts.push(`${failed} refusé${failed > 1 ? 's' : ''}`);
    setNotice(parts.length ? `${parts.join(', ')}.` : null);
    setUploading(false);
    onChanged();
  };

  /**
   * Ranger une personne sous une branche — ou la rendre au hors-classe. Une seule teinte par case :
   * la base ne garde qu'une branche par personne, l'arbre n'a donc rien à arbitrer.
   */
  const assignBranch = async (branchId: string | null) => {
    if (!personId || branchBusy) return;
    setBranchBusy(true);
    setBranchError(null);
    try {
      await api.updatePerson(personId, { branchId });
      onChanged();
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : 'La branche n’a pas pu être réglée.');
    } finally {
      setBranchBusy(false);
    }
  };

  const makePortrait = async (media: Media) => {
    if (!personId) return;
    setMediaError(null);
    try {
      await api.setPortrait(personId, media.id);
      onChanged();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Le portrait n’a pas pu être réglé.');
    }
  };

  const removePortrait = async () => {
    if (!personId) return;
    setMediaError(null);
    try {
      await api.setPortrait(personId, null);
      onChanged();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Le portrait n’a pas pu être retiré.');
    }
  };

  const detachFromSheet = async (media: Media) => {
    if (!personId) return;
    setMediaError(null);
    try {
      await api.detachMedia(media.id, personId);
      setViewer(null);
      onChanged();
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Le média n’a pas pu être détaché.');
    }
  };

  if (!personId) {
    return (
      <aside className="sheet sheet-empty">
        <p className="hint">
          Cliquez sur une personne dans l'arbre pour ouvrir son dossier de vie.
        </p>
      </aside>
    );
  }

  if (!person) {
    return <aside className="sheet" />;
  }

  const name = fullName(person);
  const span = lifeSpan(person);

  const portrait = person.media.find((one) => one.id === person.portraitMediaId);
  const portraitPart: 'thumb' | 'original' | null = portrait?.hasThumb
    ? 'thumb'
    : portrait?.mime?.startsWith('image/')
      ? 'original'
      : null;
  const portraitUrl = portrait && portraitPart ? api.mediaUrl(portrait.id, portraitPart) : null;
  const viewedIndex = viewer === null ? -1 : person.media.findIndex((one) => one.id === viewer);
  const viewed = viewedIndex >= 0 ? person.media[viewedIndex] : null;
  const branch = branches.find((one) => one.id === person.branchId) ?? null;

  return (
    <aside className="sheet">
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>

      <header className="sheet-header">
        <div className="avatar">
          {portraitUrl ? (
            <img className="avatar-img" src={portraitUrl} alt="" />
          ) : (
            initials(person)
          )}
        </div>
        <div className="sheet-id">
          <h2 className="sheet-name">{name}</h2>
          {person.birthName && <p className="sheet-nick">née {person.birthName}</p>}
          {person.nicknames.length > 0 && (
            <p className="sheet-nick">« {person.nicknames.join(' », « ')} »</p>
          )}
          <p className="sheet-dates">
            {span || 'dates inconnues'}
            {!person.living && <span className="tag-dead">décédé</span>}
          </p>
        </div>
      </header>

      <div className="actions">
        <button type="button" onClick={() => onAdd({ type: 'child', ofPersonId: person.id }, name)}>
          + Enfant
        </button>
        <button
          type="button"
          onClick={() => onAdd({ type: 'partner', ofPersonId: person.id }, name)}
        >
          + Conjoint
        </button>
        <button type="button" onClick={() => onAdd({ type: 'parent', ofPersonId: person.id }, name)}>
          + Parent
        </button>
        <button type="button" onClick={() => onAttach(person.id)}>
          Rattacher…
        </button>
        <button type="button" className="ghost" onClick={() => onEdit(person)}>
          Modifier
        </button>
      </div>

      <Section title="Branche">
        <div className="branch-row">
          <span
            className="branch-dot"
            style={{ '--branch': branch?.color ?? 'var(--line-2)' } as CSSProperties}
          />
          <select
            value={person.branchId ?? ''}
            onChange={(event) => void assignBranch(event.target.value || null)}
            disabled={branchBusy}
          >
            <option value="">Sans branche</option>
            {branches.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost"
            onClick={() => onCreateBranch(person.id)}
            disabled={branchBusy}
            title="Créer une branche qui part de cette personne et range ses descendants"
          >
            Nouvelle branche…
          </button>
        </div>
        <p className="settings-note">
          {branch
            ? `${branch.name} range ${branch.personCount} personne${branch.personCount > 1 ? 's' : ''} de la même couleur. Le nom et la teinte se changent dans Réglages.`
            : 'Aucune branche ici : les cases restent sans teinte. « Nouvelle branche… » en part de cette personne et y range toute sa descendance.'}
        </p>
        {branchError && <p className="dialog-error">{branchError}</p>}
      </Section>

      <Section
        title={person.events.length > 0 ? `Vie (${person.events.length})` : 'Vie'}
      >
        <LifeTimeline
          personId={person.id}
          events={person.events}
          places={places}
          sources={sources}
          onChanged={onChanged}
        />
      </Section>

      <Section title={person.media.length > 0 ? `Photos et documents (${person.media.length})` : 'Photos et documents'}>
        <div
          className={`media-drop${dragging ? ' is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void importFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="actions">
            <button
              type="button"
              className="ghost"
              onClick={() => input.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Import en cours…' : 'Ajouter des fichiers…'}
            </button>
            <input
              ref={input}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              onChange={(event) => {
                void importFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </div>

          {person.media.length === 0 ? (
            <p className="hint">
              Rien ici pour l'instant. Glissez une photo sur cette fiche, ou passez par le bac
              d'entrée pour rattacher un lot déjà importé.
            </p>
          ) : (
            <div className="media-grid">
              {person.media.map((media) => (
                <button
                  key={media.id}
                  type="button"
                  className={`media-tile${media.id === person.portraitMediaId ? ' is-portrait' : ''}`}
                  onClick={() => setViewer(media.id)}
                  title={media.caption || (media.kind === 'photo' ? 'Photo' : 'Document')}
                >
                  {media.hasThumb ? (
                    <img src={api.mediaUrl(media.id, 'thumb')} alt="" loading="lazy" />
                  ) : (
                    <span className="media-placeholder">
                      {media.kind === 'document' ? 'document' : 'sans aperçu'}
                    </span>
                  )}
                  <span className="media-flag">
                    {media.id === person.portraitMediaId
                      ? 'portrait'
                      : media.caption || formatDate(media.date) || 'sans légende'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {notice && <p className="settings-note">{notice}</p>}
          {mediaError && <p className="dialog-error">{mediaError}</p>}
        </div>
      </Section>

      {person.parents.length > 0 && (
        <Section title={person.parents.length > 1 ? 'Parents' : 'Parent'}>
          {person.parents.map((p) => (
            <RelationRow key={p.id} person={p} onSelect={onSelect} />
          ))}
        </Section>
      )}

      {person.partners.length > 0 && (
        <Section title={person.partners.length > 1 ? 'Unions' : 'Union'}>
          {person.partners.map((p) => (
            <RelationRow key={p.id} person={p} onSelect={onSelect} />
          ))}
        </Section>
      )}

      {person.siblings.length > 0 && (
        <Section title="Fratrie">
          {person.siblings.map((p) => (
            <RelationRow key={p.id} person={p} onSelect={onSelect} />
          ))}
        </Section>
      )}

      {person.children.length > 0 && (
        <Section title={person.children.length > 1 ? 'Enfants' : 'Enfant'}>
          {person.children.map((p) => (
            <RelationRow key={p.id} person={p} onSelect={onSelect} />
          ))}
        </Section>
      )}

      <footer className="sheet-footer">
        <button type="button" className="link" onClick={() => onSetRoot(person.id)}>
          Faire de cette personne la souche de l'arbre
        </button>
        <button
          type="button"
          className="link danger"
          onClick={() => onDelete(person.id)}
          title="Supprimer (touche Suppr)"
        >
          Supprimer cette personne
        </button>
      </footer>

      {viewed && (
        <MediaLightbox
          items={person.media}
          index={viewedIndex}
          onIndex={(index) => setViewer(person.media[index]?.id ?? null)}
          onClose={() => setViewer(null)}
        >
          <span className="lightbox-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void makePortrait(viewed)}
              disabled={viewed.id === person.portraitMediaId}
            >
              Faire le portrait
            </button>
            {viewed.id === person.portraitMediaId && (
              <button type="button" className="ghost" onClick={() => void removePortrait()}>
                Retirer le portrait
              </button>
            )}
            <button type="button" className="ghost" onClick={() => void detachFromSheet(viewed)}>
              Retirer de ce dossier
            </button>
          </span>
          <MediaEditor media={viewed} onSaved={onChanged} />
        </MediaLightbox>
      )}
    </aside>
  );
}
