import { useEffect } from 'react';
import { MediaFrame, MediaImg } from './MediaView';
import { formatDate } from './dates';
import type { Media } from '../shared/types';

interface Props {
  items: Media[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Action propre à l'écran qui appelle le visionneuse, par exemple « définir comme portrait ». */
  children?: React.ReactNode;
}

/**
 * Le fichier entier, là où la grille ne montre qu'une vignette. Un document PDF s'affiche dans un
 * cadre : le navigateur sait le faire, l'application n'a rien à installer pour cela.
 */
export default function MediaLightbox({ items, index, onIndex, onClose, children }: Props) {
  const media = items[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // L'éditeur de légende vit dans la visionneuse : y taper une date au flèche ne doit pas
      // faire défiler les photos.
      const field = event.target as HTMLElement | null;
      const typing =
        field !== null &&
        (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.isContentEditable);
      if (event.key === 'Escape') onClose();
      if (typing) return;
      if (event.key === 'ArrowRight') onIndex(Math.min(items.length - 1, index + 1));
      if (event.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!media) return null;

  const isPdf = media.mime === 'application/pdf';

  return (
    <div className="lightbox" onMouseDown={onClose}>
      <div className="lightbox-frame" onMouseDown={(event) => event.stopPropagation()}>
        {isPdf ? (
          <MediaFrame media={media} className="lightbox-pdf" alt="Document" />
        ) : (
          <MediaImg media={media} part="original" className="lightbox-image" alt={media.caption ?? ''} />
        )}

        <figcaption className="lightbox-caption">
          <span className="lightbox-text">
            {media.caption || (media.kind === 'photo' ? 'Photo sans légende' : 'Document sans légende')}
            {media.date && <em className="lightbox-date"> · {formatDate(media.date)}</em>}
          </span>
          {media.persons.length > 0 && (
            <span className="lightbox-persons">
              {media.persons.map((person) => person.name).join(', ')}
            </span>
          )}
          {children}
        </figcaption>

        <div className="lightbox-nav">
          <button type="button" className="ghost" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0}>
            ←
          </button>
          <span className="lightbox-count">
            {index + 1} / {items.length}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => onIndex(Math.min(items.length - 1, index + 1))}
            disabled={index === items.length - 1}
          >
            →
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
