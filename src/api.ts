import type { CreatePersonInput, GraphData, PersonDetail } from '../shared/types';

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
  person: (id: string) => request<PersonDetail>(`/api/persons/${id}`),
  createPerson: (input: CreatePersonInput) =>
    request<{ id: string }>('/api/persons', { method: 'POST', body: JSON.stringify(input) }),
  updatePerson: (id: string, input: Partial<CreatePersonInput> & { nickname?: string }) =>
    request<{ ok: true }>(`/api/persons/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deletePerson: (id: string) => request<{ ok: true }>(`/api/persons/${id}`, { method: 'DELETE' }),
  setRoot: (rootPersonId: string | null) =>
    request<{ ok: true }>('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ rootPersonId }),
    }),
};
