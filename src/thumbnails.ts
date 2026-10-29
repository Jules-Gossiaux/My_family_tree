import type { MediaKind } from '../shared/types';

/** Une vignette de 512 px se lit nettement et pèse quelques dizaines de kilo-octets. */
const THUMB_MAX = 512;

/** Ce que le navigateur sait décoder lui-même. Le reste entre sans aperçu, pas sans image. */
const DECODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface Prepared {
  width: number | null;
  height: number | null;
  thumb: Blob | null;
}

export function kindOf(file: File): MediaKind {
  return file.type === 'application/pdf' ? 'document' : 'photo';
}

/**
 * L'original n'est jamais retouché : le serveur reçoit l'octet tel quel et seul le fichier
 * vignette est produit ici. Un décodage qui échoue — format exotique, GIF animé, HEIC que
 * Chrome ne lit pas — laisse le média entrer quand même, sans aperçu, plutôt que de refuser
 * une photo sous prétexte qu'on ne sait pas la réduire.
 */
export async function prepareUpload(file: File): Promise<Prepared> {
  if (!DECODABLE.has(file.type)) return { width: null, height: null, thumb: null };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { width: null, height: null, thumb: null };
  }

  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return { width: bitmap.width, height: bitmap.height, thumb: null };
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    return { width: bitmap.width, height: bitmap.height, thumb };
  } finally {
    bitmap.close?.();
  }
}

/** L'année d'un fichier tel que le disque la connaît : la date du scan vaut mieux que rien. */
export function takenOf(file: File): string {
  if (!file.lastModified) return '';
  return new Date(file.lastModified).toISOString().slice(0, 10);
}
