import type {
  AppState,
  BackupInfo,
  Branch,
  BranchInput,
  CreatePersonInput,
  EventInput,
  EventRow,
  GraphData,
  Media,
  MediaKind,
  PersonDetail,
  RelationInput,
} from '../shared/types';

/** Un refus du serveur se dit en français ; une page HTML rendue à la place n'est pas un refus. */
async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* le serveur n'a pas rendu de JSON */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return unwrap(
    await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    }),
  );
}

/** Une photo entre par ses octets, sans entête JSON : mêmes mots d'erreur, autre transport. */
async function sendBinary<T>(path: string, method: string, body: BodyInit): Promise<T> {
  return unwrap(await fetch(path, { method, body }));
}

export const api = {
  graph: () => request<GraphData>('/api/graph'),
  state: () => request<AppState>('/api/state'),
  backup: () => request<BackupInfo>('/api/backup', { method: 'POST' }),
  backups: () => request<{ backups: BackupInfo[] }>('/api/backups'),
  /** Adresses des fichiers que l'on enregistre ailleurs que dans le dossier de données. */
  backupFileUrl: (name: string) => `/api/backups/file?name=${encodeURIComponent(name)}`,
  exportJsonUrl: '/api/export/json',
  person: (id: string) => request<PersonDetail>(`/api/persons/${id}`),
  createPerson: (input: CreatePersonInput) =>
    request<{ id: string }>('/api/persons', { method: 'POST', body: JSON.stringify(input) }),
  updatePerson: (
    id: string,
    input: Partial<CreatePersonInput> & { nickname?: string; branchId?: string | null },
  ) => request<{ ok: true }>(`/api/persons/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deletePerson: (id: string) => request<{ ok: true }>(`/api/persons/${id}`, { method: 'DELETE' }),
  attachRelation: (id: string, relation: RelationInput) =>
    request<{ ok: true }>(`/api/persons/${id}/relations`, {
      method: 'POST',
      body: JSON.stringify(relation),
    }),
  setRoot: (rootPersonId: string | null) =>
    request<{ ok: true }>('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ rootPersonId }),
    }),
  /** Qui vous êtes dans l'arbre — le réglage que « Me recentrer » retrouve. */
  setMe: (mePersonId: string | null) =>
    request<{ ok: true }>('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ mePersonId }),
    }),
  setDataDir: (dataDir: string) =>
    request<DataDirResult>('/api/config/data-dir', {
      method: 'PUT',
      body: JSON.stringify({ dataDir }),
    }),

  /** Une branche : un nom, une couleur, et la personne dont elle part. */
  createBranch: (input: BranchInput & { includeDescendants?: boolean }) =>
    request<{ branch: Branch }>('/api/branches', { method: 'POST', body: JSON.stringify(input) }),
  updateBranch: (id: string, input: BranchInput) =>
    request<{ branch: Branch }>(`/api/branches/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  /** Range la descendance d'une personne sous une branche ; dit combien de cases ont suivi. */
  branchDescendants: (id: string, rootPersonId?: string) =>
    request<{ assigned: number }>(`/api/branches/${id}/descendants`, {
      method: 'POST',
      body: JSON.stringify({ rootPersonId }),
    }),
  deleteBranch: (id: string) => request<{ ok: true }>(`/api/branches/${id}`, { method: 'DELETE' }),

  /** Un fait de la vie : il porte une personne ou une union, et se date en français libre. */
  createEvent: (input: EventInput) =>
    request<{ event: EventRow }>('/api/events', { method: 'POST', body: JSON.stringify(input) }),
  updateEvent: (id: string, input: EventInput) =>
    request<{ event: EventRow }>(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteEvent: (id: string) => request<{ ok: true }>(`/api/events/${id}`, { method: 'DELETE' }),

  /** Ce qui attend encore un visage. */
  unattachedMedia: () => request<{ media: Media[] }>('/api/media?state=a-relier'),
  uploadMedia: (
    file: File,
    meta: { kind: MediaKind; taken?: string | null; width?: number | null; height?: number | null },
  ) => {
    const query = new URLSearchParams({ kind: meta.kind, mime: file.type || 'application/octet-stream' });
    if (meta.taken) query.set('taken', meta.taken);
    if (meta.width) query.set('width', String(meta.width));
    if (meta.height) query.set('height', String(meta.height));
    return sendBinary<{ media: Media; deduped: boolean }>(`/api/media?${query}`, 'POST', file);
  },
  uploadThumbnail: (mediaId: string, blob: Blob) =>
    sendBinary<{ media: Media }>(`/api/media/${mediaId}/thumbnail`, 'PUT', blob),
  patchMedia: (
    id: string,
    patch: { caption?: string | null; kind?: MediaKind; documentType?: string | null; dateText?: string | null },
  ) => request<{ media: Media }>(`/api/media/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteMedia: (id: string) => request<{ ok: true }>(`/api/media/${id}`, { method: 'DELETE' }),
  attachMedia: (id: string, personIds: string[], role = 'sujet') =>
    request<{ media: Media }>(`/api/media/${id}/persons`, {
      method: 'POST',
      body: JSON.stringify({ personIds, role }),
    }),
  detachMedia: (mediaId: string, personId: string) =>
    request<{ media: Media }>(`/api/media/${mediaId}/persons/${personId}`, { method: 'DELETE' }),
  setPortrait: (personId: string, portraitMediaId: string | null) =>
    request<{ ok: true }>(`/api/persons/${personId}`, {
      method: 'PATCH',
      body: JSON.stringify({ portraitMediaId }),
    }),
  /** Une image ne se charge pas par l'API JSON : le navigateur la demande directement. */
  mediaUrl: (id: string, part: 'original' | 'thumb') =>
    `/api/media/${id}/${part === 'original' ? 'original' : 'thumbnail'}`,
};

/** Le dossier choisi est écrit sur le disque ; l'ouverture réelle attend un redémarrage. */
export interface DataDirResult {
  ok: true;
  dataDir: string;
  restartNeeded: boolean;
  note: string;
}
