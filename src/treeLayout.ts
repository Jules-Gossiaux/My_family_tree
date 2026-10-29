import type { Couple, GraphData, Person } from '../shared/types';

export const CARD_W = 148;
export const CARD_H = 64;
export const CARD_GAP = 10;
export const SIBLING_GAP = 30;
export const LEVEL_GAP = 84;
export const PAD = 48;

export interface Junction {
  coupleId: string;
  after: number;
}

export interface Unit {
  key: string;
  slots: string[];
  junctions: Junction[];
  x: number;
  y: number;
  w: number;
  depth: number;
  subtreeW: number;
  children: string[];
  childJunction: Map<string, number>;
}

export interface Edge {
  from: string;
  to: string;
  offset: number;
  bus: number;
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
 * Une personne = une seule case, jamais dupliquée. Ses conjoints sont dessinés dans le même
 * bloc, de part et d'autre : [conjoint] [personne] [conjoint]. Les enfants pendent sous la
 * jonction du couple dont ils sont issus, ce qui rend les demi-frères lisibles.
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

  const partnerOf = (couple: Couple, personId: string): string | null => {
    const other = couple.partnerA === personId ? couple.partnerB : couple.partnerA;
    return other && personById.has(other) ? other : null;
  };

  const byKey = new Map<string, Unit>();
  const unitByPerson = new Map<string, string>();

  function buildUnit(personId: string, visited: Set<string>): Unit {
    const cached = byKey.get(personId);
    if (cached) return cached;

    const couples = couplesByPerson.get(personId) ?? [];
    const hasChildren = (couple: Couple) => (childrenByCouple.get(couple.id) ?? []).length > 0;
    const ordered = [...couples].sort((a, b) => Number(hasChildren(b)) - Number(hasChildren(a)));

    const leftCouple = ordered.length > 1 ? ordered[ordered.length - 1] : null;
    const rightCouples = ordered.length > 1 ? ordered.slice(0, ordered.length - 1) : ordered;

    const slots: string[] = [];
    const junctions: Junction[] = [];

    if (leftCouple) {
      const partnerId = partnerOf(leftCouple, personId);
      if (partnerId) {
        slots.push(partnerId);
        junctions.push({ coupleId: leftCouple.id, after: 0 });
      }
    }
    slots.push(personId);

    for (const couple of rightCouples) {
      const partnerId = partnerOf(couple, personId);
      if (!partnerId) continue;
      junctions.push({ coupleId: couple.id, after: slots.length - 1 });
      slots.push(partnerId);
    }

    const w = slots.length * CARD_W + (slots.length - 1) * CARD_GAP;
    const children: string[] = [];
    const childJunction = new Map<string, number>();

    const unit: Unit = {
      key: personId,
      slots,
      junctions,
      x: 0,
      y: 0,
      w,
      depth: 0,
      subtreeW: w,
      children,
      childJunction,
    };

    byKey.set(personId, unit);
    for (const slot of slots) {
      if (!unitByPerson.has(slot)) unitByPerson.set(slot, personId);
    }

    const nextVisited = new Set(visited);
    for (const slot of slots) nextVisited.add(slot);

    junctions.forEach((junction, index) => {
      for (const childId of childrenByCouple.get(junction.coupleId) ?? []) {
        if (nextVisited.has(childId) || !personById.has(childId)) continue;
        if (children.includes(childId)) continue;
        children.push(childId);
        childJunction.set(childId, index);
      }
    });

    for (const childId of childrenByPerson.get(personId) ?? []) {
      if (nextVisited.has(childId) || !personById.has(childId)) continue;
      if (children.includes(childId)) continue;
      children.push(childId);
      childJunction.set(childId, -1);
    }

    for (const childId of children) buildUnit(childId, nextVisited);

    return unit;
  }

  const rootPersonId =
    graph.rootId && personById.has(graph.rootId)
      ? graph.rootId
      : (graph.persons.find((p) => !graph.parentChild.some((pc) => pc.childId === p.id))?.id ??
        graph.persons[0]?.id ??
        null);

  const rootKeys: string[] = [];
  if (rootPersonId) rootKeys.push(buildUnit(rootPersonId, new Set()).key);

  // Branches non rattachées : une personne sans lien connu doit rester visible.
  for (const person of graph.persons) {
    if (unitByPerson.has(person.id)) continue;
    const unit = buildUnit(person.id, new Set());
    if (!rootKeys.includes(unit.key)) rootKeys.push(unit.key);
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
    for (const childKey of unit.children) {
      const junctionIndex = unit.childJunction.get(childKey) ?? -1;
      let offset = 0;
      if (junctionIndex >= 0) {
        offset =
          -unit.w / 2 +
          (junctionIndex + 1) * CARD_W +
          junctionIndex * CARD_GAP +
          CARD_GAP / 2;
      }
      edges.push({
        from: unit.key,
        to: childKey,
        offset,
        bus: junctionIndex >= 0 ? junctionIndex * 14 : 0,
      });
    }
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
