import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
} from 'react';
import TreeCanvas, { type FocusRequest } from './components/TreeCanvas';
import type { CardPortrait } from './components/PersonCard';
import BackupDialog from './components/BackupDialog';
import SettingsDialog from './components/SettingsDialog';
import MediaInbox from './components/MediaInbox';
import RelationshipDialog from './components/RelationshipDialog';
import CloudGate from './components/CloudGate';
import { resetMediaStore, setMediaStore } from './domain/mediaStore';
import {
  currentUser,
  migrateLocalMediaToCloud,
  SupabaseFamilyRepository,
  SupabaseMediaStore,
  supabaseConfigured,
} from './domain/supabase';
import {
  LocalSettingsStore,
  LOCAL_PROFILE_ID,
  type SettingsStore,
  type ViewSettings,
} from './domain/settings';
import SidePanel from './components/SidePanel';
import DirectoryDialog from './components/DirectoryDialog';
import EventDialog from './components/EventDialog';
import PersonFormDialog, {
  type AddKind,
  type DialogConfig,
  type DialogResult,
  type SelectOption,
} from './components/PersonFormDialog';
import ResolutionDialog, {
  type ResolutionOption,
} from './components/ResolutionDialog';
import {
  exportFamilyBundle,
  LocalFamilyRepository,
  parseFamilyDocument,
  type BackupSummary,
} from './domain/repository';
import { mediaStore } from './domain/mediaStore';
import { downloadGedcom } from './domain/gedcom';
import { deleteEvent, personDeletionImpact } from './domain/lifeEvents';
import {
  findFiliationConflicts,
  resolveFiliationConflict,
  type ConflictMode,
} from './domain/conflicts';
import {
  createPerson,
  emptyFamily,
  freeSlot,
  personLabel,
  personSearchText,
  unionPartnerIds,
  type FamilyData,
  type Id,
  type LinkType,
  type MutationResult,
  type NewPersonInput,
  DEFAULT_PORTRAIT_CROP,
  type Person,
  type UnionMetaInput,
  type UnionSlot,
} from './domain/types';
import {
  addFirstPerson,
  getPerson,
  linkCandidates,
  partnerUnionsOf,
  planRelation,
  primaryBirthUnionOf,
  removeChildLink,
  removePerson,
  removeUnion,
  replaceUnionPartner,
  resolveRelation,
  updateChildLink,
  updatePerson,
  updateUnion,
  type ConflictResolution,
  type RelationKind,
  type RelationQuestion,
} from './domain/operations';
import { normalizeSearch } from './domain/dates';
import { personChoiceLabel, personContextLabel } from './domain/personChoices';
import { computeLayout, structureKey, type TreeLayout } from './layout/layout';
import {
  VIEW_LABELS,
  VIEW_MODES,
  computeFocusedView,
  isTreeViewMode,
  type TreeViewMode,
} from './layout/views';
import {
  GROUPING_HINTS,
  GROUPING_LABELS,
  GROUPING_MODES,
  isGroupingMode,
  type GroupingMode,
} from './layout/grouping';

const GROUPING_STORAGE_KEY = 'simple-family-tree:grouping';

const EMPTY_LAYOUT: TreeLayout = {
  nodes: [],
  edges: [],
  width: 0,
  height: 0,
};

type Pending =
  | { type: 'relation'; question: RelationQuestion }
  | { type: 'legacy'; childId: Id; keepUnionId: Id };

interface ResolutionView {
  title: string;
  subtitle?: string;
  description: string;
  options: ResolutionOption[];
}

function hintFor(kind: AddKind, data: FamilyData, personId?: Id): string {
  if (kind === 'first') {
    return 'Cette première personne apparaîtra seule. Aucune racine privilégiée : la vue reste globale et identique pour chaque membre.';
  }
  if (!personId) return '';
  switch (kind) {
    case 'parent': {
      const birth = primaryBirthUnionOf(data, personId);
      if (!birth) {
        return 'Une union parentale sera créée au-dessus de cette personne, avec un second parent laissé à compléter.';
      }
      if (birth.partnerAId === null || birth.partnerBId === null) {
        return 'L’union parentale a un emplacement libre : cette personne le complétera comme second parent.';
      }
      return 'Les deux parents sont déjà renseignés : une union distincte sera créée. Si cela crée un doublon de filiation, l’application vous demandera comment le résoudre.';
    }
    case 'sibling':
      return primaryBirthUnionOf(data, personId)
        ? 'Rattaché à la même union parentale : la fratrie partagera une barre commune.'
        : 'Aucun parent connu : une union « parents non renseignés » sera créée pour relier la fratrie.';
    case 'child':
      return 'Choisissez la nature du lien et l’union de rattachement. Si une filiation existe déjà, l’application demandera toujours comment la résoudre.';
    case 'spouse':
      return 'Vous pouvez préciser le statut, les dates et s’il s’agit du conjoint actuel. Si une union parentale a un second parent non renseigné, l’application demandera s’il faut la compléter plutôt que créer un doublon.';
    default:
      return '';
  }
}

export default function App() {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [branchStartId, setBranchStartId] = useState<Id | null>(null);
  const [cloudGateOpen, setCloudGateOpen] = useState(false);
  const [cloudFamilyId, setCloudFamilyId] = useState<Id | null>(null);
  const [cloudUser, setCloudUser] = useState<string | null>(null);
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationFrom, setRelationFrom] = useState<Id | null>(null);
  // Les réglages de lecture sont personnels : clés par compte Auth en ligne,
  // par profil `local` hors ligne. Les données familiales restent partagées.
  const [profileId, setProfileId] = useState<Id>(LOCAL_PROFILE_ID);
  const settingsStore = useMemo(
    () => new LocalSettingsStore(profileId),
    [profileId],
  );
  const [settings, setSettings] = useState<ViewSettings>(() =>
    new LocalSettingsStore(LOCAL_PROFILE_ID).load(),
  );
  const loadedStore = useRef<SettingsStore | null>(null);
  const [data, setData] = useState<FamilyData | null>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [layout, setLayout] = useState<TreeLayout | null>(null);
  const [grouping, setGrouping] = useState<GroupingMode>(() => {
    try {
      const saved = window.localStorage.getItem(GROUPING_STORAGE_KEY);
      return isGroupingMode(saved) ? saved : 'balanced';
    } catch {
      return 'balanced';
    }
  });
  const [viewMode, setViewMode] = useState<TreeViewMode>(() => {
    try {
      const saved = window.localStorage.getItem('simple-family-tree:view-mode');
      return isTreeViewMode(saved) ? saved : 'classic';
    } catch {
      return 'classic';
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('simple-family-tree:view-mode', viewMode);
    } catch {
      // Réglage non critique.
    }
  }, [viewMode]);

  const [fitSignal, setFitSignal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusToken = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const localRepository = useMemo(
    () =>
      new LocalFamilyRepository({
        onSaveError: (message) => setSaveError(message || null),
        onRecovered: (message) => setToast(message),
      }),
    [],
  );
  const repository = useMemo(
    () =>
      cloudFamilyId
        ? new SupabaseFamilyRepository(cloudFamilyId, {
            onSaveError: (message) => setSaveError(message || null),
          })
        : localRepository,
    [cloudFamilyId, localRepository],
  );

  useEffect(() => {
    if (cloudFamilyId) {
      setMediaStore(new SupabaseMediaStore(cloudFamilyId));
      void currentUser().then((user) => setCloudUser(user?.email ?? null));
    } else {
      resetMediaStore();
      setCloudUser(null);
    }
  }, [cloudFamilyId]);

  const enterCloud = async (familyId: Id) => {
    if (!data) return;
    let mediaNote = '';
    // Les octets sont copiés avant le document : même si l'interface recharge
    // immédiatement après le basculement, aucun portrait ne manque.
    if (!cloudFamilyId) {
      const report = await migrateLocalMediaToCloud(familyId, data);
      mediaNote = `${report.uploaded} média(s) envoyé(s)`;
      if (report.missing.length) {
        mediaNote += ` · ${report.missing.length} absent(s) en local`;
      }
      if (report.failed.length) {
        mediaNote += ` · ${report.failed.length} envoi(s) refusé(s)`;
      }
    }
    await new SupabaseFamilyRepository(familyId).save(data);
    setCloudFamilyId(familyId);
    setCloudGateOpen(false);
    setToast(
      `Arbre en ligne${mediaNote ? ` · ${mediaNote}` : ''}. Vos réglages personnels suivent votre compte.`,
    );
  };
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [eventDialog, setEventDialog] = useState<{ eventId?: Id } | null>(null);
  const [portraits, setPortraits] = useState<Map<Id, CardPortrait>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef<FamilyData | null>(null);
  dataRef.current = data;

  const initialFocusApplied = useRef(false);

  useEffect(() => {
    void repository
      .load()
      .then((loaded) => {
        setData(loaded);
        if (initialFocusApplied.current) return;
        initialFocusApplied.current = true;
        const id = settings.referenceId ?? settings.meId;
        if (!id || !loaded.persons.some((person) => person.id === id)) return;
        focusToken.current += 1;
        setSelectedId(id);
        setFocusRequest({ id, token: focusToken.current });
      })
      .catch((error: unknown) => {
        setToast(error instanceof Error ? error.message : 'Chargement impossible.');
      });
  }, [repository]);

  // Chaque changement de profil recharge ses réglages avant toute écriture :
  // le garde-fou évite de copier le « Moi » d'un compte sur un autre.
  useEffect(() => {
    setSettings(settingsStore.load());
  }, [settingsStore]);

  useEffect(() => {
    if (loadedStore.current !== settingsStore) {
      loadedStore.current = settingsStore;
      return;
    }
    settingsStore.save(settings);
  }, [settings, settingsStore]);

  useEffect(() => {
    if (!supabaseConfigured) return;
    void currentUser().then((user) => {
      setProfileId(user?.id ?? LOCAL_PROFILE_ID);
    });
  }, []);

  useEffect(() => {
    if (!data) return;
    void repository.save(data).catch(() => {
      // L'erreur est déjà remontée à l'interface via onSaveError.
    });
  }, [data, repository]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GROUPING_STORAGE_KEY, grouping);
    } catch {
      // Stockage indisponible (navigation privée) : le réglage reste en mémoire.
    }
  }, [grouping]);

  const key = useMemo(() => (data ? structureKey(data) : ''), [data]);

  useEffect(() => {
    const current = dataRef.current;
    if (!current) return;
    let cancelled = false;
    if (viewMode !== 'classic') {
      const rootId = selectedId ?? settings.referenceId ?? settings.meId;
      setLayout(
        rootId && current.persons.some((person) => person.id === rootId)
          ? computeFocusedView(current, viewMode, rootId)
          : EMPTY_LAYOUT,
      );
      return;
    }
    void computeLayout(current, grouping)
      .then((result) => {
        if (!cancelled) setLayout(result);
      })
      .catch((error: unknown) => {
        console.error('Échec du calcul de la mise en page', error);
        setToast('Le placement de l’arbre a échoué.');
        if (!cancelled) setLayout(EMPTY_LAYOUT);
      });
    return () => {
      cancelled = true;
    };
  }, [key, grouping, viewMode, selectedId, settings.referenceId, settings.meId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Les portraits sont des URL d'objets construites à partir des octets locaux.
  // Elles sont libérées dès que les médias changent.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const created: string[] = [];
    const run = async () => {
      const map = new Map<Id, CardPortrait>();
      for (const person of data.persons) {
        if (!person.portraitMediaId) continue;
        const medium = data.media.find((item) => item.id === person.portraitMediaId);
        if (!medium) continue;
        let url = '';
        if (/^(data:|blob:|https?:)/i.test(medium.key)) {
          url = medium.key;
        } else {
          const blob = await mediaStore.get(medium.key);
          if (blob) {
            url = URL.createObjectURL(blob);
            created.push(url);
          }
        }
        if (url) {
          map.set(person.id, {
            url,
            crop: person.portraitCrop ?? DEFAULT_PORTRAIT_CROP,
          });
        }
      }
      if (cancelled) created.forEach((item) => URL.revokeObjectURL(item));
      else setPortraits(map);
    };
    void run();
    return () => {
      cancelled = true;
      created.forEach((item) => URL.revokeObjectURL(item));
    };
  }, [data]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialog && !pending) setSelectedId(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dialog, pending]);

  const conflicts = useMemo(
    () => (data ? findFiliationConflicts(data) : []),
    [data],
  );

  const personMap = useMemo<Map<Id, Person>>(
    () =>
      new Map<Id, Person>(
        (data?.persons ?? []).map((person) => [person.id, person] as [Id, Person]),
      ),
    [data],
  );

  // Recherche insensible aux accents et à la casse. Toutes les correspondances
  // sont surlignées ; la liste ne sert qu'à choisir où centrer la vue.
  const searchResults = useMemo(() => {
    const query = normalizeSearch(search).trim();
    if (!query || !data) return [];
    return data.persons
      .filter((person) =>
        normalizeSearch(personSearchText(person)).includes(query),
      )
      .slice(0, 8);
  }, [data, search]);

  const matchedIds = useMemo(
    () => new Set(searchResults.map((person) => person.id)),
    [searchResults],
  );

  const chooseSearchResult = (person: Person) => {
    setSelectedId(person.id);
    setSearch(personLabel(person));
    setSearchOpen(false);
    focusToken.current += 1;
    setFocusRequest({ id: person.id, token: focusToken.current });
  };

  const applyMutation = (fn: (current: FamilyData) => MutationResult) => {
    if (!data) return;
    const result = fn(data);
    setData(result.data);
    setSelectedId(result.personId);
    setDialog(null);
    setFitSignal((value) => value + 1);
  };

  const handleAdd = (kind: AddKind, preferExisting = false) => {
    if (kind === 'first') {
      setDialog({ kind });
      return;
    }
    if (!selectedId) return;
    setDialog({ kind, personId: selectedId, preferExisting });
  };

  const handleSubmit = (result: DialogResult) => {
    if (!dialog || !data) return;
    const kind = dialog.kind;
    if (kind === 'first') {
      if (result.mode === 'new') {
        applyMutation((current) => addFirstPerson(current, result.input));
      }
      return;
    }

    const personId = dialog.personId;
    if (!personId) return;

    let related: Person | undefined;
    let isNew = false;
    if (result.mode === 'new') {
      related = createPerson(data.familyId, result.input);
      isNew = true;
    } else {
      related = getPerson(data, result.personId);
    }
    if (!related) return;

    const plan = planRelation(data, {
      kind: kind as RelationKind,
      personId,
      related,
      isNew,
      targetUnionId: result.unionId,
      linkType: result.linkType,
      unionMeta: result.unionMeta,
    });

    if (plan.type === 'ask') {
      setDialog(null);
      setPending({ type: 'relation', question: plan.question });
      return;
    }
    applyMutation(() => plan.result);
  };

  const handleResolution = (value: string) => {
    if (!data || !pending) return;
    if (pending.type === 'relation') {
      const result = resolveRelation(
        data,
        pending.question,
        value as ConflictResolution,
      );
      setData(result.data);
      setSelectedId(result.personId);
      setToast('Lien enregistré.');
    } else {
      setData(
        resolveFiliationConflict(
          data,
          pending.childId,
          pending.keepUnionId,
          value as ConflictMode,
        ),
      );
      setToast('Doublon de filiation résolu.');
    }
    setPending(null);
    setFitSignal((value_) => value_ + 1);
  };

  const handleUpdate = (patch: Partial<NewPersonInput>) => {
    if (!selectedId) return;
    setData((previous) =>
      previous ? updatePerson(previous, selectedId, patch) : previous,
    );
  };

  const handleUpdateUnion = (
    unionId: Id,
    patch: Partial<UnionMetaInput>,
  ) => {
    setData((previous) =>
      previous ? updateUnion(previous, unionId, patch) : previous,
    );
  };

  const handleUpdateChildLink = (
    unionId: Id,
    childId: Id,
    slot: UnionSlot,
    link: LinkType,
  ) => {
    setData((previous) =>
      previous
        ? updateChildLink(previous, unionId, childId, slot, link)
        : previous,
    );
  };

  const handleRemoveChildLink = (unionId: Id, childId: Id) => {
    setData((previous) =>
      previous ? removeChildLink(previous, unionId, childId) : previous,
    );
    setToast('Lien retiré, la personne reste dans l’arbre.');
  };

  const handleRemoveUnion = (unionId: Id) => {
    setData((previous) => (previous ? removeUnion(previous, unionId) : previous));
    setToast('Union supprimée.');
  };

  const handleReplaceUnionPartner = (
    unionId: Id,
    slot: UnionSlot,
    partnerId: Id | null,
  ) => {
    if (!data) return;
    const union = data.unions.find((candidate) => candidate.id === unionId);
    if (!union) return;
    const currentId = slot === 'A' ? union.partnerAId : union.partnerBId;
    if (currentId === partnerId) return;
    const labelOf = (id: Id | null): string => {
      const person = id ? getPerson(data, id) : undefined;
      return person ? personLabel(person) : 'l’emplacement vide';
    };
    const message = partnerId
      ? `Remplacer ${labelOf(currentId)} par ${labelOf(partnerId)} ? Aucune personne n’est supprimée ; les enfants restent rattachés à cette union.`
      : `Retirer ${labelOf(currentId)} de cette union ? La personne reste dans l’arbre et les enfants restent rattachés à l’autre parent.`;
    if (!window.confirm(message)) return;
    setData((previous) =>
      previous ? replaceUnionPartner(previous, unionId, slot, partnerId) : previous,
    );
    setToast(partnerId ? 'Lien mis à jour.' : 'Emplacement libéré.');
  };

  const handleDelete = (id: Id | null = selectedId) => {
    if (!data || !id) return;
    const person = getPerson(data, id);
    if (!person) return;
    const impact = personDeletionImpact(data, id);
    const details: string[] = [];
    if (impact.defaultEvents.length > 0) {
      details.push(`${impact.defaultEvents.length} fait(s) de vie par défaut`);
    }
    if (impact.orphanEvents.length > 0) {
      details.push(`${impact.orphanEvents.length} fait(s) sans autre participant`);
    }
    const message = details.length
      ? `Supprimer ${personLabel(person)} et ses liens ?\n\nSera(ont) aussi supprimé(s) : ${details.join(', ')}. Les autres faits seront conservés avec leurs autres participants.`
      : `Supprimer ${personLabel(person)} et ses liens ?`;
    if (!window.confirm(message)) return;
    setData(removePerson(data, id));
    setSelectedId(null);
    setFitSignal((value) => value + 1);
    setToast('Personne supprimée.');
  };

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  useEffect(() => {
    const handleDeleteKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || !selectedId || dialog || pending) return;
      const target = event.target as HTMLElement | null;
      // Ne jamais voler la touche pendant l'édition d'un champ.
      if (
        target?.matches('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      event.preventDefault();
      handleDelete();
    };
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [selectedId, dialog, pending, handleDelete]);

  const handleImportFile = async (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseFamilyDocument(await file.text());
      setData(parsed.data);
      setSelectedId(null);
      setDialog(null);
      setPending(null);
      setEventDialog(null);
      setFitSignal((value) => value + 1);
      const version =
        parsed.migratedFrom === 1
          ? ' · format v1 migré en v3'
          : parsed.migratedFrom === 2
            ? ' · format v2 migré en v3'
            : '';
      setToast(
        `${parsed.data.persons.length} personne(s) importée(s)${version} · ${parsed.mediaRestored} fichier(s) restauré(s).`,
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Import impossible.');
    }
  };

  const handleExport = async () => {
    if (!data) return;
    const blob = await exportFamilyBundle(data);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arbre-genealogique-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setToast('Fichier JSON exporté.');
  };

  const handleOpenBackups = () => {
    void repository.listBackups?.().then(setBackups);
    setBackupOpen(true);
  };

  const handleRestoreBackup = (id: string) => {
    if (!(repository instanceof LocalFamilyRepository)) return;
    void repository.restoreBackup(id).then((restored: FamilyData) => {
      setData(restored);
      setSelectedId(null);
      setFitSignal((value) => value + 1);
      setBackupOpen(false);
      setToast('Copie de secours restaurée.');
    });
  };

  const recenterOnMe = () => {
    if (!settings.meId) return;
    focusToken.current += 1;
    setSelectedId(settings.meId);
    setFocusRequest({ id: settings.meId, token: focusToken.current });
  };

  const openRelationship = (from: Id | null = null) => {
    setRelationFrom(from);
    setRelationOpen(true);
  };

  const openBranchFor = (id: Id) => {
    setBranchStartId(id);
    setSettingsOpen(true);
  };

  const handleDeleteEvent = (eventId: Id) => {
    if (!window.confirm('Supprimer ce fait de vie ?')) return;
    setData((previous) =>
      previous ? deleteEvent(previous, eventId) : previous,
    );
    setEventDialog(null);
    setToast('Fait de vie supprimé.');
  };

  const handleReset = async () => {
    if (
      !window.confirm(
        'Supprimer toutes les personnes et toutes les unions ? Cette action est irréversible.',
      )
    ) {
      return;
    }
    await repository.clear();
    if (cloudFamilyId) await mediaStore.clear();
    setData(emptyFamily());
    setSelectedId(null);
    setDialog(null);
    setPending(null);
    setFitSignal((value) => value + 1);
    setToast('Arbre réinitialisé.');
  };

  const contextPerson =
    dialog?.personId && data ? getPerson(data, dialog.personId) : undefined;

  const existingOptions: SelectOption[] = useMemo(() => {
    if (!data || !dialog || dialog.kind === 'first' || !dialog.personId) {
      return [];
    }
    return linkCandidates(data, dialog.kind, dialog.personId).map((person) => ({
      id: person.id,
      label: personChoiceLabel(data, person),
    }));
  }, [data, dialog]);

  const unionOptions: SelectOption[] = useMemo(() => {
    if (!data || dialog?.kind !== 'child' || !dialog.personId) return [];
    const personId = dialog.personId;
    const map = new Map<Id, Person>(
      data.persons.map((person) => [person.id, person] as [Id, Person]),
    );
    return partnerUnionsOf(data, personId).map((union) => {
      const otherId = unionPartnerIds(union).find((id) => id !== personId);
      const other = otherId ? map.get(otherId) : undefined;
      const base = other
        ? `Union avec ${personLabel(other)}`
        : 'Union sans autre conjoint';
      const age = union.isCurrent ? 'actuelle' : 'ancienne';
      return {
        id: union.id,
        label: `${base} · ${union.children.length} enfant(s) · ${age}`,
      };
    });
  }, [data, dialog]);

  const resolutionView = useMemo<ResolutionView | null>(() => {
    if (!data || !pending) return null;
    const nameOf = (id: Id | null | undefined): string => {
      const person = id ? getPerson(data, id) : undefined;
      return person ? personLabel(person) : 'non renseigné';
    };

    if (pending.type === 'legacy') {
      const childName = nameOf(pending.childId);
      const keep = data.unions.find((union) => union.id === pending.keepUnionId);
      const conflict = conflicts.find((c) => c.childId === pending.childId);
      const keepPartners = keep ? unionPartnerIds(keep) : [];
      const others = conflict?.entries.filter(
        (entry) => entry.union.id !== pending.keepUnionId,
      );
      const candidate = others
        ?.flatMap((entry) => unionPartnerIds(entry.union))
        .find((id) => !keepPartners.includes(id));
      const canComplete = !!keep && freeSlot(keep) !== null && !!candidate;
      const count = conflict?.entries.length ?? 2;
      const keepLabel = keepPartners.length
        ? keepPartners.map(nameOf).join(' & ')
        : 'parents non renseignés';
      return {
        title: `Deux filiations pour ${childName}`,
        subtitle: 'Données existantes · import ou ancienne version',
        description: `${childName} est rattaché(e) à ${count} unions par un lien biologique. L’union conservée comme filiation principale est « ${keepLabel} ». Les autres unions resteront dans l’arbre : seul leur lien vers l’enfant change.`,
        options: [
          {
            value: 'complete',
            label: 'C’est le même couple → compléter l’union',
            description: canComplete
              ? `« ${nameOf(candidate)} » rejoint l’union principale comme second parent. Le doublon disparaît, une seule branche subsiste.`
              : 'Impossible ici : l’union principale a déjà ses deux parents, ou aucun second parent n’a pu être identifié.',
            recommended: canComplete,
            disabled: !canComplete,
          },
          {
            value: 'step',
            label: 'Beau-parent / famille recomposée',
            description:
              'Les unions restent distinctes ; le lien surnuméraire devient « Beau-parent » et ne dessine plus aucune branche.',
          },
          {
            value: 'adoptive',
            label: 'Adoption',
            description:
              'Les unions restent distinctes ; la seconde filiation est conservée et dessinée en tirets.',
          },
          {
            value: 'legal',
            label: 'Lien légal (tutelle, reconnaissance)',
            description:
              'Les unions restent distinctes ; la seconde filiation est conservée et dessinée en pointillés.',
          },
        ],
      };
    }

    const question = pending.question;
    if (question.type === 'second-parent') {
      const spouse = personLabel(question.request.related);
      const owner = nameOf(question.request.personId);
      const children = question.childIds.map(nameOf).join(', ');
      return {
        title: `${spouse} est aussi le parent de ${children} ?`,
        subtitle: `Union de ${owner} · second parent non renseigné`,
        description: `${owner} a déjà une union parentale avec un emplacement libre (${children}). Avant de créer quoi que ce soit, précisez ce que représente ${spouse} pour cet enfant : l’application ne fusionne jamais toute seule.`,
        options: [
          {
            value: 'complete',
            label: 'Oui → compléter l’union existante',
            description: `${spouse} rejoint l’union de ${owner} comme second parent. Une seule branche de filiation, aucun doublon.`,
            recommended: true,
          },
          {
            value: 'adoptive',
            label: 'Oui, mais par adoption',
            description: `Même fusion, avec un lien typé « Adoptif » dessiné en tirets.`,
          },
          {
            value: 'legal',
            label: 'Oui, mais par un lien légal',
            description: `Même fusion, avec un lien typé « Légal » dessiné en pointillés.`,
          },
          {
            value: 'separate',
            label: 'Non → nouvelle union (famille recomposée)',
            description: `${owner} et ${spouse} forment une union distincte. ${children} reste rattaché à son union de naissance ; ${spouse} est enregistré(e) comme beau-parent, sans branche de filiation.`,
          },
        ],
      };
    }

    const childName = nameOf(question.childId);
    const keep = data.unions.find((union) => union.id === question.keepUnionId);
    const keepParents = keep ? unionPartnerIds(keep) : [];
    const keepLabel = keepParents.length
      ? keepParents.map(nameOf).join(' & ')
      : 'parents non renseignés';
    const otherParent = nameOf(
      question.newParentId ?? question.request.related.id,
    );
    return {
      title: `${childName} a déjà une filiation`,
      subtitle: `Union existante : ${keepLabel}`,
      description: `Cet ajout créerait une seconde filiation biologique pour ${childName}. L’application ne devine pas : choisissez la nature du lien. Aucune donnée n’est supprimée sans votre accord.`,
      options: [
        {
          value: 'complete',
          label: 'C’est le second parent → compléter l’union',
          description: question.canComplete
            ? `« ${otherParent} » rejoint l’union existante. Le doublon disparaît, une seule branche reste.`
            : 'Impossible ici : les deux parents de l’union existante sont déjà renseignés.',
          recommended: question.canComplete,
          disabled: !question.canComplete,
        },
        {
          value: 'step',
          label: 'Beau-parent / famille recomposée',
          description:
            'Les deux unions restent, mais le nouveau lien ne dessine aucune branche de filiation.',
        },
        {
          value: 'adoptive',
          label: 'Adoption',
          description:
            'Les deux unions restent ; la nouvelle filiation est conservée et dessinée en tirets.',
        },
        {
          value: 'legal',
          label: 'Lien légal (tutelle, reconnaissance)',
          description:
            'Les deux unions restent ; la nouvelle filiation est conservée et dessinée en pointillés.',
        },
      ],
    };
  }, [data, pending, conflicts]);

  if (!data || !layout) {
    return <div className="app-loading">Chargement de l’arbre…</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <h1>Arbre généalogique</h1>
            <p>Vue globale · aucune racine</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="search-box">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 4 4" />
            </svg>
            <input
              ref={searchInputRef}
              value={search}
              placeholder="Rechercher une personne…"
              aria-label="Rechercher une personne dans l’arbre"
              onChange={(event) => {
                setSearch(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => {
                // On laisse le temps d'un clic sur un résultat avant de fermer.
                window.setTimeout(() => setSearchOpen(false), 150);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchResults.length > 0) {
                  event.preventDefault();
                  chooseSearchResult(searchResults[0]);
                }
                if (event.key === 'Escape') {
                  setSearch('');
                  setSearchOpen(false);
                  searchInputRef.current?.blur();
                }
              }}
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                aria-label="Effacer la recherche"
                onClick={() => {
                  setSearch('');
                  setSearchOpen(false);
                  searchInputRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
            {searchOpen && search.trim() !== '' && (
              <div className="search-results">
                {searchResults.length === 0 ? (
                  <p className="search-empty">Aucune personne trouvée.</p>
                ) : (
                  <>
                    <p className="search-help">
                      Tous les résultats sont surlignés dans l’arbre ; Entrée
                      recentre sur le premier.
                    </p>
                    {searchResults.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        className="search-result"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseSearchResult(person)}
                      >
                        <strong>{personLabel(person)}</strong>
                        <span>{personContextLabel(data, person)}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <label className="grouping-control" title="Vue de l’arbre">
            <span>Vue</span>
            <select
              value={viewMode}
              onChange={(event) => {
                setViewMode(event.target.value as TreeViewMode);
                setFitSignal((value) => value + 1);
              }}
              aria-label="Mode de vue de l’arbre"
            >
              {VIEW_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {VIEW_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          {viewMode === 'classic' && (
          <label className="grouping-control" title={GROUPING_HINTS[grouping]}>
            <span>Proximité</span>
            <select
              value={grouping}
              onChange={(event) =>
                setGrouping(event.target.value as GroupingMode)
              }
              aria-label="Règle de rapprochement des fratries et des couples"
            >
              {GROUPING_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {GROUPING_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          )}
          {settings.meId && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={recenterOnMe}
            >
              Me recentrer
            </button>
          )}
          {supabaseConfigured && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCloudGateOpen(true)}
              title={cloudUser ? `Connecté : ${cloudUser}` : 'Comptes et arbre partagé'}
            >
              {cloudFamilyId ? '☁ En ligne' : 'Passer au cloud'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => openRelationship()}
          >
            Lien de parenté
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setSettingsOpen(true)}
          >
            Réglages
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleOpenBackups}
          >
            Sauvegardes
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setDirectoryOpen(true)}
          >
            Lieux &amp; sources
          </button>
          <span className="stats-badge">
            {data.persons.length} personne{data.persons.length > 1 ? 's' : ''} ·{' '}
            {data.unions.length} union{data.unions.length > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMediaOpen(true)}
          >
            Photos
            {data.media.length > 0 && <span className="tab-count">{data.media.length}</span>}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleAdd('first')}
          >
            Nouvelle personne
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Importer
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleExport()}
            disabled={data.persons.length === 0}
          >
            Exporter
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => downloadGedcom(data)}
            disabled={data.persons.length === 0}
            title="Exporter au format GEDCOM 5.5.1"
          >
            GEDCOM
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setFitSignal((value) => value + 1)}
          >
            Ajuster
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.print()}
          >
            Imprimer
          </button>
          <button
            type="button"
            className="btn btn-ghost-danger"
            onClick={handleReset}
            disabled={data.persons.length === 0 && data.unions.length === 0}
          >
            Réinitialiser
          </button>
        </div>
      </header>

      <main className="workspace">
        <TreeCanvas
          layout={layout}
          persons={personMap}
          selectedId={selectedId}
          fitSignal={fitSignal}
          focusRequest={focusRequest}
          matchedIds={matchedIds}
          portraits={portraits}
          settings={settings}
          onSelect={setSelectedId}
          onAdd={handleAdd}
          onDelete={handleDelete}
          onSetMe={(id) => {
            setSettings((current) => ({ ...current, meId: id }));
            setToast('Marqueur « Moi » enregistré pour votre compte.');
          }}
          onSetReference={(id) => {
            setSettings((current) => ({ ...current, referenceId: id }));
            setToast('Personne de référence enregistrée.');
          }}
          onStartBranch={openBranchFor}
          onOpenRelationship={openRelationship}
          onAttachExisting={() => handleAdd('child', true)}
          onAddFirst={() => handleAdd('first')}
          onImport={() => fileInputRef.current?.click()}
        />
        <SidePanel
          data={data}
          selectedId={selectedId}
          conflicts={conflicts}
          onUpdate={handleUpdate}
          onAdd={handleAdd}
          onDelete={handleDelete}
          onClose={() => setSelectedId(null)}
          onResolveConflict={(childId, keepUnionId) =>
            setPending({ type: 'legacy', childId, keepUnionId })
          }
          onUpdateUnion={handleUpdateUnion}
          onUpdateChildLink={handleUpdateChildLink}
          onRemoveChildLink={handleRemoveChildLink}
          onReplaceUnionPartner={handleReplaceUnionPartner}
          onRemoveUnion={handleRemoveUnion}
          onSelectPerson={setSelectedId}
          onChange={setData}
          onOpenDirectories={() => setDirectoryOpen(true)}
          onOpenEvent={(eventId) => setEventDialog({ eventId })}
          onDeleteEvent={handleDeleteEvent}
        />
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden-input"
        onChange={handleImportFile}
      />

      {dialog && (
        <PersonFormDialog
          config={dialog}
          contextName={contextPerson ? personLabel(contextPerson) : ''}
          hint={hintFor(dialog.kind, data, dialog.personId)}
          existingOptions={existingOptions}
          unionOptions={unionOptions}
          onSubmit={handleSubmit}
          onCancel={() => setDialog(null)}
        />
      )}

      {pending && resolutionView && (
        <ResolutionDialog
          title={resolutionView.title}
          subtitle={resolutionView.subtitle}
          description={resolutionView.description}
          options={resolutionView.options}
          onChoose={handleResolution}
          onCancel={() => setPending(null)}
        />
      )}

      {mediaOpen && (
        <div className="modal-overlay" onMouseDown={() => setMediaOpen(false)}>
          <div
            className="modal media-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Photos et documents"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="Fermer"
              onClick={() => setMediaOpen(false)}
            >
              ×
            </button>
            <MediaInbox data={data} onChange={setData} />
          </div>
        </div>
      )}

      {cloudGateOpen && data && (
        <CloudGate
          localData={data}
          onReady={enterCloud}
          onCancel={() => setCloudGateOpen(false)}
          onUserChange={(user) => setProfileId(user?.id ?? LOCAL_PROFILE_ID)}
        />
      )}

      {relationOpen && (
        <RelationshipDialog
          data={data}
          initialId={relationFrom}
          onClose={() => setRelationOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          data={data}
          settings={settings}
          branchStartId={branchStartId}
          onChange={setSettings}
          onClose={() => {
            setSettingsOpen(false);
            setBranchStartId(null);
          }}
        />
      )}

      {backupOpen && (
        <BackupDialog
          backups={backups}
          onRestore={handleRestoreBackup}
          onExport={() => void handleExport()}
          onClose={() => setBackupOpen(false)}
        />
      )}

      {directoryOpen && (
        <DirectoryDialog
          data={data}
          onChange={setData}
          onClose={() => setDirectoryOpen(false)}
        />
      )}

      {eventDialog && (
        <EventDialog
          data={data}
          eventId={eventDialog.eventId}
          onChange={setData}
          onDelete={handleDeleteEvent}
          onClose={() => setEventDialog(null)}
        />
      )}

      {saveError && (
        <div className="save-error" role="alert">
          <span>{saveError}</span>
          <button type="button" onClick={() => setSaveError(null)} aria-label="Fermer">
            ×
          </button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
