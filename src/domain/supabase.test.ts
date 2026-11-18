import { describe, expect, it } from 'vitest';
import { migrateLocalMediaToCloud } from '../domain/supabase';
import type { MediaStore } from '../domain/mediaStore';
import { createMedia, emptyFamily } from '../domain/types';

function memoryStore(failKeys: string[] = []): MediaStore & {
  files: Map<string, Blob>;
} {
  const files = new Map<string, Blob>();
  return {
    files,
    async put(key, blob) {
      if (failKeys.includes(key)) throw new Error('Refusé par Storage');
      files.set(key, blob);
    },
    async get(key) {
      return files.get(key);
    },
    async delete(key) {
      files.delete(key);
    },
    async clear() {
      files.clear();
    },
  };
}

function medium(key: string) {
  return {
    ...createMedia('family-local', {
      kind: 'photo' as const,
      fileName: key,
      mimeType: 'image/jpeg',
    }),
    key,
  };
}

describe('passage au cloud', () => {
  it('copie les octets en conservant les clés du document', async () => {
    const source = memoryStore();
    const target = memoryStore();
    await source.put('family-local/media-1', new Blob(['abc']));
    const data = {
      ...emptyFamily(),
      media: [medium('family-local/media-1')],
    };
    const progress: Array<[number, number]> = [];

    const report = await migrateLocalMediaToCloud('family-cloud', data, {
      source,
      target,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(report).toEqual({
      total: 1,
      uploaded: 1,
      missing: [],
      failed: [],
    });
    expect(progress).toEqual([[1, 1]]);
    expect(await target.get('family-local/media-1')).toBeInstanceOf(Blob);
  });

  it('ignore les données déjà embarquées dans le JSON', async () => {
    const data = {
      ...emptyFamily(),
      media: [
        medium('data:image/png;base64,AAAA'),
        medium('https://exemple.fr/photo.jpg'),
      ],
    };
    const report = await migrateLocalMediaToCloud('family-cloud', data, {
      source: memoryStore(),
      target: memoryStore(),
    });
    expect(report.total).toBe(0);
    expect(report.uploaded).toBe(0);
  });

  it('signale sans bloquer les médias absents ou refusés', async () => {
    const source = memoryStore();
    await source.put('family-local/ok', new Blob(['ok']));
    await source.put('family-local/refuse', new Blob(['no']));
    const data = {
      ...emptyFamily(),
      media: [
        medium('family-local/ok'),
        medium('family-local/absent'),
        medium('family-local/refuse'),
      ],
    };

    const report = await migrateLocalMediaToCloud('family-cloud', data, {
      source,
      target: memoryStore(['family-local/refuse']),
    });

    expect(report.uploaded).toBe(1);
    expect(report.missing).toEqual(['family-local/absent']);
    expect(report.failed).toEqual(['family-local/refuse']);
  });
});
