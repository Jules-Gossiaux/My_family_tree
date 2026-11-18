import { useEffect, useState } from 'react';
import { mediaUrl } from './api';
import type { Media } from '../shared/types';

type Part = 'original' | 'thumb';

/**
 * L'adresse signée d'un fichier du coffre privé. Le seau n'est pas public : le navigateur demande
 * une permission temporaire, et la règle de ligne qui garde `storage.objects` décide si elle est
 * accordée. Une galerie déjà signée ne signe pas deux fois, la mémoire est tenue dans `api.ts`.
 */
export function useMediaSrc(media: Media | null | undefined, part: Part | null): string | null {
  const cle = media ? (part === 'original' ? media.key : media.thumbKey) : null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!media || !part || !cle) {
      setUrl(null);
      return;
    }
    let vivant = true;
    setUrl(null);
    mediaUrl(media, part)
      .then((adresse) => {
        if (vivant) setUrl(adresse);
      })
      .catch(() => {
        if (vivant) setUrl(null);
      });
    return () => {
      vivant = false;
    };
  }, [cle, part, media]);

  return url;
}

interface VueProps {
  media: Media | null | undefined;
  part: Part;
  className?: string;
  alt?: string;
  /** Ce que l'on montre en attendant l'adresse — ou quand le fichier n'existe pas. */
  fallback?: React.ReactNode;
}

/** Une image du coffre, là où le chemin local ne veut plus rien dire. */
export function MediaImg({ media, part, className, alt = '', fallback }: VueProps) {
  const src = useMediaSrc(media, media ? part : null);
  if (!src) return <>{fallback ?? null}</>;
  return <img className={className} src={src} alt={alt} loading="lazy" />;
}

/** Un document PDF du coffre, ouvert par le navigateur lui-même. */
export function MediaFrame({ media, className, alt = '' }: { media: Media; className?: string; alt?: string }) {
  const src = useMediaSrc(media, 'original');
  if (!src) return null;
  return <iframe className={className} src={src} title={alt} />;
}
