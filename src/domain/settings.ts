import { newId } from './id';
import type { Id } from './types';

/**
 * Réglages de lecture, DISTINCTS des données familiales.
 *
 * `meId` est personnel : deux personnes connectées au même arbre n'ont pas le
 * même « moi ». La clé de stockage est donc `simple-family-tree:settings:<profil>`.
 * Le profil est `local` hors ligne, et l'identifiant Auth de l'utilisateur
 * connecté en ligne : chacun retrouve son marqueur sans modifier le document
 * familial partagé.
 */
export const LOCAL_PROFILE_ID = 'local';

export interface Branch {
  id: Id;
  name: string;
  color: string;
  /** Personne de départ, purement indicative : aucune propriété exclusive. */
  startPersonId?: Id;
  /** Une personne peut appartenir à PLUSIEURS branches (étiquettes, pas des cases). */
  memberIds: Id[];
}

export interface ViewSettings {
  meId?: Id;
  referenceId?: Id;
  branches: Branch[];
}

export const EMPTY_SETTINGS: ViewSettings = { branches: [] };

const PREFIX = 'simple-family-tree:settings:';

export interface SettingsStore {
  load(): ViewSettings;
  save(settings: ViewSettings): void;
}

export class LocalSettingsStore implements SettingsStore {
  constructor(private readonly profileId: Id = LOCAL_PROFILE_ID) {}

  private get key(): string {
    return `${PREFIX}${this.profileId}`;
  }

  load(): ViewSettings {
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return { ...EMPTY_SETTINGS, branches: [] };
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return { ...EMPTY_SETTINGS, branches: [] };
    }
  }

  save(settings: ViewSettings): void {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(normalizeSettings(settings)));
    } catch {
      // Réglages non critiques : l'arbre reste utilisable sans eux.
    }
  }
}

const COLORS = [
  '#c0574b',
  '#3f7d8c',
  '#8a6d3b',
  '#6c5c9c',
  '#40745a',
  '#a45f7d',
  '#5b6d8c',
];

export function nextBranchColor(branches: Branch[]): string {
  return COLORS[branches.length % COLORS.length];
}

export function createBranch(name: string, branches: Branch[]): Branch {
  return {
    id: newId(),
    name: name.trim() || 'Branche',
    color: nextBranchColor(branches),
    memberIds: [],
  };
}

export function branchesOf(settings: ViewSettings, personId: Id): Branch[] {
  return settings.branches.filter((branch) => branch.memberIds.includes(personId));
}

export function branchColorOf(settings: ViewSettings, personId: Id): string | undefined {
  return branchesOf(settings, personId)[0]?.color;
}

export function branchLabelsOf(settings: ViewSettings, personId: Id): string {
  return branchesOf(settings, personId)
    .map((branch) => branch.name)
    .join(', ');
}

export function memberCountOf(settings: ViewSettings, branchId: Id): number {
  return settings.branches.find((branch) => branch.id === branchId)?.memberIds.length ?? 0;
}

export function normalizeSettings(value: unknown): ViewSettings {
  if (!value || typeof value !== 'object') return { ...EMPTY_SETTINGS, branches: [] };
  const obj = value as Record<string, unknown>;
  const rawBranches = Array.isArray(obj.branches) ? obj.branches : [];
  const branches: Branch[] = [];
  const seen = new Set<string>();
  for (const entry of rawBranches) {
    if (!entry || typeof entry !== 'object') continue;
    const branch = entry as Record<string, unknown>;
    const id = typeof branch.id === 'string' && branch.id ? branch.id : newId();
    if (seen.has(id)) continue;
    seen.add(id);
    branches.push({
      id,
      name: typeof branch.name === 'string' && branch.name.trim() ? branch.name : 'Branche',
      color:
        typeof branch.color === 'string' && /^#[0-9a-f]{6}$/i.test(branch.color)
          ? branch.color
          : nextBranchColor(branches),
      startPersonId:
        typeof branch.startPersonId === 'string' ? branch.startPersonId : undefined,
      memberIds: Array.isArray(branch.memberIds)
        ? branch.memberIds.filter((memberId, index, all) =>
            typeof memberId === 'string' && all.indexOf(memberId) === index,
          )
        : [],
    });
  }
  return {
    meId: typeof obj.meId === 'string' ? obj.meId : undefined,
    referenceId: typeof obj.referenceId === 'string' ? obj.referenceId : undefined,
    branches,
  };
}
