import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emptyFamily, type FamilyData, type Id } from './types';
import { validateFamilyData } from './repository';
import type {
  BackupSummary,
  FamilyRepository,
  RepositoryEvents,
} from './repository';
import { localMediaStore, type MediaStore } from './mediaStore';

/**
 * Pont Supabase. Le client n'est créé que si les deux variables publiques sont
 * présentes ; sans elles, l'application reste en local. Aucune clé secrète ne
 * doit jamais apparaître ici : seule la clé anon, destinée au navigateur.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

export interface CloudFamily {
  id: Id;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
}

export function isOnlineMode(): boolean {
  return supabase !== null;
}

export async function currentUser(): Promise<{ id: Id; email: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? '',
  };
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signUp(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function listFamilies(): Promise<CloudFamily[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('family_members')
    .select('role, families(id, name)');
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((entry) => {
    const family = entry.families as unknown as { id: string; name: string } | null;
    if (!family) return [];
    return [{
      id: family.id,
      name: family.name,
      role: (entry.role as CloudFamily['role']) ?? 'viewer',
    }];
  });
}

export async function createFamily(name: string): Promise<Id> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data, error } = await supabase.rpc('create_family', { family_name: name });
  if (error) throw new Error(error.message);
  return data as Id;
}

export async function acceptInvitation(token: string): Promise<Id> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data, error } = await supabase.rpc('accept_invitation', {
    invite_token: token.trim(),
  });
  if (error) throw new Error(error.message);
  return data as Id;
}

/** Un admin génère un jeton d'accès à son arbre ; n'importe quel compte peut ensuite l'utiliser. */
export async function createInvitation(
  familyId: Id,
  role: 'admin' | 'editor' | 'viewer' = 'viewer',
): Promise<string> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data, error } = await supabase.rpc('create_invitation', {
    p_family: familyId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Répertoire de familles : remplace localStorage dès que le cloud est actif. */
export class SupabaseFamilyRepository implements FamilyRepository {
  constructor(
    private readonly familyId: Id,
    private readonly events: RepositoryEvents = {},
  ) {}

  async load(): Promise<FamilyData> {
    if (!supabase) return emptyFamily();
    const { data, error } = await supabase
      .from('family_documents')
      .select('document')
      .eq('family_id', this.familyId)
      .maybeSingle();
    if (error) {
      const message = `Chargement en ligne impossible : ${error.message}`;
      this.events.onSaveError?.(message);
      throw new Error(message);
    }
    this.events.onSaveError?.('');
    if (!data) return emptyFamily();
    return validateFamilyData(data.document);
  }

  async save(data: FamilyData): Promise<void> {
    if (!supabase) return;
    const { error } = await supabase.from('family_documents').upsert(
      {
        family_id: this.familyId,
        document: data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'family_id' },
    );
    if (error) {
      const message = `Sauvegarde en ligne impossible : ${error.message}`;
      this.events.onSaveError?.(message);
      throw new Error(message);
    }
    this.events.onSaveError?.('');
  }

  async clear(): Promise<void> {
    await this.save(emptyFamily());
  }

  async listBackups(): Promise<BackupSummary[]> {
    // Les copies de secours restent gérées localement : le cloud conserve
    // l'historique via les sauvegardes de la plateforme, sans dupliquer le JSON.
    return [];
  }
}

/** Storage privé, clés identiques à IndexedDB. */
export class SupabaseMediaStore implements MediaStore {
  constructor(private readonly familyId: Id) {}

  private path(key: string): string {
    return key.startsWith(`${this.familyId}/`) ? key : `${this.familyId}/${key}`;
  }

  async put(key: string, blob: Blob): Promise<void> {
    if (!supabase) throw new Error('Supabase non configuré.');
    const { error } = await supabase.storage
      .from('family-media')
      .upload(this.path(key), blob, { upsert: true, contentType: blob.type });
    if (error) throw new Error(error.message);
  }

  async get(key: string): Promise<Blob | undefined> {
    if (!supabase) return undefined;
    const { data, error } = await supabase.storage
      .from('family-media')
      .download(this.path(key));
    if (error) return undefined;
    return data;
  }

  async delete(key: string): Promise<void> {
    if (!supabase) return;
    await supabase.storage.from('family-media').remove([this.path(key)]);
  }

  async clear(): Promise<void> {
    if (!supabase) return;
    const { data } = await supabase.storage
      .from('family-media')
      .list(this.familyId);
    if (!data?.length) return;
    await supabase.storage
      .from('family-media')
      .remove(data.map((item) => `${this.familyId}/${item.name}`));
  }
}

export interface MediaMigrationReport {
  /** Médias à copier (data URLs et URLs externes exclues). */
  total: number;
  uploaded: number;
  /** Clés présentes dans le document mais introuvables en IndexedDB. */
  missing: string[];
  /** Clés trouvées mais refusées par Storage (droits, quota, réseau). */
  failed: string[];
}

/**
 * Copie les octets IndexedDB vers Storage AVANT de basculer le store actif.
 *
 * Les clés du document restent inchangées : `SupabaseMediaStore` préfixe déjà
 * chaque clé par le familyId cloud. Le premier dossier du chemin Storage est
 * donc toujours la famille autorisée par les politiques RLS, et le second est
 * l'identifiant de famille du document — y compris après une importation.
 */
export async function migrateLocalMediaToCloud(
  familyId: Id,
  data: FamilyData,
  options: {
    source?: MediaStore;
    target?: MediaStore;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<MediaMigrationReport> {
  const source = options.source ?? localMediaStore;
  const target = options.target ?? new SupabaseMediaStore(familyId);
  const report: MediaMigrationReport = {
    total: 0,
    uploaded: 0,
    missing: [],
    failed: [],
  };
  const candidates = data.media.filter(
    (medium) => !/^(data:|blob:|https?:)/i.test(medium.key),
  );
  report.total = candidates.length;

  for (const [index, medium] of candidates.entries()) {
    try {
      const blob = await source.get(medium.key);
      if (!blob) {
        report.missing.push(medium.key);
      } else {
        await target.put(medium.key, blob);
        report.uploaded += 1;
      }
    } catch {
      // Une clé en échec ne bloque pas les autres : le rapport précise
      // lesquelles devront être réimportées depuis une sauvegarde JSON.
      report.failed.push(medium.key);
    }
    options.onProgress?.(index + 1, candidates.length);
  }

  return report;
}
