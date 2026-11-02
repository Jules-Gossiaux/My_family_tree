import type { Couple, GraphData, ParentChild, Person } from '../shared/types';

export const CARD_W = 148;
export const CARD_H = 64;
export const CARD_GAP = 10;
export const SIBLING_GAP = 30;
export const LEVEL_GAP = 84;
export const PAD = 48;

/** Entre deux rangées, quelques niveaux de ligne de raccord : deux familles ne se marchent pas dessus. */
const BUS_FIRST = 34;
const BUS_STEP = 12;
const BUS_LEVELS = 4;
/** Un bloc n'en bouscule pas une dizaine d'autres pour se rapprocher de ses parents. */
const MAX_PUSH = 3;
const SWEEPS = 6;

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
  /** Le rang : 0 = la génération la plus haute de la base. */
  generation: number;
}

export interface Edge {
  /** Le bloc d'où part le trait. */
  from: string;
  /** La personne dont la case reçoit le trait. */
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Hauteur de la ligne horizontale qui relie les deux traits. */
  mid: number;
}

/**
 * Un lien que le placement par générations ne peut pas suspendre en trait plein. Deux motifs :
 * `cycle` — le graphe n'est plus orienté (un ancêtre qui redevient descendant) ; `union` — les deux
 * époux tiennent chacun par leurs parents dans une rangée différente. Tout le reste, deux parents
 * non mariés comme des cousins germains unis, se dessine normalement.
 */
export interface CrossLink {
  kind: 'cycle' | 'union';
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LayoutResult {
  units: Unit[];
  byKey: Map<string, Unit>;
  unitByPerson: Map<string, string>;
  edges: Edge[];
  crossLinks: CrossLink[];
  width: number;
  height: number;
  personById: Map<string, Person>;
}

/** Un enfant et le point de chute de ses parents : jonction d'un couple, ou case d'un parent seul. */
interface Drop {
  unitKey: string;
  ax: number;
}

/** Une union dont les deux cases existent dans la base. */
interface Union {
  id: string;
  a: string;
  b: string;
}

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

const slotCenter = (w: number, index: number) => -w / 2 + index * (CARD_W + CARD_GAP) + CARD_W / 2;
const junctionCenter = (w: number, after: number) =>
  -w / 2 + (after + 1) * CARD_W + after * CARD_GAP + CARD_GAP / 2;

/**
 * Place les cases de l'arbre par générations.
 *
 * Chacun reçoit un rang : une génération sous ses parents. Les époux d'une même rangée tiennent dans
 * un seul bloc, [conjoint] [personne] [conjoint], et les enfants pendent sous la jonction du couple
 * dont ils sont issus — deux couples de parents donnent donc deux traits pleins qui se rejoignent
 * sur la même case.
 *
 * Le rang ne dépend pas de la personne de référence : la souche ne décide plus de la forme, elle sert
 * à poser le regard. Ce que la base contient et que ce modèle ne peut pas suspendre — une boucle, un
 * couple que ses parents séparent de deux rangées — reste dit, en pointillés.
 */
export function buildLayout(graph: GraphData): LayoutResult {
  const personById = new Map(graph.persons.map((p) => [p.id, p]));
  const ids = [...personById.keys()].sort(cmp);

  /** L'aîné d'abord : époux et frères se rangent par naissance connue, puis par identifiant. */
  const birthOf = (id: string) =>
    personById.get(id)?.birth?.min ?? personById.get(id)?.birth?.max ?? '';
  const byBirth = (x: string, y: string) => {
    const ux = birthOf(x);
    const uy = birthOf(y);
    if (ux !== uy) return !ux ? 1 : !uy ? -1 : ux < uy ? -1 : 1;
    return cmp(x, y);
  };

  const unions: Union[] = graph.couples
    .flatMap((couple: Couple): Union[] =>
      couple.partnerA &&
      couple.partnerB &&
      couple.partnerA !== couple.partnerB &&
      personById.has(couple.partnerA) &&
      personById.has(couple.partnerB)
        ? [{ id: couple.id, a: couple.partnerA, b: couple.partnerB }]
        : [],
    )
    .sort((x, y) => cmp(x.id, y.id));

  const links: ParentChild[] = graph.parentChild
    .filter((link) => personById.has(link.parentId) && personById.has(link.childId))
    .sort((x, y) => cmp(x.id, y.id));

  if (ids.length === 0) {
    return {
      units: [],
      byKey: new Map(),
      unitByPerson: new Map(),
      edges: [],
      crossLinks: [],
      width: 600,
      height: 400,
      personById,
    };
  }

  // 1. Casser les boucles d'abord : sans cela, les générations n'auraient pas de fin.
  const childrenOf = new Map<string, ParentChild[]>();
  for (const link of links) {
    const list = childrenOf.get(link.parentId) ?? [];
    list.push(link);
    childrenOf.set(link.parentId, list);
  }

  const broken = new Set<string>();
  const walked = new Map<string, 1 | 2>();
  function walk(id: string): void {
    walked.set(id, 1);
    for (const link of childrenOf.get(id) ?? []) {
      const state = walked.get(link.childId);
      if (state === 1) broken.add(link.id);
      else if (state === undefined) walk(link.childId);
    }
    walked.set(id, 2);
  }
  for (const id of ids) if (!walked.has(id)) walk(id);

  const kept = links.filter((link) => !broken.has(link.id));
  const parentsOf = new Map<string, string[]>();
  for (const link of kept) {
    const list = parentsOf.get(link.childId) ?? [];
    if (!list.includes(link.parentId)) list.push(link.parentId);
    parentsOf.set(link.childId, list);
  }

  // 2. Le rang de chacun : sous ses parents, et à côté de son époux quand rien ne l'y oblige autrement.
  const generation = new Map<string, number>(ids.map((id) => [id, 0]));
  const hasParentsHere = (id: string) => (parentsOf.get(id)?.length ?? 0) > 0;
  for (let pass = 0; pass < ids.length * 2 + 4; pass++) {
    let moved = false;
    for (const link of kept) {
      const below = (generation.get(link.parentId) ?? 0) + 1;
      if ((generation.get(link.childId) ?? 0) < below) {
        generation.set(link.childId, below);
        moved = true;
      }
    }
    for (const union of unions) {
      const ga = generation.get(union.a)!;
      const gb = generation.get(union.b)!;
      if (ga === gb) continue;
      const lower = ga < gb ? union.a : union.b;
      const higher = lower === union.a ? union.b : union.a;
      // Le conjoint qui n'a ni père ni mère dans la base épouse le rang de l'autre. Si les deux
      // tiennent par leurs parents, déplacer l'un déchirerait une lignée : l'union s'annoncera en
      // pointillés.
      if (hasParentsHere(lower)) continue;
      generation.set(lower, generation.get(higher)!);
      moved = true;
    }
    if (!moved) break;
  }
  const firstRank = Math.min(...ids.map((id) => generation.get(id)!));
  for (const id of ids) generation.set(id, generation.get(id)! - firstRank);

  // 3. Les blocs : un réseau de conjoints d'une même rangée tient dans une seule case groupée.
  const sameRankUnions = unions.filter(
    (union) => generation.get(union.a) === generation.get(union.b),
  );
  const partnersOf = new Map<string, Union[]>();
  for (const union of sameRankUnions) {
    for (const id of [union.a, union.b]) {
      const list = partnersOf.get(id) ?? [];
      list.push(union);
      partnersOf.set(id, list);
    }
  }

  const root = new Map<string, string>(ids.map((id) => [id, id]));
  function find(id: string): string {
    let current = id;
    while (root.get(current) !== current) current = root.get(current)!;
    let walker = id;
    while (walker !== current) {
      const next = root.get(walker)!;
      root.set(walker, current);
      walker = next;
    }
    return current;
  }
  for (const union of sameRankUnions) {
    const ra = find(union.a);
    const rb = find(union.b);
    if (ra === rb) continue;
    root.set(ra < rb ? ra : rb, ra < rb ? rb : ra);
  }

  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const key = find(id);
    const list = groups.get(key) ?? [];
    list.push(id);
    groups.set(key, list);
  }

  const units: Unit[] = [];
  const byKey = new Map<string, Unit>();
  const unitByPerson = new Map<string, string>();
  const junctionByCouple = new Map<string, { unitKey: string; after: number }>();
  const looseUnionPairs = new Set<string>();

  for (const members of [...groups.values()].sort((x, y) => cmp(x[0], y[0]))) {
    const ranked = [...members].sort(cmp);
    const anchor = [...ranked].sort(
      (x, y) =>
        (partnersOf.get(y)?.length ?? 0) - (partnersOf.get(x)?.length ?? 0) ||
        (childrenOf.get(y)?.length ?? 0) - (childrenOf.get(x)?.length ?? 0) ||
        byBirth(x, y),
    )[0];
    const others = ranked.filter((id) => id !== anchor).sort(byBirth);
    const leftCount = Math.floor(others.length / 2);
    const slots = [...others.slice(0, leftCount).reverse(), anchor, ...others.slice(leftCount)];
    const w = slots.length * CARD_W + (slots.length - 1) * CARD_GAP;

    const unit: Unit = {
      key: anchor,
      slots,
      junctions: [],
      x: 0,
      y: PAD + generation.get(anchor)! * (CARD_H + LEVEL_GAP),
      w,
      generation: generation.get(anchor)!,
    };
    units.push(unit);
    byKey.set(unit.key, unit);
    for (const slot of slots) unitByPerson.set(slot, unit.key);

    const junctions: Junction[] = [];
    for (const union of sameRankUnions) {
      if (!slots.includes(union.a)) continue;
      const ia = slots.indexOf(union.a);
      const ib = slots.indexOf(union.b);
      if (Math.abs(ia - ib) !== 1) {
        const [left, right] = union.a < union.b ? [union.a, union.b] : [union.b, union.a];
        looseUnionPairs.add(`${left}>${right}`);
        continue;
      }
      const after = Math.min(ia, ib);
      junctions.push({ coupleId: union.id, after });
      junctionByCouple.set(union.id, { unitKey: unit.key, after });
    }
    unit.junctions = junctions.sort((x, y) => x.after - y.after);
  }

  for (const union of unions) {
    if (junctionByCouple.has(union.id)) continue;
    const [left, right] = union.a < union.b ? [union.a, union.b] : [union.b, union.a];
    looseUnionPairs.add(`${left}>${right}`);
  }

  function cardCenter(personId: string): { x: number; y: number } | null {
    const key = unitByPerson.get(personId);
    const unit = key ? byKey.get(key) : undefined;
    if (!unit) return null;
    const index = unit.slots.indexOf(personId);
    if (index < 0) return { x: unit.x, y: unit.y };
    return { x: unit.x + slotCenter(unit.w, index), y: unit.y };
  }

  // 4. Les points de chute : un trait par enfant et par couple de parents, jamais deux.
  const linksByChild = new Map<string, ParentChild[]>();
  for (const link of kept) {
    const list = linksByChild.get(link.childId) ?? [];
    list.push(link);
    linksByChild.set(link.childId, list);
  }

  const dropsOf = new Map<string, Drop[]>();
  const neighbours = new Map<string, Set<string>>();
  const linkNeighbours = (a: string, b: string) => {
    if (a === b) return;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const list = neighbours.get(from) ?? new Set<string>();
      list.add(to);
      neighbours.set(from, list);
    }
  };

  for (const child of ids) {
    const childUnitKey = unitByPerson.get(child);
    if (!childUnitKey) continue;
    const anchors = new Map<string, Drop>();
    for (const link of linksByChild.get(child) ?? []) {
      const drawn = link.coupleId ? junctionByCouple.get(link.coupleId) : undefined;
      if (drawn) {
        const unit = byKey.get(drawn.unitKey)!;
        anchors.set(`c${link.coupleId}`, {
          unitKey: unit.key,
          ax: junctionCenter(unit.w, drawn.after),
        });
        continue;
      }
      const parentUnitKey = unitByPerson.get(link.parentId);
      const parentUnit = parentUnitKey ? byKey.get(parentUnitKey) : undefined;
      if (!parentUnit) continue;
      anchors.set(`p${link.parentId}`, {
        unitKey: parentUnit.key,
        ax: slotCenter(parentUnit.w, parentUnit.slots.indexOf(link.parentId)),
      });
    }
    if (anchors.size === 0) continue;
    dropsOf.set(
      child,
      [...anchors.entries()]
        .sort(([x], [y]) => cmp(x, y))
        .map(([, drop]) => drop),
    );
    for (const drop of dropsOf.get(child)!) linkNeighbours(childUnitKey, drop.unitKey);
  }

  // 5. Le rang de gauche à droite : les familles se regroupent, puis les enfants se suspendent.
  const maxGeneration = units.reduce((max, unit) => Math.max(max, unit.generation), 0);
  const seeded: Unit[][] = Array.from({ length: maxGeneration + 1 }, () => []);
  const seen = new Set<string>();
  for (const unit of [...units].sort((x, y) => cmp(x.key, y.key))) {
    if (seen.has(unit.key)) continue;
    const queue: Unit[] = [unit];
    seen.add(unit.key);
    while (queue.length > 0) {
      const current = queue.shift()!;
      seeded[current.generation].push(current);
      for (const key of [...(neighbours.get(current.key) ?? [])].sort(cmp)) {
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(byKey.get(key)!);
      }
    }
  }

  const want = new Map<string, number | null>();
  const computeWant = (unit: Unit) => {
    const xs: number[] = [];
    for (const slot of unit.slots) {
      for (const drop of dropsOf.get(slot) ?? []) {
        const parentUnit = byKey.get(drop.unitKey);
        if (parentUnit) xs.push(parentUnit.x + drop.ax);
      }
    }
    want.set(unit.key, xs.length === 0 ? null : xs.reduce((sum, x) => sum + x, 0) / xs.length);
  };

  const wantOf = (unit: Unit) => want.get(unit.key) ?? null;
  const sameTarget = (a: number | null, b: number | null) =>
    a === null ? b === null : b !== null && Math.abs(a - b) < 0.5;

  /** Suspend une rangée sous ses parents : les blocs qui partagent le même point de chute forment
   * un éventail centré sur lui, les autres suivent la file. */
  function packRow(row: Unit[]): void {
    let cursor = PAD;
    let index = 0;
    while (index < row.length) {
      const target = wantOf(row[index]);
      let end = index;
      while (end < row.length && sameTarget(wantOf(row[end]), target)) end++;
      const group = row.slice(index, end);
      const groupW =
        group.reduce((sum, unit) => sum + unit.w, 0) + (group.length - 1) * SIBLING_GAP;
      let x = target === null ? cursor : Math.max(cursor, target - groupW / 2);
      for (const unit of group) {
        unit.x = x + unit.w / 2;
        x += unit.w + SIBLING_GAP;
      }
      cursor = x;
      index = end;
    }
  }

  /** Le déplacement voulu, en poussant la chaîne de voisins quand elle cède assez tôt. */
  function planShift(row: Unit[], unit: Unit, delta: number): { index: number; x: number }[] | null {
    const start = row.indexOf(unit);
    if (start < 0) return null;
    const dir = delta > 0 ? 1 : -1;
    const moves = [{ index: start, x: unit.x + delta }];
    let lastIndex = start;
    let lastEdge = unit.x + delta + (dir * unit.w) / 2;
    for (let depth = 0; depth < MAX_PUSH; depth++) {
      const nextIndex = lastIndex + dir;
      if (nextIndex < 0 || nextIndex >= row.length) return moves;
      const next = row[nextIndex];
      const nextEdge = next.x - (dir * next.w) / 2;
      const free = dir > 0 ? nextEdge - lastEdge : lastEdge - nextEdge;
      if (free >= SIBLING_GAP) return moves;
      const push = SIBLING_GAP - free;
      const nx = next.x + push * dir;
      moves.push({ index: nextIndex, x: nx });
      lastIndex = nextIndex;
      lastEdge = nx + (dir * next.w) / 2;
    }
    return null;
  }

  function spreadRow(row: Unit[]): void {
    const dropCount = (unit: Unit) =>
      unit.slots.reduce((sum, slot) => sum + (dropsOf.get(slot)?.length ?? 0), 0);
    const ordered = row
      .filter((unit) => wantOf(unit) !== null)
      .sort((x, y) => dropCount(y) - dropCount(x) || x.x - y.x);
    for (const unit of ordered) {
      const target = wantOf(unit);
      if (target === null) continue;
      const delta = target - unit.x;
      if (Math.abs(delta) < 0.5) continue;
      const plan = planShift(row, unit, delta);
      if (plan) {
        for (const move of plan) row[move.index].x = move.x;
        continue;
      }
      // La chaîne tient : on s'arrête contre le voisin le plus proche.
      const index = row.indexOf(unit);
      const left =
        index > 0 ? row[index - 1].x + row[index - 1].w / 2 + SIBLING_GAP + unit.w / 2 : -Infinity;
      const right =
        index < row.length - 1
          ? row[index + 1].x - row[index + 1].w / 2 - SIBLING_GAP - unit.w / 2
          : Infinity;
      unit.x = Math.min(Math.max(unit.x + delta, left), right);
    }
  }

  for (const row of seeded) packRow(row);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (const row of seeded) {
      for (const unit of row) computeWant(unit);
      row.sort((x, y) => (wantOf(x) ?? x.x) - (wantOf(y) ?? y.x) || byBirth(x.key, y.key));
      packRow(row);
      spreadRow(row);
    }
  }

  const minX = Math.min(...units.map((unit) => unit.x - unit.w / 2));
  for (const unit of units) unit.x += PAD - minX;

  // 6. Les traits pleins, avec leur ligne de raccord partagée entre frères.
  const pendingEdges: {
    from: string;
    to: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[] = [];
  for (const child of ids) {
    const childUnitKey = unitByPerson.get(child);
    const childUnit = childUnitKey ? byKey.get(childUnitKey) : undefined;
    if (!childUnit) continue;
    for (const drop of dropsOf.get(child) ?? []) {
      const parentUnit = byKey.get(drop.unitKey);
      if (!parentUnit) continue;
      pendingEdges.push({
        from: parentUnit.key,
        to: child,
        x1: parentUnit.x + drop.ax,
        y1: parentUnit.y + CARD_H,
        x2: childUnit.x + slotCenter(childUnit.w, childUnit.slots.indexOf(child)),
        y2: childUnit.y,
      });
    }
  }

  const anchorsByGap = new Map<number, Map<string, number>>();
  for (const edge of pendingEdges) {
    const gap = anchorsByGap.get(edge.y1) ?? new Map<string, number>();
    const key = `${edge.from}|${edge.x1.toFixed(1)}`;
    if (!gap.has(key)) gap.set(key, edge.x1);
    anchorsByGap.set(edge.y1, gap);
  }
  const midByAnchor = new Map<string, number>();
  for (const [y1, gap] of anchorsByGap) {
    for (const [index, [key]] of [...gap.entries()].sort((x, y) => x[1] - y[1]).entries()) {
      midByAnchor.set(`${y1}|${key}`, y1 + BUS_FIRST + (index % BUS_LEVELS) * BUS_STEP);
    }
  }

  const edges: Edge[] = pendingEdges.map((edge) => ({
    ...edge,
    mid:
      midByAnchor.get(`${edge.y1}|${edge.from}|${edge.x1.toFixed(1)}`) ?? edge.y1 + BUS_FIRST,
  }));

  // 7. Ce que le placement ne peut pas suspendre reste dit, en pointillés.
  const pendingCross: { kind: CrossLink['kind']; fromId: string; toId: string }[] = [];
  const seenCross = new Set<string>();
  const addCross = (kind: CrossLink['kind'], fromId: string, toId: string) => {
    const key = `${kind}:${fromId}>${toId}`;
    if (seenCross.has(key)) return;
    seenCross.add(key);
    pendingCross.push({ kind, fromId, toId });
  };
  for (const link of links) {
    if (broken.has(link.id)) addCross('cycle', link.parentId, link.childId);
  }
  for (const pair of [...looseUnionPairs].sort(cmp)) {
    const [fromId, toId] = pair.split('>');
    addCross('union', fromId, toId);
  }

  const crossLinks: CrossLink[] = [];
  for (const link of pendingCross) {
    const from = cardCenter(link.fromId);
    const to = cardCenter(link.toId);
    if (!from || !to) continue;
    if (link.kind === 'union' && Math.abs(from.y - to.y) < 1) {
      // Deux cases de la même rangée : le trait relie leurs bords, à hauteur de carte.
      const left = from.x <= to.x ? from : to;
      const right = from.x <= to.x ? to : from;
      crossLinks.push({
        ...link,
        x1: left.x + CARD_W / 2,
        y1: left.y + CARD_H / 2,
        x2: right.x - CARD_W / 2,
        y2: right.y + CARD_H / 2,
      });
      continue;
    }
    crossLinks.push({ ...link, x1: from.x, y1: from.y + CARD_H, x2: to.x, y2: to.y });
  }

  const maxX = units.reduce((max, unit) => Math.max(max, unit.x + unit.w / 2), 0);
  const maxY = units.reduce((max, unit) => Math.max(max, unit.y + CARD_H), 0);

  return {
    units,
    byKey,
    unitByPerson,
    edges,
    crossLinks,
    width: Math.max(maxX + PAD, 600),
    height: Math.max(maxY + PAD, 400),
    personById,
  };
}
