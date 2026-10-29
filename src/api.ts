import type {
  AppState,
  BackupInfo,
  CreatePersonInput,
  GraphData,
  PersonDetail,
  RelationInput,
} from '../shared/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* réponse non JSON */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
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
  updatePerson: (id: string, input: Partial<CreatePersonInput> & { nickname?: string }) =>
    request<{ ok: true }>(`/api/persons/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
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
  setDataDir: (dataDir: string) =>
    request<DataDirResult>('/api/config/data-dir', {
      method: 'PUT',
      body: JSON.stringify({ dataDir }),
    }),
};

/** Le dossier choisi est écrit sur le disque ; l'ouverture réelle attend un redémarrage. */
export interface DataDirResult {
  ok: true;
  dataDir: string;
  restartNeeded: boolean;
  note: string;
}
