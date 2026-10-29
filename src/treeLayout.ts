import type { Couple, GraphData, Person } from '../shared/types';

export const CARD_W = 148;
export const CARD_H = 64;
export const CARD_GAP = 10;
export const SIBLING_GAP = 30;
export const LEVEL_GAP = 76;
export const PAD = 48;

export interface Unit {
  key: string;
  personIds: string[];
  coupleId: string | null;
  x: number;
  y: number;
  w: number;
  depth: number;
  subtreeW: number;
  children: string[];
}

export interface Edge {
  from: string;
  to: string;
}

export interface LayoutResult {
  units: Unit[];
  byKey: Map<string, Unit>;
  unitByPerson: Map<string, string>;
  edges: Edge[];
  width: number;
  height: number;
  rootKeys: string[];
  personById: Map<string, Person>;
}

/**
 * Place les cases de l'arbre.
 *
 * Chaque « unité » est une personne seule ou un couple : c'est le couple qui porte les enfants,
 * pas l'individu. Le placement est un parcours post-ordre : chaque sous-arbre occupe une largeur
 * propre, le parent est centré au-dessus des enfants.
 */
export function buildLayout(graph: GraphData): LayoutResult {
  const personById = new Map(graph.persons.map((p) => [p.id, p]));

  const couplesByPerson = new Map<string, Couple[]>();
  for (const couple of graph.couples) {
    for (const pid of [couple.partnerA, couple.partnerB]) {
      if (!pid) continue;
      const list = couplesByPerson.get(pid) ?? [];
      list.push(couple);
      couplesByPerson.set(pid, list);
    }
  }

  const childrenByCouple = new Map<string, string[]>();
  const childrenByPerson = new Map<string, string[]>();
  for (const link of graph.parentChild) {
    if (!personById.has(link.childId)) continue;
    if (link.coupleId) {
      const list = childrenByCouple.get(link.coupleId) ?? [];
      if (!list.includes(link.childId)) list.push(link.childId);
      childrenByCouple.set(link.coupleId, list);
    } else {
      const list = childrenByPerson.get(link.parentId) ?? [];
      if (!list.includes(link.childId)) list.push(link.childId);
      childrenByPerson.set(link.parentId, list);
    }
  }

  const primaryCoupleOf = (personId: string): Couple | null => {
    const list = couplesByPerson.get(personId) ?? [];
    if (list.length === 0) return null;
    const withChildren = list.find((c) => (childrenByCouple.get(c.id) ?? []).length > 0);
    return withChildren ?? list[0];
  };

  const byKey = new Map<string, Unit>();
  const unitByPerson = new Map<string, string>();

  function makeUnit(personId: string, couple: Couple | null, visited: Set<string>): Unit {
    const key = couple ? couple.id : personId;
    const cached = byKey.get(key);
    if (cached) return cached;

    const personIds = [personId];
    if (couple) {
      const partnerId = couple.partnerA === personId ? couple.partnerB : couple.partnerA;
      if (partnerId && personById.has(partnerId)) personIds.push(partnerId);
    }

    const w = personIds.length === 2 ? CARD_W * 2 + CARD_GAP : CARD_W;
    const unit: Unit = {
      key,
      personIds,
      coupleId: couple?.id ?? null,
      x: 0,
      y: 0,
      w,
      depth: 0,
      subtreeW: w,
      children: [],
    };
    byKey.set(key, unit);
    for (const pid of personIds) {
      if (!unitByPerson.has(pid)) unitByPerson.set(pid, key);
    }

    const nextVisited = new Set(visited);
    for (const pid of personIds) nextVisited.add(pid);

    const childIds = couple
      ? [...(childrenByCouple.get(couple.id) ?? []), ...(childrenByPerson.get(personId) ?? [])]
      : (childrenByPerson.get(personId) ?? []);

    for (const childId of childIds) {
      if (nextVisited.has(childId)) continue;
      const childUnit = makeUnit(childId, primaryCoupleOf(childId), nextVisited);
      if (!unit.children.includes(childUnit.key)) unit.children.push(childUnit.key);
    }

    return unit;
  }

  const rootPersonId =
    graph.rootId && personById.has(graph.rootId)
      ? graph.rootId
      : (graph.persons.find((p) => !graph.parentChild.some((pc) => pc.childId === p.id))?.id ??
        graph.persons[0]?.id ??
        null);

  const rootKeys: string[] = [];
  if (rootPersonId) {
    const rootCouples = couplesByPerson.get(rootPersonId) ?? [];
    if (rootCouples.length > 0) {
      for (const couple of rootCouples) {
        const unit = makeUnit(rootPersonId, couple, new Set());
        if (!rootKeys.includes(unit.key)) rootKeys.push(unit.key);
      }
    } else {
      rootKeys.push(makeUnit(rootPersonId, null, new Set()).key);
    }
  }

  // Branches non rattachées : une personne sans lien connu doit rester visible,
  // sinon elle disparaît de l'arbre et semble perdue.
  const unattached = graph.persons.filter((person) => !unitByPerson.has(person.id));
  for (const person of unattached) {
    const personCouples = couplesByPerson.get(person.id) ?? [];
    if (personCouples.length > 0) {
      for (const couple of personCouples) {
        const unit = makeUnit(person.id, couple, new Set());
        if (!rootKeys.includes(unit.key)) rootKeys.push(unit.key);
      }
    } else {
      const unit = makeUnit(person.id, null, new Set());
      if (!rootKeys.includes(unit.key)) rootKeys.push(unit.key);
    }
  }

  function measure(key: string): number {
    const unit = byKey.get(key);
    if (!unit) return 0;
    let childrenW = 0;
    unit.children.forEach((childKey, index) => {
      childrenW += measure(childKey);
      if (index > 0) childrenW += SIBLING_GAP;
    });
    unit.subtreeW = Math.max(unit.w, childrenW);
    return unit.subtreeW;
  }

  function place(key: string, left: number, depth: number): void {
    const unit = byKey.get(key);
    if (!unit) return;
    unit.depth = depth;
    unit.y = PAD + depth * (CARD_H + LEVEL_GAP);
    unit.x = left + unit.subtreeW / 2;

    if (unit.children.length === 0) return;

    let childrenW = 0;
    unit.children.forEach((childKey, index) => {
      childrenW += byKey.get(childKey)?.subtreeW ?? 0;
      if (index > 0) childrenW += SIBLING_GAP;
    });

    let cursor = left + (unit.subtreeW - childrenW) / 2;
    for (const childKey of unit.children) {
      const child = byKey.get(childKey);
      place(childKey, cursor, depth + 1);
      cursor += (child?.subtreeW ?? 0) + SIBLING_GAP;
    }
  }

  let cursorX = PAD;
  for (const rootKey of rootKeys) {
    measure(rootKey);
    place(rootKey, cursorX, 0);
    cursorX += (byKey.get(rootKey)?.subtreeW ?? 0) + SIBLING_GAP * 2;
  }

  const units = [...byKey.values()];
  const edges: Edge[] = [];
  for (const unit of units) {
    for (const childKey of unit.children) edges.push({ from: unit.key, to: childKey });
  }

  const maxX = units.reduce((max, u) => Math.max(max, u.x + u.w / 2), 0);
  const maxY = units.reduce((max, u) => Math.max(max, u.y + CARD_H), 0);

  return {
    units,
    byKey,
    unitByPerson,
    edges,
    width: Math.max(maxX + PAD, 600),
    height: Math.max(maxY + PAD, 400),
    rootKeys,
    personById,
  };
}
