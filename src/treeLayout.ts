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
  /** Sous quel trait horizontal l'enfant pend, en pixels depuis le centre du bloc. */
  childOffset: Map<string, number>;
}

export interface Edge {
  from: string;
  to: string;
  offset: number;
  bus: number;
}

/**
 * Un lien que la descendance ne peut pas dessiner. Trois motifs, tous réels :
 * `parent` — la case de l'enfant est déjà dessinée ailleurs (deux parents solos qui n'ont jamais
 * déclaré d'union, un conjoint dont les parents vivent aussi dans l'arbre) ;
 * `cycle` — le graphe n'est plus un arbre (deux cousins mariés, un ancêtre qui redevient
 * descendant) ; `union` — les deux membres d'un couple ont chacun leur case dans un autre bloc.
 */
export interface CrossLink {
  kind: 'parent' | 'cycle' | 'union';
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
  rootKeys: string[];
  personById: Map<string, Person>;
}

/** Un enfant et le parent qui l'a engendré : le trait transversal part d'une case précise. */
interface ChildRef {
  childId: string;
  parentId: string;
}

/**
 * Place les cases de l'arbre.
 *
 * Une personne = une seule case, jamais dupliquée. Ses conjoints sont dessinés dans le même
 * bloc, de part et d'autre : [conjoint] [personne] [conjoint]. Les enfants pendent sous la
 * jonction du couple dont ils sont issus, ce qui rend les demi-frères lisibles.
 *
 * Ce que cette règle empêche de dessiner — un second parent, une boucle, une union où chacun a
 * déjà sa place — ne disparaît pas pour autant : ces liens sortent dans `crossLinks` et se tracent
 * en pointillés. Les taire, ce serait faire croire que la famille ne les contient pas.
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

  // `(parent_id, child_id)` est unique en base : chaque lien parent-enfant entre une fois dans ces
  // listes, y compris quand deux parents se partagent le même enfant.
  const childrenByCouple = new Map<string, ChildRef[]>();
  const childrenByPerson = new Map<string, ChildRef[]>();
  for (const link of graph.parentChild) {
    if (!personById.has(link.childId) || !personById.has(link.parentId)) continue;
    const ref: ChildRef = { childId: link.childId, parentId: link.parentId };
    const target = link.coupleId ? childrenByCouple : childrenByPerson;
    const key = link.coupleId ?? link.parentId;
    const list = target.get(key) ?? [];
    list.push(ref);
    target.set(key, list);
  }

  const partnerOf = (couple: Couple, personId: string): string | null => {
    const other = couple.partnerA === personId ? couple.partnerB : couple.partnerA;
    return other && personById.has(other) ? other : null;
  };

  const byKey = new Map<string, Unit>();
  const unitByPerson = new Map<string, string>();
  /** Qui dessine la case de cette personne — ou, pour un enfant, qui l'a rattachée le premier. */
  const cardOwner = new Map<string, string>();
  /** Les liens parent-enfant déjà tirés vers un enfant, pour ne pas signaler une parenté deux fois. */
  const drawnLinks = new Map<string, Set<string>>();
  const crossKeys = new Set<string>();
  const pendingCross: { kind: CrossLink['kind']; fromId: string; toId: string }[] = [];

  function buildUnit(personId: string, visited: Set<string>): Unit {
    const cached = byKey.get(personId);
    if (cached) return cached;

    // Le long du chemin parcouru pour arriver ici : personne de ce chemin ne redescendra d'en bas.
    const nextVisited = new Set(visited);
    nextVisited.add(personId);

    const addCross = (kind: CrossLink['kind'], fromId: string, toId: string) => {
      const key = `${kind}:${fromId}>${toId}`;
      if (crossKeys.has(key)) return;
      crossKeys.add(key);
      pendingCross.push({ kind, fromId, toId });
    };

    const slots: string[] = [personId];
    const junctions: Junction[] = [];

    /**
     * Un conjoint qui entre dans la famille s'aligne dans le bloc. Un conjoint qui a déjà sa case
     * ailleurs — deux cousins mariés, un descendant qui reparaît dans une autre branche — n'est pas
     * dupliqué : l'union se dira par un trait discret.
     */
    const addPartner = (couple: Couple, side: 'left' | 'right') => {
      const partnerId = partnerOf(couple, personId);
      if (!partnerId || slots.includes(partnerId)) return;
      if (cardOwner.has(partnerId)) {
        const [first, second] = personId < partnerId ? [personId, partnerId] : [partnerId, personId];
        addCross('union', first, second);
        return;
      }
      if (side === 'left') {
        slots.unshift(partnerId);
        junctions.unshift({ coupleId: couple.id, after: 0 });
      } else {
        junctions.push({ coupleId: couple.id, after: slots.length - 1 });
        slots.push(partnerId);
      }
      nextVisited.add(partnerId);
    };

    const couples = couplesByPerson.get(personId) ?? [];
    const hasChildren = (couple: Couple) => (childrenByCouple.get(couple.id) ?? []).length > 0;
    const ordered = [...couples].sort((a, b) => Number(hasChildren(b)) - Number(hasChildren(a)));

    // Le conjoint à gauche n'existe que si trois cases tiennent dans le bloc.
    const leftCouple = ordered.length > 1 ? ordered[ordered.length - 1] : null;
    const rightCouples = ordered.length > 1 ? ordered.slice(0, ordered.length - 1) : ordered;

    if (leftCouple) addPartner(leftCouple, 'left');
    for (const couple of rightCouples) addPartner(couple, 'right');

    /** Les unions dessinées dans ce bloc ; les autres pendent sous la case du parent. */
    const jointCouples = new Set(junctions.map((junction) => junction.coupleId));

    const w = slots.length * CARD_W + (slots.length - 1) * CARD_GAP;
    const children: string[] = [];
    const childOffset = new Map<string, number>();

    /** Au milieu de la jointure de deux cases : les enfants nés d'une union. */
    const junctionOffset = (after: number) =>
      -w / 2 + (after + 1) * CARD_W + after * CARD_GAP + CARD_GAP / 2;
    /** Au centre d'une case : les enfants rattachés à un parent seul. */
    const slotOffset = (index: number) => -w / 2 + index * (CARD_W + CARD_GAP) + CARD_W / 2;

    /**
     * Un enfant ne se place qu'une fois. Le rattacher aussi au second bloc produirait deux cases de
     * la même personne et une largeur de sous-arbre comptée deux fois ; le taire effacerait un lien
     * que la base, elle, contient.
     */
    const claim = (childId: string, offset: number, parentId: string) => {
      const owner = cardOwner.get(childId);
      const drawn = drawnLinks.get(childId);
      if (owner === personId) {
        drawn?.add(parentId);
        return;
      }
      if (owner || nextVisited.has(childId)) {
        // Une boucle d'abord : « parent » se lit comme un oubli de déclaration, pas comme une erreur.
        if (!drawn?.has(parentId)) {
          addCross(nextVisited.has(childId) ? 'cycle' : 'parent', parentId, childId);
        }
        return;
      }
      cardOwner.set(childId, personId);
      children.push(childId);
      childOffset.set(childId, offset);
      drawnLinks.set(childId, new Set([parentId]));
    };

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
      childOffset,
    };

    byKey.set(personId, unit);
    for (const slot of slots) {
      if (!unitByPerson.has(slot)) unitByPerson.set(slot, personId);
      if (!cardOwner.has(slot)) cardOwner.set(slot, personId);
    }

    for (const junction of junctions) {
      for (const ref of childrenByCouple.get(junction.coupleId) ?? []) {
        claim(ref.childId, junctionOffset(junction.after), ref.parentId);
      }
    }

    // Enfant hors union, ou issu d'une union que ce bloc ne dessine pas : il pend sous la
    // case de son parent. L'inverse le ferait disparaître de l'arbre.
    slots.forEach((slotId, index) => {
      for (const ref of childrenByPerson.get(slotId) ?? []) {
        claim(ref.childId, slotOffset(index), slotId);
      }
      for (const couple of couplesByPerson.get(slotId) ?? []) {
        if (jointCouples.has(couple.id)) continue;
        for (const ref of childrenByCouple.get(couple.id) ?? []) {
          claim(ref.childId, slotOffset(index), ref.parentId);
        }
      }
    });

    for (const childId of children) buildUnit(childId, nextVisited);

    return unit;
  }

  /** Le parent qui dessinera cette personne sous sa case, s'il y en a un dans le graphe. */
  const knownParentOf = (personId: string): string | undefined =>
    graph.parentChild.find((pc) => pc.childId === personId && personById.has(pc.parentId))?.parentId;

  const rootPersonId =
    graph.rootId && personById.has(graph.rootId)
      ? graph.rootId
      : (graph.persons.find((p) => !knownParentOf(p.id))?.id ?? graph.persons[0]?.id ?? null);

  const rootKeys: string[] = [];
  if (rootPersonId) rootKeys.push(buildUnit(rootPersonId, new Set()).key);

  /**
   * Branches non rattachées : une personne que rien n'a encore dessinée doit rester visible, donc
   * devenir racine. Les sans-parent d'abord — prendre pour racine un enfant dont le parent est dans
   * la base volerait la descendance de ce parent et ferait ressortir le lien en pointillés.
   */
  const loose = [...graph.persons].sort(
    (a, b) => Number(Boolean(knownParentOf(a.id))) - Number(Boolean(knownParentOf(b.id))),
  );
  for (const person of loose) {
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
    // Une ligne de raccord par point d'accroche : deux traits au même niveau se croiseraient.
    const busByOffset = new Map<number, number>();
    for (const childKey of unit.children) {
      const offset = unit.childOffset.get(childKey) ?? 0;
      if (!busByOffset.has(offset)) busByOffset.set(offset, busByOffset.size * 14);
      edges.push({
        from: unit.key,
        to: childKey,
        offset,
        bus: busByOffset.get(offset) ?? 0,
      });
    }
  }

  const maxX = units.reduce((max, u) => Math.max(max, u.x + u.w / 2), 0);
  const maxY = units.reduce((max, u) => Math.max(max, u.y + CARD_H), 0);

  /** Le centre d'une case : un trait transversal s'accroche à son bord, pas au bloc entier. */
  function slotCenter(personId: string): { x: number; y: number } | null {
    const key = unitByPerson.get(personId);
    const unit = key ? byKey.get(key) : undefined;
    if (!unit) return null;
    const index = unit.slots.indexOf(personId);
    if (index < 0) return { x: unit.x, y: unit.y };
    return { x: unit.x - unit.w / 2 + index * (CARD_W + CARD_GAP) + CARD_W / 2, y: unit.y };
  }

  const crossLinks: CrossLink[] = [];
  for (const link of pendingCross) {
    const from = slotCenter(link.fromId);
    const to = slotCenter(link.toId);
    if (!from || !to) continue;
    if (link.kind === 'union') {
      // Deux cases côte à côte : le trait relie leurs bords, à hauteur de carte.
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
    // Un lien de parenté tombe du bas de la case du parent au haut de celle de l'enfant.
    crossLinks.push({ ...link, x1: from.x, y1: from.y + CARD_H, x2: to.x, y2: to.y });
  }

  return {
    units,
    byKey,
    unitByPerson,
    edges,
    crossLinks,
    width: Math.max(maxX + PAD, 600),
    height: Math.max(maxY + PAD, 400),
    rootKeys,
    personById,
  };
}
