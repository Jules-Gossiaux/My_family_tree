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
  NoteInput,
  NoteRow,
  PlaceRow,
  PersonDetail,
  RelationInput,
  SourceInput,
  SourceRow,
} from '../shared/types';
import { SANS_ADRESSE, supabase } from './supabase';
// La grammaire des dates françaises ne vit qu'à un seul endroit : le navigateur la lit, la base
// range ce qu'elle en a tiré. Le réécrire en SQL ferait deux règles distinctes.
import { parseGenealogyDate } from '../server/dates';

/**
 * Une vue de l'arbre se lit d'un seul coup. Les fonctions SQL posées dans
 * `supabase/migrations/20261101183000_ecran_en_ligne.sql` rendent exactement les objets de
 * `shared/types.ts`, camelCase compris : ce qui change est le transport, pas les écrans.
 *
 * Elles sont `security invoker` côté serveur, donc un compte qui n'est pas de la famille reçoit
 * des tableaux vides — jamais une erreur à afficher.
 */
async function vue<T>(nom: string, parametres?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error(SANS_ADRESSE);
  const { data, error } = await supabase.rpc(nom, parametres ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

/**
 * Ce qui n'est pas encore écrit. La base SQLite du disque n'est plus la source de vérité depuis
 * que l'arbre vit sur le serveur : l'enregistrer là produirait des changements que personne
 * d'autre ne verrait jamais, et un arbre à moitié écrit ne se rattrape pas. Un refus net vaut
 * mieux qu'une perte.
 */
function pasEncoreEnLigne(): Promise<never> {
  return Promise.reject(
    new Error(
      "L'enregistrement en ligne n'est pas encore écrit : depuis cette adresse, l'arbre se consulte mais ne se modifie pas.",
    ),
  );
}

/** Une heure, puis le navigateur redemande : le seau reste privé et le lien ne circule pas. */
const DUREE_SIGNATURE = 3600;

/** URL signées déjà délivrées, par clé de fichier — une galerie de 200 photos ne signe pas 200 fois. */
const signatures = new Map<string, { url: string; expireAt: number }>();

/**
 * L'adresse temporaire d'un fichier du coffre. La clé seule ne ouvre rien : c'est la signature,
 * contrôlée à chaque demande par les règles de la table `storage.objects`, qui fait le droit.
 */
export async function mediaUrl(media: Media, part: 'original' | 'thumb'): Promise<string> {
  const cle = part === 'original' ? media.key : media.thumbKey;
  if (!cle) throw new Error('Ce fichier n’a pas de vignette.');

  const tenue = signatures.get(cle);
  if (tenue && tenue.expireAt > Date.now()) return tenue.url;
  if (!supabase) throw new Error(SANS_ADRESSE);

  const { data, error } = await supabase.storage.from('medias').createSignedUrl(cle, DUREE_SIGNATURE);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Ce fichier n’a pas pu être délivré.');

  signatures.set(cle, { url: data.signedUrl, expireAt: Date.now() + (DUREE_SIGNATURE - 300) * 1000 });
  return data.signedUrl;
}

/** Ce que la fiche corrige d'une personne : seulement ce qui a été touché, le reste ne bouge pas. */
type PersonPatch = Partial<CreatePersonInput> & {
  nickname?: string | null;
  portraitMediaId?: string | null;
  branchId?: string | null;
};

/**
 * La date n'est envoyée, déjà lue, que si son texte a été nommé : une date que l'on ne dit pas
 * n'est pas une date que l'on efface.
 */
function avecDateLue(input: { dateText?: string | null }): Record<string, unknown> {
  return input.dateText === undefined
    ? { ...input }
    : { ...input, date: parseGenealogyDate(input.dateText) };
}

/** Les deux dates de la fiche, selon la même règle que le fait de la vie. */
function avecDatesLues(input: PersonPatch): Record<string, unknown> {
  const p: Record<string, unknown> = { ...input };
  if (input.birthText !== undefined) p.birthDate = parseGenealogyDate(input.birthText);
  if (input.deathText !== undefined) p.deathDate = parseGenealogyDate(input.deathText);
  return p;
}

export const api = {
  graph: () => vue<GraphData>('graph_json'),

  state: () => vue<AppState>('state_json'),

  person: async (id: string) => {
    const detail = await vue<PersonDetail | null>('person_detail_json', { p_id: id });
    if (!detail) throw new Error('Personne introuvable');
    return detail;
  },

  /** Les lieux connus, pour proposer ce qui est déjà écrit plutôt que de le recopier. */
  places: async () => ({ places: await vue<PlaceRow[]>('places_json') }),

  /** Les sources connues, pour qu'un fait en choisisse une plutôt que de la réécrire. */
  sources: async () => ({ sources: await vue<SourceRow[]>('sources_json') }),

  /** Ce qui attend encore un visage. */
  unattachedMedia: async () => ({ media: await vue<Media[]>('unattached_media_json') }),

  backup: () => pasEncoreEnLigne(),
  backups: () => pasEncoreEnLigne() as Promise<{ backups: BackupInfo[] }>,
  /** Adresses des fichiers que l'on enregistre ailleurs que dans le dossier de données. */
  backupFileUrl: (name: string) => `/api/backups/file?name=${encodeURIComponent(name)}`,
  exportJsonUrl: '/api/export/json',

  /**
   * Une personne nouvelle, ses deux dates de vie et le premier lien que l'on en dit. La fonction
   * SQL refuse un lecteur avant d'écrire, et ne touche jamais la souche : l'arbre en ligne n'en
   * garde pas.
   */
  createPerson: async (input: CreatePersonInput) => ({
    id: await vue<string>('create_person', { p: avecDatesLues(input) }),
  }),
  updatePerson: (id: string, input: PersonPatch) =>
    vue<void>('update_person', { p_id: id, p: avecDatesLues(input) }),
  deletePerson: (id: string) => vue<void>('delete_person', { p_id: id }),
  /** Deux personnes que la base connaît déjà : un enfant, un parent, une union. */
  attachRelation: (id: string, relation: RelationInput) =>
    vue<void>('attach_relation', { p_subject_id: id, p: relation }),
  /** La souche se règle en ligne : la fonction SQL refuse un lecteur avant de toucher la ligne. */
  setRoot: (rootPersonId: string | null) => vue<void>('set_root', { p_person_id: rootPersonId }),
  /** Qui vous êtes dans l'arbre — le réglage que « Me recentrer » retrouve. */
  setMe: (mePersonId: string | null) => pasEncoreEnLigne(),
  setDataDir: (dataDir: string) => pasEncoreEnLigne() as Promise<DataDirResult>,

  /** Une branche : un nom, une couleur, et la personne dont elle part. */
  createBranch: async (input: BranchInput & { includeDescendants?: boolean }) => ({
    branch: await vue<Branch>('create_branch', { p: input }),
  }),
  updateBranch: async (id: string, input: BranchInput) => ({
    branch: await vue<Branch>('update_branch', { p_id: id, p: input }),
  }),
  /** Range la descendance d'une personne sous une branche ; dit combien de cases ont suivi. */
  branchDescendants: async (id: string, rootPersonId?: string) => ({
    assigned: await vue<number>('branch_descendants', { p_id: id, p_root_person_id: rootPersonId ?? null }),
  }),
  deleteBranch: (id: string) => vue<void>('delete_branch', { p_id: id }),

  /** Un fait de la vie : il porte une personne ou une union, et se date en français libre. */
  createEvent: (input: EventInput) =>
    vue<EventRow>('create_event', { p: { ...input, date: parseGenealogyDate(input.dateText) } }),
  updateEvent: (id: string, input: EventInput) =>
    vue<EventRow>('update_event', { p_id: id, p: avecDateLue(input) }),
  deleteEvent: (id: string) => vue<void>('delete_event', { p_id: id }),

  /** Renommer ne déplace aucun fait : les lignes qui pointaient déjà ici suivent le nouveau nom. */
  updatePlace: async (id: string, name: string) => ({
    place: await vue<PlaceRow>('update_place', { p_id: id, p: { name } }),
  }),
  /** Effacer un lieu rend ses faits et ses fichiers à un lieu inconnu, sans rien effacer d'eux. */
  deletePlace: (id: string) =>
    vue<{ ok: true; events: number; media: number }>('delete_place', { p_id: id }),

  createSource: async (input: SourceInput) => ({
    source: await vue<SourceRow>('create_source', { p: input }),
  }),
  /** Corriger une référence suit les faits qui la citent : la source reste la même ligne. */
  updateSource: async (id: string, input: SourceInput) => ({
    source: await vue<SourceRow>('update_source', { p_id: id, p: input }),
  }),
  /** Une source encore citée se refuse : le message compte les citations à retirer avant. */
  deleteSource: (id: string) => vue<void>('delete_source', { p_id: id }),

  /** Une note se pose sur ce qu'elle commente : son texte part avec la cible qu'on lui donne. */
  createNote: async (input: NoteInput) => ({ note: await vue<NoteRow>('create_note', { p: input }) }),
  /** Corriger une note n'en change pas la date : l'écran dit « écrite le », pas « modifiée le ». */
  updateNote: async (id: string, body: string) => ({
    note: await vue<NoteRow>('update_note', { p_id: id, p: { body } }),
  }),
  deleteNote: (id: string) => vue<void>('delete_note', { p_id: id }),

  uploadMedia: (
    file: File,
    meta: { kind: MediaKind; taken?: string | null; width?: number | null; height?: number | null },
  ) => pasEncoreEnLigne() as Promise<{ media: Media; deduped: boolean }>,
  uploadThumbnail: (mediaId: string, blob: Blob) => pasEncoreEnLigne() as Promise<{ media: Media }>,
  patchMedia: (
    id: string,
    patch: {
      caption?: string | null;
      kind?: MediaKind;
      documentType?: string | null;
      dateText?: string | null;
    },
  ) => pasEncoreEnLigne() as Promise<{ media: Media }>,
  deleteMedia: (id: string) => pasEncoreEnLigne(),
  attachMedia: (id: string, personIds: string[], role = 'sujet') =>
    pasEncoreEnLigne() as Promise<{ media: Media }>,
  detachMedia: (mediaId: string, personId: string) => pasEncoreEnLigne() as Promise<{ media: Media }>,
  setPortrait: (personId: string, portraitMediaId: string | null) => pasEncoreEnLigne(),
};

/** Le dossier choisi est écrit sur le disque ; l'ouverture réelle attend un redémarrage. */
export interface DataDirResult {
  ok: true;
  dataDir: string;
  restartNeeded: boolean;
  note: string;
}
