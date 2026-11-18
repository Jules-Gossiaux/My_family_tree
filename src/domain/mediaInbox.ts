import type { FamilyData, Id, Media } from './types';
import { addMedia, insertMedia, updateMedia } from './directories';
import { mediaStore } from './mediaStore';

/** Limites d'une passe, conformes à l'ancienne application. */
export const MAX_FILES_PER_BATCH = 40;
export const MAX_FILE_BYTES = 60 * 1024 * 1024;

const ACCEPTED = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

export interface PreparedFile {
  file: File;
  fingerprint: string;
  kind: 'photo' | 'document';
  duplicateOf?: Media;
  error?: string;
}

export function isAcceptedFile(file: File): boolean {
  if (ACCEPTED.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return /\.(jpe?g|png|webp|gif|pdf)$/.test(name);
}

export async function fingerprintFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function prepareFiles(
  files: File[],
  data: FamilyData,
): Promise<PreparedFile[]> {
  const selected = files.slice(0, MAX_FILES_PER_BATCH);
  const result: PreparedFile[] = [];
  const byFingerprint = new Map<string, Media>();
  for (const medium of data.media) {
    if (medium.fingerprint) byFingerprint.set(medium.fingerprint, medium);
  }
  for (const file of selected) {
    if (!isAcceptedFile(file)) {
      result.push({
        file,
        fingerprint: '',
        kind: 'document',
        error: 'Format non accepté (JPEG, PNG, WebP, GIF ou PDF).',
      });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      result.push({
        file,
        fingerprint: '',
        kind: 'document',
        error: 'Fichier trop volumineux (60 Mo maximum).',
      });
      continue;
    }
    const fingerprint = await fingerprintFile(file);
    result.push({
      file,
      fingerprint,
      kind: file.type.startsWith('image/') ? 'photo' : 'document',
      duplicateOf: byFingerprint.get(fingerprint),
    });
  }
  return result;
}

export interface ImportOutcome {
  data: FamilyData;
  added: number;
  duplicates: number;
  errors: string[];
}

/**
 * Importe une passe : un doublon est réutilisé (le média existant reçoit une
 * liaison de plus), jamais dupliqué. Les fichiers invalides sont signalés.
 */
export async function importFiles(
  data: FamilyData,
  files: PreparedFile[],
  personIds: Id[] = [],
  eventId?: Id,
): Promise<ImportOutcome> {
  let next = data;
  let added = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const prepared of files) {
    if (prepared.error) {
      errors.push(`${prepared.file.name} : ${prepared.error}`);
      continue;
    }
    try {
      if (prepared.duplicateOf) {
        const existing = next.media.find((item) => item.id === prepared.duplicateOf!.id);
        if (existing) {
          const mergedPersonIds = Array.from(
            new Set([...existing.personIds, ...personIds]),
          );
          next = updateMedia(next, existing.id, { personIds: mergedPersonIds });
          if (eventId) {
            next = {
              ...next,
              events: next.events.map((event) =>
                event.id === eventId && !event.mediaIds.includes(existing.id)
                  ? { ...event, mediaIds: [...event.mediaIds, existing.id] }
                  : event,
              ),
            };
          }
          duplicates += 1;
          continue;
        }
      }
      const medium = addMedia(next, {
        kind: prepared.kind,
        fileName: prepared.file.name,
        mimeType: prepared.file.type || 'application/octet-stream',
        fingerprint: prepared.fingerprint,
        personIds,
      });
      await mediaStore.put(medium.key, prepared.file);
      next = insertMedia(next, medium);
      if (eventId) {
        next = {
          ...next,
          events: next.events.map((event) =>
            event.id === eventId
              ? { ...event, mediaIds: [...event.mediaIds, medium.id] }
              : event,
          ),
        };
      }
      added += 1;
    } catch {
      errors.push(`Impossible d’enregistrer « ${prepared.file.name} ».`);
    }
  }
  return { data: next, added, duplicates, errors };
}

/** Vignette réduite en mémoire, générée dans le navigateur. */
export function makeThumbnail(file: File, maxSize = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Pas une image.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas indisponible.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/jpeg', 0.7);
      URL.revokeObjectURL(url);
      resolve(result);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    image.src = url;
  });
}
