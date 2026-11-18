/**
 * Stockage des octets, séparé du document JSON.
 *
 * Localement : IndexedDB, clé = `${familyId}/${mediaId}` — exactement le chemin
 * qu'aura l'objet dans le bucket Supabase `family-media`. Pour passer au cloud,
 * il suffira de remplacer cette implémentation par une facade Storage ; le
 * modèle de données, les identifiants et l'UI restent inchangés.
 */

export interface MediaStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | undefined>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'simple-family-tree-media';
const STORE_NAME = 'files';
const DB_VERSION = 1;

const memory = new Map<string, Blob>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDatabase();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      tx.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const mediaStore: MediaStore = {
  async put(key, blob) {
    memory.set(key, blob);
    const result = await transaction('readwrite', (store) => store.put(blob, key));
    if (result === undefined && typeof indexedDB !== 'undefined') {
      // IndexedDB indisponible : le fallback mémoire reste utilisable.
      console.warn('Média conservé en mémoire uniquement :', key);
    }
  },
  async get(key) {
    const result = await transaction<Blob>('readonly', (store) => store.get(key));
    return result ?? memory.get(key);
  },
  async delete(key) {
    memory.delete(key);
    await transaction('readwrite', (store) => store.delete(key));
  },
  async clear() {
    memory.clear();
    await transaction('readwrite', (store) => store.clear());
  },
};

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',');
  if (!header || !payload) throw new Error('Donnée de fichier invalide.');
  const mime = header.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  if (header.includes(';base64')) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}
