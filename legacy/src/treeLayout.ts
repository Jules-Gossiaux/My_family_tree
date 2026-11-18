import type { Couple, GraphData, ParentChild, Person } from '../shared/types';

export const CARD_W = 148;
export const CARD_H = 64;
export const CARD_GAP = 10;
export const SIBLING_GAP = 30;
export const LEVEL_GAP = 84;
export const PAD = 48;

/** Entre deux rangées, la ligne de raccord des frères ; un cran plus bas pour les traits croisés. */
const BUS_FIRST = 34;
const BUS_STEP = 12;
/** Deux familles sans lien ne se collent pas l'une à l'autre. */
const FAMILY_GAP = SIBLING_GAP * 2;

export interface Junction {
  /** L'union déclarée, ou `null` quand un parent seul élève l'enfant. */
  coupleId: string | null;
  /** Pour une union : la case après laquelle tient la jonction. `-1` pour un parent seul. */
  after: number;
  /** Pour un parent seul : la case d'où descend le trait. */
  personId: string | null;
}

export interface Unit {
  key: string;
  slots: string[];
  junctions: Junction[];
  x: number;
  y: number;
  w: number;
  /** La rangée : 0 = la famille la plus haute, une de plus à chaque descendance. */
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
 * Un lien que l'arbre ne peut pas suspendre en trait plein. `cycle` : le graphe n'est plus orienté.
 * `union` : les deux époux tiennent déjà chacun dans une autre rangée.
 */
export interface CrossLink {
  kind: 'cycle' | 'union';
  fromId: string;
  toId: string;
  /** Le tracé complet, déjà décidé par le placement. */
  d: string;
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

interface Union {
  id: string;
  a: string;
  b: string;
}

interface Group {
  junction: Junction;
  children: Unit[];
}

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

const slotCenter = (w: number, index: number) => -w / 2 + index * (CARD_W + CARD_GAP) + CARD_W / 2;
const junctionCenter = (w: number, after: number) =>
  -w / 2 + (after + 1) * CARD_W + after * CARD_GAP + CARD_GAP / 2;

function junctionX(unit: Unit, junction: Junction): number {
  if (junction.coupleId) return junctionCenter(unit.w, junction.after);
  return slotCenter(unit.w, unit.slots.indexOf(junction.personId ?? ''));
}

/** Une courbe douce pour ce qui n'est pas une descendance : jamais l'angle droit d'un trait plein. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 1) {
    const bend = 38 * (x2 >= x1 ? 1 : -1);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }
  const bend = 44 * (y2 >= y1 ? 1 : -1);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

/**
 * Place l'arbre comme une descendance : chaque famille tient dans une rangée — [conjoint] [personne]
 * [conjoint] — et ses enfants pendent sous la jonction du couple, sur une barre de fratrie partagée.
 * Un conjoint sans parents dans la base se marie dans la rangée de l'autre ; s'il y tient par ses
 * parents, le trait de ses parents vient jusqu'à sa case — et il se range du côté de sa famille
 * d'origine, pour que ce trait ne traverse rien.
 *
 * Rien ne se recalcule globalement : l'ordre des frères et des familles ne dépend que des naissances
 * puis de l'ordre d'entrée dans la base, jamais de ce qui vient d'être ajouté. Ajouter une personne
 * insère sa case dans sa fratrie ou ouvre une famille à la suite ; ni les rangées ni les couples ne
 * se rebattent.
 */
export function buildLayout(graph: GraphData): LayoutResult {
  const personById = new Map(graph.persons.map((p) => [p.id, p]));
  const ids = [...personById.keys()].sort(cmp);

  const birthOf = (id: string) =>
    personById.get(id)?.birth?.min ?? personById.get(id)?.birth?.max ?? '';
  const createdOf = (id: string) => personById.get(id)?.createdAt ?? '';
  const byBirth = (x: string, y: string) => {
    const ux = birthOf(x);
    const uy = birthOf(y);
    if (ux !== uy) return !ux ? 1 : !uy ? -1 : ux < uy ? -1 : 1;
    // À naissance égale ou inconnue, l'ordre d'entrée dans la base décide : un uuid neuf ne se
    // glisse jamais devant les familles déjà rangées, il prend la suite.
    const cx = createdOf(x);
    const cy = createdOf(y);
    if (cx !== cy) return cx < cy ? -1 : 1;
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

  // 1. Casser les boucles : sans cela, la descendance n'aurait pas de fin.
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
  const hasParents = new Set(kept.map((link) => link.childId));

  // 2. Les rangées : une par personne qui tient par ses parents ou qui ouvre une famille ; les
  // conjoints s'y rangent à côté, jamais dans une case à eux au-dessus de l'arbre.
  const units: Unit[] = [];
  const byKey = new Map<string, Unit>();
  const unitByPerson = new Map<string, string>();
  const role = new Map<string, 'anchor' | 'spouse'>();

  function newUnit(anchor: string): Unit {
    const unit: Unit = {
      key: anchor,
      slots: [anchor],
      junctions: [],
      x: 0,
      y: 0,
      w: CARD_W,
      generation: 0,
    };
    units.push(unit);
    byKey.set(unit.key, unit);
    unitByPerson.set(anchor, unit.key);
    role.set(anchor, 'anchor');
    return unit;
  }

  function marry(unit: Unit, partner: string, newcomer: string): void {
    const index = unit.slots.indexOf(partner);
    unit.slots.splice(index + 1, 0, newcomer);
    unit.w = unit.slots.length * CARD_W + (unit.slots.length - 1) * CARD_GAP;
    unitByPerson.set(newcomer, unit.key);
    role.set(newcomer, 'spouse');
  }

  const crossUnions = new Set<string>();
  for (const union of unions) {
    const ua = unitByPerson.get(union.a);
    const ub = unitByPerson.get(union.b);
    if (ua && ub) {
      if (ua !== ub) crossUnions.add(union.id);
      continue;
    }
    if (ua || ub) {
      const placed = ua ? union.a : union.b;
      const newcomer = ua ? union.b : union.a;
      marry(byKey.get((ua ?? ub)!)!, placed, newcomer);
      continue;
    }
    // Celui qui tient par ses parents donne sa rangée ; l'autre s'y marie. À défaut, le premier
    // nommé dans l'union : un choix fixe, que l'ordre des tableaux ne retourne pas.
    const anchor = hasParents.has(union.a) ? union.a : hasParents.has(union.b) ? union.b : union.a;
    const unit = newUnit(anchor);
    marry(unit, anchor, anchor === union.a ? union.b : union.a);
  }
  for (const id of ids) if (!unitByPerson.has(id)) newUnit(id);

  // Des jonctions au trait, tout se recompose d'un bloc : le conjoint marié ailleurs peut devoir
  // changer de côté pour que le trait de ses parents ne traverse rien, et cela ne se sait qu'une
  // fois les familles posées.
  function compose(): { layout: LayoutResult; flips: Set<string> } {
    for (const unit of units) unit.junctions = [];

    // Les jonctions se lisent sur les cases voisines : une union dont les époux ne se touchent pas
    // dans la rangée reste dite en pointillés plutôt que dessinée de travers.
    const junctionByCouple = new Map<string, { unitKey: string; junction: Junction }>();
    for (const unit of units) {
      for (const union of unions) {
        const ia = unit.slots.indexOf(union.a);
        const ib = unit.slots.indexOf(union.b);
        if (ia < 0 || ib < 0) continue;
        if (Math.abs(ia - ib) !== 1) {
          crossUnions.add(union.id);
          continue;
        }
        const junction: Junction = { coupleId: union.id, after: Math.min(ia, ib), personId: null };
        unit.junctions.push(junction);
        junctionByCouple.set(union.id, { unitKey: unit.key, junction });
      }
      unit.junctions.sort((x, y) => x.after - y.after);
    }
    for (const union of unions) {
      if (!junctionByCouple.has(union.id) && !crossUnions.has(union.id)) crossUnions.add(union.id);
    }

    // Un parent seul élève aussi : sa jonction est sa propre case, sans trait de mariage.
    const junctionByParent = new Map<string, { unitKey: string; junction: Junction }>();
    function sourceOf(link: ParentChild): { unitKey: string; junction: Junction } {
      const drawn = link.coupleId ? junctionByCouple.get(link.coupleId) : undefined;
      if (drawn) return drawn;
      let single = junctionByParent.get(link.parentId);
      if (!single) {
        const unitKey = unitByPerson.get(link.parentId)!;
        const junction: Junction = { coupleId: null, after: -1, personId: link.parentId };
        byKey.get(unitKey)!.junctions.push(junction);
        single = { unitKey, junction };
        junctionByParent.set(link.parentId, single);
      }
      return single;
    }

    const sourcesByChild = new Map<string, { unitKey: string; junction: Junction }[]>();
    const childrenBySource = new Map<string, string[]>();
    for (const link of kept) {
      const source = sourceOf(link);
      const key = `${source.unitKey}|${source.junction.coupleId ?? source.junction.personId}`;
      const siblings = childrenBySource.get(key) ?? [];
      if (!siblings.includes(link.childId)) siblings.push(link.childId);
      childrenBySource.set(key, siblings);
      const sources = sourcesByChild.get(link.childId) ?? [];
      if (!sources.some((s) => s.unitKey === source.unitKey && s.junction === source.junction)) {
        sources.push(source);
      }
      sourcesByChild.set(link.childId, sources);
    }

    // 3. La descendance, rangée par rangée : chaque enfant tient sous la première jonction qui le
    // réclame ; les autres jonctions le rejoignent par un trait, sans le déplacer une seconde fois.
    const groupsOf = new Map<string, Group[]>();
    const settled = new Set<string>();
    function visit(unit: Unit, generation: number): void {
      if (settled.has(unit.key)) return;
      settled.add(unit.key);
      unit.generation = generation;
      unit.y = PAD + generation * (CARD_H + LEVEL_GAP);
      const groups: Group[] = [];
      for (const junction of unit.junctions) {
        const key = `${unit.key}|${junction.coupleId ?? junction.personId}`;
        const children = [...(childrenBySource.get(key) ?? [])].sort(byBirth);
        const group: Group = { junction, children: [] };
        for (const child of children) {
          if (role.get(child) === 'spouse') continue; // marié ailleurs : le trait de ses parents viendra
          const childUnit = byKey.get(unitByPerson.get(child)!)!;
          if (settled.has(childUnit.key)) continue; // un autre parent l'a déjà rangé
          visit(childUnit, generation + 1);
          group.children.push(childUnit);
        }
        if (group.children.length > 0) groups.push(group);
      }
      groupsOf.set(unit.key, groups);
    }

    const roots = units
      .filter((unit) => !hasParents.has(unit.key))
      .sort((x, y) => byBirth(x.key, y.key));
    for (const root of roots) visit(root, 0);
    for (const unit of [...units].sort((x, y) => cmp(x.key, y.key))) visit(unit, 0);

    // 4. La largeur d'une famille : sa rangée, ou l'étalement de ses descendants si celui-ci déborde.
    const widthOf = new Map<string, number>();
    function measure(unit: Unit): number {
      const known = widthOf.get(unit.key);
      if (known !== undefined) return known;
      const groups = groupsOf.get(unit.key) ?? [];
      const children = groups.flatMap((group) => group.children);
      const childrenW =
        children.reduce((sum, child) => sum + measure(child), 0) +
        Math.max(0, children.length - 1) * SIBLING_GAP;
      const w = Math.max(unit.w, childrenW);
      widthOf.set(unit.key, w);
      return w;
    }
    for (const unit of units) measure(unit);

    const cardX = new Map<string, number>();
    const positioned = new Set<string>();
    function place(unit: Unit, left: number): void {
      positioned.add(unit.key);
      const w = widthOf.get(unit.key)!;
      const rowLeft = left + (w - unit.w) / 2;
      unit.x = rowLeft + unit.w / 2;
      for (let index = 0; index < unit.slots.length; index++) {
        cardX.set(unit.slots[index], rowLeft + index * (CARD_W + CARD_GAP) + CARD_W / 2);
      }
      const groups = groupsOf.get(unit.key) ?? [];
      const children = groups.flatMap((group) => group.children);
      const childrenW =
        children.reduce((sum, child) => sum + widthOf.get(child.key)!, 0) +
        Math.max(0, children.length - 1) * SIBLING_GAP;
      // Les fratries se suivent sans se pousser : la barre de raccord fait le trajet jusqu'à la
      // jonction, plutôt que de déplacer une famille entière pour la centrer dessus.
      let cursor = left + (w - childrenW) / 2;
      for (const group of groups) {
        for (const child of group.children) {
          place(child, cursor);
          cursor += widthOf.get(child.key)! + SIBLING_GAP;
        }
      }
    }
    let cursor = PAD;
    for (const root of roots) {
      place(root, cursor);
      cursor += widthOf.get(root.key)! + FAMILY_GAP;
    }
    const placedRoots = new Set(roots.map((root) => root.key));
    for (const unit of [...units].sort((x, y) => cmp(x.key, y.key))) {
      if (placedRoots.has(unit.key) || positioned.has(unit.key)) continue;
      place(unit, cursor);
      cursor += widthOf.get(unit.key)! + FAMILY_GAP;
    }

    const minX = Math.min(...units.map((unit) => unit.x - unit.w / 2));
    for (const unit of units) unit.x += PAD - minX;
    for (const [id, x] of cardX) cardX.set(id, x + PAD - minX);

    // 5. Les traits pleins : une jonction, une barre de fratrie, un trait par enfant — l'enfant
    // marié ailleurs aussi : sa case reçoit le trait de ses parents comme celle d'un quelconque fils.
    const edges: Edge[] = [];
    for (const child of ids) {
      const childUnit = byKey.get(unitByPerson.get(child)!)!;
      const sources = sourcesByChild.get(child) ?? [];
      for (const [level, source] of sources.entries()) {
        const parentUnit = byKey.get(source.unitKey)!;
        edges.push({
          from: parentUnit.key,
          to: child,
          x1: parentUnit.x + junctionX(parentUnit, source.junction),
          y1: parentUnit.y + CARD_H,
          x2: cardX.get(child)!,
          y2: childUnit.y,
          mid: parentUnit.y + CARD_H + BUS_FIRST + level * BUS_STEP,
        });
      }
    }

    // 6. Ce que l'arbre ne suspend pas reste dit, en pointillés.
    const crossLinks: CrossLink[] = [];
    const seenCross = new Set<string>();
    function addCross(kind: CrossLink['kind'], fromId: string, toId: string, d: string): void {
      const key = `${kind}:${fromId}>${toId}`;
      if (seenCross.has(key)) return;
      seenCross.add(key);
      crossLinks.push({ kind, fromId, toId, d });
    }
    for (const link of links) {
      if (!broken.has(link.id)) continue;
      const px = cardX.get(link.parentId);
      const cx = cardX.get(link.childId);
      if (px === undefined || cx === undefined) continue;
      addCross(
        'cycle',
        link.parentId,
        link.childId,
        curve(px, byKey.get(unitByPerson.get(link.parentId)!)!.y + CARD_H, cx, byKey.get(unitByPerson.get(link.childId)!)!.y),
      );
    }
    for (const union of unions) {
      if (!crossUnions.has(union.id)) continue;
      const ua = byKey.get(unitByPerson.get(union.a)!)!;
      const ub = byKey.get(unitByPerson.get(union.b)!)!;
      const xa = cardX.get(union.a)!;
      const xb = cardX.get(union.b)!;
      const sameRow = Math.abs(ua.y - ub.y) < 1;
      const [left, right, fromId, toId] =
        xa <= xb ? [xa, xb, union.a, union.b] : [xb, xa, union.b, union.a];
      addCross(
        'union',
        fromId,
        toId,
        sameRow
          ? curve(left + CARD_W / 2, ua.y + CARD_H / 2, right - CARD_W / 2, ub.y + CARD_H / 2)
          : curve(xa, ua.y + CARD_H, xb, ub.y),
      );
    }

    const maxX = units.reduce((max, unit) => Math.max(max, unit.x + unit.w / 2), 0);
    const maxY = units.reduce((max, unit) => Math.max(max, unit.y + CARD_H), 0);

    const layout: LayoutResult = {
      units,
      byKey,
      unitByPerson,
      edges,
      crossLinks,
      width: Math.max(maxX + PAD, 600),
      height: Math.max(maxY + PAD, 400),
      personById,
    };

    // Le conjoint qui tient par ses parents se range du côté de sa famille d'origine : le trait
    // qui le rejoint tombe alors sur sa case sans passer par-dessus celle d'aucun autre.
    const flips = new Set<string>();
    for (const [id, sources] of sourcesByChild) {
      if (role.get(id) !== 'spouse') continue;
      const unit = byKey.get(unitByPerson.get(id)!)!;
      if (unit.slots.length !== 2) continue;
      const index = unit.slots.indexOf(id);
      const source = sources[0];
      const parentUnit = byKey.get(source.unitKey)!;
      const originX = parentUnit.x + junctionX(parentUnit, source.junction);
      const wantRight = originX > cardX.get(unit.slots[1 - index])!;
      if ((index === 0) === wantRight) flips.add(unit.key);
    }
    return { layout, flips };
  }

  const first = compose();
  if (first.flips.size === 0) return first.layout;
  for (const key of first.flips) byKey.get(key)!.slots.reverse();
  return compose().layout;
}
