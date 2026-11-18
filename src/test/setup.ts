import { beforeAll } from 'vitest';

/** Node n'a pas FileReader : minimalisme pour les tests d'export/import. */
beforeAll(() => {
  if (typeof globalThis.FileReader === 'undefined') {
    class NodeFileReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(blob: Blob) {
        const reader = this;
        blob
          .arrayBuffer()
          .then((buffer) => {
            const mime = blob.type || 'application/octet-stream';
            const bytes = Array.from(new Uint8Array(buffer));
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            const base64 = btoa(binary);
            reader.result = `data:${mime};base64,${base64}`;
            reader.onload?.();
          })
          .catch(() => reader.onerror?.());
      }
    }
    (globalThis as unknown as { FileReader: unknown }).FileReader =
      NodeFileReader;
  }
});

/** localStorage en mémoire pour les tests de persistance. */
const store = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
};
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: { localStorage: typeof localStorageStub } }).window =
    { localStorage: localStorageStub };
}
