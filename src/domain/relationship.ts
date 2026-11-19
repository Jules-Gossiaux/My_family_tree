import {
  isFiliationLink,
  linkOfPartner,
  personLabel,
  unionPartnerIds,
  type FamilyData,
  type Id,
} from './types';

export interface RelationshipResult {
  /** Libellé court, en français, prêt à afficher. */
  label: string;
  /** Chaîne de parenté, du premier au second (identifiants). */
  path: Id[];
  /** Détail lisible de chaque étape. */
  steps: string[];
}

type Step = { from: Id; to: Id; kind: 'parent' | 'child' | 'spouse' };

function parentsOf(data: FamilyData, personId: Id): Id[] {
  const result: Id[] = [];
  for (const union of data.unions) {
    const child = union.children.find((candidate) => candidate.childId === personId);
    if (!child) continue;
    for (const parentId of unionPartnerIds(union)) {
      if (isFiliationLink(linkOfPartner(union, parentId, child) ?? 'step')) {
        result.push(parentId);
      }
    }
  }
  return [...new Set(result)];
}

function childrenOf(data: FamilyData, personId: Id): Id[] {
  const result: Id[] = [];
  for (const union of data.unions) {
    if (!unionPartnerIds(union).includes(personId)) continue;
    for (const child of union.children) {
      if (isFiliationLink(linkOfPartner(union, personId, child) ?? 'step')) {
        result.push(child.childId);
      }
    }
  }
  return [...new Set(result)];
}

function spousesOf(data: FamilyData, personId: Id): Id[] {
  const result: Id[] = [];
  for (const union of data.unions) {
    for (const partnerId of unionPartnerIds(union)) {
      if (partnerId !== personId && unionPartnerIds(union).includes(personId)) {
        result.push(partnerId);
      }
    }
  }
  return [...new Set(result)];
}

function neighbors(data: FamilyData, personId: Id): Step[] {
  return [
    ...parentsOf(data, personId).map((to) => ({ from: personId, to, kind: 'parent' as const })),
    ...childrenOf(data, personId).map((to) => ({ from: personId, to, kind: 'child' as const })),
    ...spousesOf(data, personId).map((to) => ({ from: personId, to, kind: 'spouse' as const })),
  ];
}

function stepLabel(kind: Step['kind'], gender?: 'male' | 'female'): string {
  if (kind === 'spouse') return 'conjoint';
  if (kind === 'parent') return gender === 'female' ? 'mère' : 'père';
  return gender === 'female' ? 'fille' : 'fils';
}

/** Convertit un chemin en libellé français courant. */
export function describePath(
  data: FamilyData,
  steps: Step[],
): { label: string; steps: string[] } {
  if (steps.length === 0) {
    return { label: 'Même personne', steps: [] };
  }
  if (steps.length === 1) {
    const kind = steps[0].kind;
    const target = data.persons.find((person) => person.id === steps[0].to);
    const gender = target?.gender === 'female' ? 'female' : 'male';
    const singular: Record<Step['kind'], string> = {
      parent: gender === 'female' ? 'Mère' : 'Père',
      child: gender === 'female' ? 'Fille' : 'Fils',
      spouse: 'Conjoint',
    };
    return {
      label: singular[kind],
      steps: [
        `${stepLabel(kind, gender)} : ${target ? personLabel(target) : 'personne inconnue'}`,
      ],
    };
  }

  const upward = steps.filter((step) => step.kind === 'parent').length;
  const downward = steps.filter((step) => step.kind === 'child').length;
  const spouseSteps = steps.filter((step) => step.kind === 'spouse').length;

  let label: string;
  if (upward === 0 && downward === 0) {
    label = 'Conjoint(s)';
  } else if (upward === 1 && downward === 1 && spouseSteps === 0) {
    label = 'Frère / Sœur';
  } else if (upward === 2 && downward === 0 && spouseSteps === 0) {
    label = 'Grand-parent';
  } else if (upward === 0 && downward === 2 && spouseSteps === 0) {
    label = 'Petit-enfant';
  } else if (upward === 1 && downward === 2 && spouseSteps === 0) {
    label = 'Oncle / Tante';
  } else if (upward === 2 && downward === 1 && spouseSteps === 0) {
    label = 'Neveu / Nièce';
  } else if (upward === 2 && downward === 2 && spouseSteps === 0) {
    label = 'Cousin / Cousine';
  } else if (spouseSteps > 0 && upward + downward === 0) {
    label = 'Par alliance';
  } else if (spouseSteps > 0) {
    label = 'Allié(e)';
  } else {
    label = `Parent au ${upward + downward}e degré`;
  }

  const detail = steps.map((step) => {
    const target = data.persons.find((person) => person.id === step.to);
    const gender = target?.gender === 'female' ? 'female' : 'male';
    const name = target ? personLabel(target) : 'personne inconnue';
    return `${stepLabel(step.kind, gender)} : ${name}`;
  });
  return { label, steps: detail };
}

/**
 * Plus court chemin de parenté entre deux personnes. Le graphe est petit :
 * un BFS non pondéré suffit, avec une limite pour éviter les cycles.
 */
export function relationshipBetween(
  data: FamilyData,
  fromId: Id,
  toId: Id,
): RelationshipResult | null {
  if (fromId === toId) {
    return { label: 'Même personne', path: [fromId], steps: [] };
  }
  if (!data.persons.some((person) => person.id === fromId) ||
      !data.persons.some((person) => person.id === toId)) {
    return null;
  }

  const queue: Step[][] = [[]];
  const visited = new Set<Id>([fromId]);
  let guard = 0;
  while (queue.length > 0 && guard < 20000) {
    guard += 1;
    const path = queue.shift()!;
    const current = path.length === 0 ? fromId : path[path.length - 1].to;
    for (const step of neighbors(data, current)) {
      if (visited.has(step.to)) continue;
      const next = [...path, step];
      if (step.to === toId) {
        const described = describePath(data, next);
        return {
          label: described.label,
          path: [fromId, ...next.map((entry) => entry.to)],
          steps: described.steps,
        };
      }
      visited.add(step.to);
      queue.push(next);
    }
  }
  return null;
}
