import {
  UNION_STATUS_LABELS,
  dominantLink,
  isGhostUnion,
  personLabel,
  unionHasBiological,
  unionHasFiliation,
  unionPartnerIds,
  type FamilyData,
  type Id,
  type LinkType,
  type Person,
  type Union,
} from '../domain/types';
import {
  ALIGN_WEIGHTS,
  segmentStrategy,
  shouldCenter,
  type GroupingMode,
} from './grouping';
import {
  PERSON_H,
  PERSON_W,
  UNION_SIZE,
  type LaidOutEdge,
  type LaidOutNode,
  type OrderHint,
  type Point,
  type TreeLayout,
} from './model';
import { swapOrder } from './orderHints';

/**
 * Dessin généalogique classique, calculé sans ELK.
 *
 * Pourquoi : ELK route CHAQUE arête vers un nœud d'union. Il produit donc un
 * cercle + un faisceau de traits en L, là où la convention veut une courte
 * ligne entre les deux conjoints, UNE descente depuis son milieu, et une barre
 * horizontale qui alimente chaque enfant. Aucun réglage de Sugiyama ne peut
 * changer cette géométrie : elle est décidée par la forme du graphe.
 *
 * Ici la forme du graphe devient la famille elle-même :
 *  1. générations : union-find sur les SEULES fratries (fusionner aussi les
 *     conjoints propageait un mariage entre générations à toute une fratrie),
 *     puis relaxation monotone « enfant >= parent + 1 » ;
 *  2. chaque rangée est découpée en SEGMENTS rigides : bloc de fratrie
 *     contigu, conjoints aux extrémités ou collés selon le mode. Quand un
 *     conjoint « entrant » quitte sa fratrie pour rejoindre son partenaire,
 *     le reste de sa fratrie est RATTACHÉ au même segment : sinon la barre
 *     des parents traverserait tout l'arbre. La contiguïté est garantie par
 *     construction, pas par une pénalité d'optimiseur ;
 *  3. recentrage barycentrique : les segments sont réordonnés au barycentre
 *     de leurs parents/enfants (minimisation des croisements sur blocs),
 *     puis attirés vers le milieu de leurs couples parentaux et de leurs
 *     enfants. Une régression isotonique (PAVA) donne les positions qui
 *     minimisent le déplacement en respectant l'ordre et les espacements ;
 *  4. les traits sont générés directement : pastille d'union, ligne de couple,
 *     descente, barre de fratrie, petites verticales vers chaque enfant.
 *     CHAQUE union a son propre niveau de barre : deux barres qui se
 *     chevauchent en X ne partagent jamais la même hauteur, sinon elles
 *     fusionnent visuellement en une seule ligne et laissent croire que des
 *     enfants de couples différents sont frères et sœurs. Un couple séparé
 *     est routé dans une zone libre, jamais à travers une fiche.
 */

const PAD_X = 44;
const PAD_Y = 44;
/** Hauteur d'une génération : carte + espace réservé aux niveaux de barres. */
const ROW_STEP = 240;
/** Écart entre deux conjoints collés. */
const COUPLE_GAP = 26;
/** Écart entre deux membres d'une fratrie. */
const SIBLING_GAP = 46;
/** Écart entre deux segments (familles distinctes). */
const SEGMENT_GAP = 86;
/** Au-delà, une zone vide sépare deux familles : on la resserre. */
const MAX_EMPTY_GAP = 170;
const COMPACT_GAP = 110;
/** Barre de fratrie, juste au-dessus des cartes des enfants. */
const BAR_OFFSET = 46;
/** Écart vertical entre deux niveaux de barres qui se chevauchent. */
const LANE_STEP = 16;
/** Distance minimale en X pour que deux barres partagent un niveau. */
const LANE_GAP = 30;
/** Longueur minimale de la descente depuis la pastille d'union. */
const MIN_TRUNK = 20;
/** Bus sous la rangée pour un couple que l'on n'a pas pu coller. */
const BUS_OFFSET = 26;
const SWEEPS = 8;

interface ChildLink {
  id: Id;
  link: LinkType;
  former: boolean;
  biological: boolean;
}

interface UnionInfo {
  union: Union;
  index: number;
  partners: Id[];
  children: ChildLink[];
  /** Génération des partenaires (ou des enfants moins un). */
  generation: number;
  title: string;
}

/** Bloc rigide d'une rangée : on le déplace entier, jamais carte par carte. */
interface Segment {
  ids: Id[];
  gaps: number[];
  width: number;
  left: number;
  generation: number;
  /** Membres de la fratrie principale (point d'ancrage du centrage). */
  siblingIds: Id[];
  /**
   * Unions de naissance représentées dans le segment. Plusieurs après
   * rattachement de deux familles : le segment est alors attiré vers les DEUX
   * couples de parents, et non vers un seul.
   */
  birthUnions: UnionInfo[];
  partnerUnions: UnionInfo[];
  key: number[];
  /** Distance entre `left` et le milieu du bloc de fratrie. */
  anchorOffset: number;
}

const EMPTY_LAYOUT: TreeLayout = {
  nodes: [],
  edges: [],
  width: 0,
  height: 0,
};

const rowY = (generation: number): number => PAD_Y + generation * ROW_STEP;

function compareKeys(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/**
 * Régression isotonique (Pool Adjacent Violators). À partir de positions
 * souhaitées `desired`, donne les positions les plus proches au sens des
 * moindres carrés qui respectent l'ordre des segments et un écart minimal.
 * C'est ce qui remplace le « barycentre » d'ELK : on centre les enfants sous
 * leurs parents SANS jamais casser une fratrie ni faire chevaucher deux cartes.
 */
function solveRow(segments: Segment[], desired: number[]): number[] {
  const prefix: number[] = [];
  let offset = 0;
  for (const segment of segments) {
    prefix.push(offset);
    offset += segment.width + SEGMENT_GAP;
  }

  const reduced = desired.map((value, index) => value - prefix[index]);
  const blocks: Array<{ sum: number; count: number }> = [];
  for (const value of reduced) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length >= 2) {
      const previous = blocks[blocks.length - 2];
      const current = blocks[blocks.length - 1];
      if (previous.sum / previous.count <= current.sum / current.count + 1e-9) {
        break;
      }
      blocks.splice(blocks.length - 2, 2, {
        sum: previous.sum + current.sum,
        count: previous.count + current.count,
      });
    }
  }

  const solved: number[] = [];
  for (const block of blocks) {
    const mean = block.sum / block.count;
    for (let index = 0; index < block.count; index += 1) solved.push(mean);
  }
  return solved.map((value, index) => value + prefix[index]);
}

/**
 * Resserre les grandes zones vides entre deux familles déconnectées. On ne
 * modifie aucun ordre ni aucune distance interne : tout ce qui est à droite
 * d'un vide trop large glisse vers la gauche de la même valeur.
 */
function compactEmptyColumns(nodes: LaidOutNode[], edges: LaidOutEdge[]): void {
  const occupied: Array<[number, number]> = [];
  for (const node of nodes) {
    occupied.push([node.x - 4, node.x + node.width + 4]);
  }
  for (const edge of edges) {
    for (let index = 1; index < edge.points.length; index += 1) {
      const a = edge.points[index - 1];
      const b = edge.points[index];
      occupied.push([Math.min(a.x, b.x) - 2, Math.max(a.x, b.x) + 2]);
    }
  }
  if (occupied.length === 0) return;

  occupied.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of occupied) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }

  const gaps: Array<{ end: number; delta: number }> = [];
  for (let index = 1; index < merged.length; index += 1) {
    const start = merged[index - 1][1];
    const end = merged[index][0];
    if (end - start > MAX_EMPTY_GAP) {
      gaps.push({ end, delta: end - start - COMPACT_GAP });
    }
  }
  if (gaps.length === 0) return;

  const shiftFor = (x: number): number =>
    gaps.reduce((sum, gap) => sum + (x >= gap.end ? gap.delta : 0), 0);
  for (const node of nodes) node.x -= shiftFor(node.x);
  for (const edge of edges) {
    for (const point of edge.points) point.x -= shiftFor(point.x);
  }
}

function buildLayout(
  data: FamilyData,
  mode: GroupingMode,
  rootOrder: Id[],
  unionOrder: Id[],
  hints: OrderHint[],
  mergeByParentSide: boolean,
): TreeLayout {
  const persons = data.persons;
  if (persons.length === 0) return EMPTY_LAYOUT;

  const personById = new Map<Id, Person>(persons.map((p) => [p.id, p]));
  const personIndex = new Map<Id, number>(
    persons.map((person, index) => [person.id, index]),
  );
  const rootRank = new Map<Id, number>(
    rootOrder.map((id, index) => [id, index]),
  );

  /**
   * Graine d'ordre des personnes « racines » (sans union de naissance connue).
   * L'ordre vient d'une permutation générée côté appelant : au lieu de tester
   * seulement l'ordre naturel et son miroir, on explore toutes les familles
   * fondatrices possibles et on garde le dessin le plus lisible.
   */
  const keySeed = (id: Id): number => {
    const rank = rootRank.get(id);
    if (rank !== undefined) return rank;
    return personIndex.get(id) ?? 0;
  };
  const unionRank = new Map<Id, number>(
    unionOrder.map((id, index) => [id, index]),
  );
  const unions = data.unions
    .filter((union) => !isGhostUnion(union))
    .slice()
    .sort(
      (a, b) => (unionRank.get(a.id) ?? 0) - (unionRank.get(b.id) ?? 0),
    );

  const infos: UnionInfo[] = unions.map((union, index) => {
    const partners = unionPartnerIds(union).filter((id) => personIndex.has(id));
    const seen = new Set<Id>();
    const children: ChildLink[] = [];
    for (const child of union.children) {
      if (!unionHasFiliation(child)) continue;
      if (!personIndex.has(child.childId) || seen.has(child.childId)) continue;
      seen.add(child.childId);
      children.push({
        id: child.childId,
        link: dominantLink(child),
        former: !union.isCurrent,
        biological: unionHasBiological(child),
      });
    }

    const names = partners
      .map((id) => personById.get(id))
      .filter((person): person is Person => !!person)
      .map(personLabel)
      .join(' & ');
    const status = UNION_STATUS_LABELS[union.status];
    const title = [
      names ? `Union : ${names}` : 'Union : parents non renseignés',
      status !== 'Non renseigné' ? status : '',
      partners.length === 2
        ? union.isCurrent
          ? 'Union actuelle'
          : 'Union ancienne'
        : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return { union, index, partners, children, generation: 0, title };
  });

  // --- 1. Liens de parenté utiles au placement ---------------------------
  const birthUnion = new Map<Id, UnionInfo>();
  for (const info of infos) {
    for (const child of info.children) {
      const current = birthUnion.get(child.id);
      if (!current) {
        birthUnion.set(child.id, info);
        continue;
      }
      const currentIsBio =
        current.children.find((entry) => entry.id === child.id)?.biological ?? false;
      if (child.biological && !currentIsBio) birthUnion.set(child.id, info);
    }
  }

  /** Une filiation connue seulement si l'union de naissance a au moins un parent. */
  const hasKnownParents = (id: Id): boolean => {
    const birth = birthUnion.get(id);
    return !!birth && birth.partners.length > 0;
  };

  /** Vrai si `ancestor` figure parmi les parents (directs ou non) de `descendant`. */
  const isAncestor = (ancestor: Id, descendant: Id): boolean => {
    const stack: Id[] = [descendant];
    const seen = new Set<Id>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const birth = birthUnion.get(current);
      if (!birth) continue;
      for (const parent of birth.partners) {
        if (parent === ancestor) return true;
        stack.push(parent);
      }
    }
    return false;
  };

  const partnerUnions = new Map<Id, UnionInfo[]>();
  for (const info of infos) {
    for (const partner of info.partners) {
      const list = partnerUnions.get(partner) ?? [];
      list.push(info);
      partnerUnions.set(partner, list);
    }
  }

  const coupleSet = new Set<string>();
  for (const info of infos) {
    if (info.partners.length === 2) {
      coupleSet.add([...info.partners].sort().join('|'));
    }
  }
  const arePartners = (a: Id, b: Id): boolean =>
    coupleSet.has([a, b].sort().join('|'));

  // --- 2. Générations -----------------------------------------------------
  // On ne fusionne QUE les enfants d'une même union : une fratrie partage
  // forcément une rangée. Fusionner aussi les conjoints (comme le ferait un
  // graphe de couches) propageait une union entre deux générations à TOUTE la
  // fratrie : les enfants se retrouvaient alors deux rangées sous leurs parents.
  const dsuParent = new Map<Id, Id>(persons.map((p) => [p.id, p.id]));
  const find = (id: Id): Id => {
    let root = id;
    while (dsuParent.get(root) !== root) root = dsuParent.get(root)!;
    let current = id;
    while (current !== root) {
      const next = dsuParent.get(current)!;
      dsuParent.set(current, root);
      current = next;
    }
    return root;
  };
  const merge = (a: Id, b: Id): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) dsuParent.set(rb, ra);
  };
  for (const info of infos) {
    for (let index = 1; index < info.children.length; index += 1) {
      merge(info.children[0].id, info.children[index].id);
    }
  }

  const groupIndex = new Map<Id, number>();
  for (const person of persons) {
    const root = find(person.id);
    if (!groupIndex.has(root)) groupIndex.set(root, groupIndex.size);
  }
  const groupOf = (id: Id): number => groupIndex.get(find(id))!;
  const groupCount = groupIndex.size;

  /**
   * Relaxation monotone : enfant >= parent + 1, puis nivelage d'un conjoint
   * sans filiation connue sur la rangée de son partenaire (cas de Pierre Jacob
   * ou Willy Loriaux, « entrants » dans une autre famille). Les valeurs ne
   * font que monter : sur un arbre coherent c'est stabilisé en (profondeur+2)
   * passes, et le plafond borne les données contradictoires.
   */
  const groupGeneration = new Array<number>(groupCount).fill(0);
  const displayRow = new Map<Id, number>(persons.map((p) => [p.id, 0]));
  const maxPasses = Math.min(64, groupCount + 2);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;

    for (const info of infos) {
      if (!info.children.length || !info.partners.length) continue;
      let parentRow = 0;
      for (const partner of info.partners) {
        parentRow = Math.max(parentRow, displayRow.get(partner) ?? 0);
      }
      for (const child of info.children) {
        const group = groupOf(child.id);
        if (groupGeneration[group] < parentRow + 1) {
          groupGeneration[group] = parentRow + 1;
          changed = true;
        }
      }
    }

    for (const person of persons) {
      const row = groupGeneration[groupOf(person.id)];
      if ((displayRow.get(person.id) ?? 0) < row) {
        displayRow.set(person.id, row);
        changed = true;
      }
    }

    for (const info of infos) {
      if (info.partners.length < 2) continue;
      let row = 0;
      for (const partner of info.partners) {
        row = Math.max(row, displayRow.get(partner) ?? 0);
      }
      for (const partner of info.partners) {
        // Une personne dont les parents sont connus garde SA rangée : c'est
        // elle qui fait autorité, pas le conjoint externe. En revanche une
        // personne née d'une union « parents non renseignés » n'a aucun
        // ancrage générationnel : elle rejoint la rangée de son conjoint,
        // sinon un couple se retrouve à deux niveaux d'écart et son trait
        // passe sous les cartes intermédiaires (cas Anne-Catherine / Christophe).
        if (hasKnownParents(partner)) continue;
        if ((displayRow.get(partner) ?? 0) < row) {
          displayRow.set(partner, row);
          groupGeneration[groupOf(partner)] = Math.max(
            groupGeneration[groupOf(partner)],
            row,
          );
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  /**
   * Alignement global des conjoints.
   *
   * La relaxation ci-dessus laisse deux personnes mariées sur des rangées
   * différentes dès que chacune a des parents connus à des profondeurs
   * distinctes (une branche a des grands-parents, l'autre non). Le trait de
   * couple traverse alors une rangée et vient se superposer à la descente des
   * parents. On descend donc le conjoint le plus haut au niveau du plus bas,
   * avec toute sa fratrie, puis on resserre les parents vers leurs enfants
   * pour ne pas laisser de tronc traversant une rangée vide.
   *
   * Les rangées ne font que MONTER : chaque passe rapproche de la solution et
   * le plafond borne les données incohérentes (mariage entre générations).
   */
  const alignmentPasses = Math.min(128, groupCount * 2 + 4);
  for (let pass = 0; pass < alignmentPasses; pass += 1) {
    let changed = false;

    // Données contradictoires (mariage entre un ancêtre et son descendant) :
    // forcer l'égalité ferait grimper les rangées sans fin. On laisse la
    // relaxation normale traiter ce cas, et on borne les rangées.
    let highestRow = 0;
    for (const person of persons) {
      highestRow = Math.max(highestRow, displayRow.get(person.id) ?? 0);
    }
    if (highestRow > groupCount + 2) break;

    for (const info of infos) {
      if (info.partners.length < 2) continue;
      const [first, second] = info.partners;
      if (isAncestor(first, second) || isAncestor(second, first)) continue;
      let lowest = 0;
      for (const partner of info.partners) {
        lowest = Math.max(lowest, displayRow.get(partner) ?? 0);
      }
      for (const partner of info.partners) {
        if ((displayRow.get(partner) ?? 0) >= lowest) continue;
        displayRow.set(partner, lowest);
        const group = groupOf(partner);
        if (groupGeneration[group] < lowest) {
          groupGeneration[group] = lowest;
          changed = true;
        }
      }
    }

    // Les descendants suivent : un enfant reste strictement sous ses parents.
    for (const info of infos) {
      if (!info.children.length || !info.partners.length) continue;
      let parentRow = 0;
      for (const partner of info.partners) {
        parentRow = Math.max(parentRow, displayRow.get(partner) ?? 0);
      }
      for (const child of info.children) {
        const group = groupOf(child.id);
        if (groupGeneration[group] < parentRow + 1) {
          groupGeneration[group] = parentRow + 1;
          changed = true;
        }
      }
    }

    for (const person of persons) {
      const row = groupGeneration[groupOf(person.id)];
      if ((displayRow.get(person.id) ?? 0) < row) {
        displayRow.set(person.id, row);
        changed = true;
      }
    }

    // Resserrement : un parent descend au plus près de son enfant le plus
    // haut, sans jamais dépasser la rangée juste au-dessus.
    for (const info of infos) {
      if (!info.children.length || !info.partners.length) continue;
      let minChild = Number.POSITIVE_INFINITY;
      for (const child of info.children) {
        minChild = Math.min(minChild, displayRow.get(child.id) ?? 0);
      }
      if (!Number.isFinite(minChild)) continue;
      const target = minChild - 1;
      for (const partner of info.partners) {
        if ((displayRow.get(partner) ?? 0) >= target) continue;
        displayRow.set(partner, target);
        const group = groupOf(partner);
        if (groupGeneration[group] < target) {
          groupGeneration[group] = target;
          changed = true;
        }
      }
    }

    for (const person of persons) {
      const row = groupGeneration[groupOf(person.id)];
      if ((displayRow.get(person.id) ?? 0) < row) {
        displayRow.set(person.id, row);
        changed = true;
      }
    }

    if (!changed) break;
  }

  const generationOf = (id: Id): number => displayRow.get(id) ?? 0;
  let maxGeneration = 0;
  for (const person of persons) {
    maxGeneration = Math.max(maxGeneration, generationOf(person.id));
  }
  for (const info of infos) {
    let row = 0;
    for (const partner of info.partners) {
      row = Math.max(row, generationOf(partner));
    }
    info.generation = info.partners.length
      ? row
      : info.children.length
        ? Math.max(0, generationOf(info.children[0].id) - 1)
        : 0;
  }

  /** Clé d'ordre lexicographique : l'ordre des parents, puis le rang de naissance. */
  const keyMemo = new Map<Id, number[]>();
  const visiting = new Set<Id>();
  const keyOf = (id: Id): number[] => {
    const cached = keyMemo.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return [keySeed(id)];
    visiting.add(id);
    let result: number[];
    const birth = birthUnion.get(id);
    if (!birth) {
      result = [keySeed(id)];
    } else {
      const anchors = birth.partners.map(keyOf);
      anchors.sort(compareKeys);
      // Une union sans parent reste une fratrie comme les autres : elle prend
      // la place de son ordre de création, PAS une clé négative qui la ferait
      // passer avant toutes les vraies racines. Quand on supprimait l'unique
      // parent d'une famille, ses enfants sautaient brutalement à l'extrême
      // gauche de la génération et poussaient la famille voisine à droite.
      const base = anchors.length ? anchors[0] : [birth.index];
      const rank = birth.children.findIndex((child) => child.id === id);
      result = [...base, birth.index, Math.max(0, rank)];
    }
    visiting.delete(id);
    keyMemo.set(id, result);
    return result;
  };
  const minKey = (ids: Id[]): number[] =>
    ids.map(keyOf).sort(compareKeys)[0] ?? [0];

  /**
   * Clé de position approximative d'un COUPLE DE PARENTS : elle sert à décider
   * de quel côté d'un segment fusionné placer le bloc d'enfants d'une famille.
   * Pour un parent sans union de naissance (conjoint « entrant » comme Willy),
   * la place vient de la fratrie de son propre conjoint.
   */
  const parentRank = (info: UnionInfo): number[] => {
    const keys = info.partners.map((partner) => {
      if (birthUnion.has(partner)) return keyOf(partner);
      for (const other of partnerUnions.get(partner) ?? []) {
        for (const mate of other.partners) {
          if (mate !== partner && birthUnion.has(mate)) return keyOf(mate);
        }
      }
      return keyOf(partner);
    });
    keys.sort(compareKeys);
    return keys[0] ?? [0];
  };

  const byGeneration = new Map<number, Id[]>();
  for (const person of persons) {
    const generation = generationOf(person.id);
    const list = byGeneration.get(generation) ?? [];
    list.push(person.id);
    byGeneration.set(generation, list);
  }

  const childBearingUnions = (ids: Id[]): UnionInfo[] => {
    const result: UnionInfo[] = [];
    for (const info of infos) {
      if (!info.children.length) continue;
      if (info.partners.some((partner) => ids.includes(partner))) {
        result.push(info);
      }
    }
    return result;
  };

  /** Un segment doit connaître TOUTES les familles dont il porte des enfants. */
  const birthUnionsOf = (ids: Id[], initial: UnionInfo[] = []): UnionInfo[] => {
    const result = [...initial];
    for (const id of ids) {
      const birth = birthUnion.get(id);
      if (birth && !result.includes(birth)) result.push(birth);
    }
    return result;
  };

  const makeSegment = (
    ids: Id[],
    siblingIds: Id[],
    births: UnionInfo[],
    generation: number,
  ): Segment => {
    const gaps: number[] = [];
    for (let index = 0; index < ids.length - 1; index += 1) {
      gaps.push(arePartners(ids[index], ids[index + 1]) ? COUPLE_GAP : SIBLING_GAP);
    }
    const offsets: number[] = [];
    let cursor = 0;
    for (let index = 0; index < ids.length; index += 1) {
      offsets.push(cursor);
      cursor += PERSON_W + (gaps[index] ?? 0);
    }
    const ranks = siblingIds.map((id) => ids.indexOf(id)).filter((r) => r >= 0);
    const first = ranks.length ? Math.min(...ranks) : 0;
    const last = ranks.length ? Math.max(...ranks) : ids.length - 1;
    return {
      ids,
      gaps,
      // `gaps` a une entrée de moins que `ids` : aucun écart fictif à retirer.
      width: cursor,
      left: 0,
      generation,
      siblingIds,
      birthUnions: births,
      partnerUnions: childBearingUnions(ids),
      key: minKey(siblingIds.length ? siblingIds : ids),
      anchorOffset: (offsets[first] + offsets[last] + PERSON_W) / 2,
    };
  };

  /**
   * Applique les contraintes d'ordre à l'intérieur d'un segment. On reconstruit
   * le segment avec `makeSegment` pour recalculer les écarts (couple ou
   * fratrie), sa largeur et son point d'ancrage : sinon, après avoir inversé
   * deux conjoints, la barre du couple doit partir du bon milieu.
   */
  const applyIdHints = (segment: Segment): Segment => {
    if (hints.length === 0) return segment;
    const ids = [...segment.ids];
    for (let pass = 0; pass < hints.length * 2 + 2; pass += 1) {
      let changed = false;
      for (const hint of hints) {
        const first = ids.indexOf(hint.first);
        const second = ids.indexOf(hint.second);
        if (first >= 0 && second >= 0 && first > second) {
          ids.splice(first, 1);
          ids.splice(second, 0, hint.first);
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (ids.every((id, index) => id === segment.ids[index])) return segment;
    const rebuilt = makeSegment(
      ids,
      segment.siblingIds,
      segment.birthUnions,
      segment.generation,
    );
    rebuilt.key = segment.key;
    return rebuilt;
  };

  /** Ordre imposé entre deux segments distincts d'une même génération. */
  const hintSegmentOrder = (a: Segment, b: Segment): number => {
    for (const hint of hints) {
      if (a.ids.includes(hint.first) && b.ids.includes(hint.second)) return -1;
      if (a.ids.includes(hint.second) && b.ids.includes(hint.first)) return 1;
    }
    return 0;
  };

  const rows = new Map<number, Segment[]>();
  for (const [generation, rowIds] of byGeneration) {
    const used = new Set<Id>();

    /** Fratrie « naturelle » de chaque personne de la rangée. */
    const naturalBucket = new Map<Id, string>();
    const bucketCounts = new Map<string, number>();
    for (const id of rowIds) {
      const birth = birthUnion.get(id);
      if (!birth) continue;
      naturalBucket.set(id, birth.union.id);
      bucketCounts.set(
        birth.union.id,
        (bucketCounts.get(birth.union.id) ?? 0) + 1,
      );
    }
    const bucketSize = (id: Id): number => {
      const key = naturalBucket.get(id);
      return key ? (bucketCounts.get(key) ?? 0) : 0;
    };

    /**
     * Mariage entre deux familles : l'un des deux reste dans sa fratrie
     * (l'ancrage), l'autre devient « conjoint entrant » et rejoint le segment
     * de l'ancrage. C'est exactement ce que fait la maquette pour Willy
     * Loriaux, sorti de sa fratrie pour être collé à Jeanne-Françoise.
     * Sans cela, les deux époux restaient chacun sous leurs propres parents,
     * parfois à plusieurs milliers de pixels l'un de l'autre.
     */
    const incoming = new Map<Id, Id>();
    const anchors = new Set<Id>();
    for (const info of infos) {
      if (info.partners.length !== 2) continue;
      const [a, b] = info.partners;
      if (generationOf(a) !== generation || generationOf(b) !== generation) continue;
      // Remariage : l'un des deux est déjà « entrant » auprès d'un ancrage.
      // Son autre conjoint rejoint le MÊME segment au lieu d'être abandonné
      // à l'autre bout de la rangée (sinon : un trait de plusieurs milliers
      // de pixels pour une union sans enfant).
      if (incoming.has(a) || incoming.has(b)) {
        const attached = incoming.has(a) ? a : b;
        const free = incoming.has(a) ? b : a;
        // On rattache au conjoint déjà entrant, PAS à l'ancrage de la
        // fratrie : sinon l'ancien conjoint s'intercale entre les deux
        // époux actuels et le couple se retrouve séparé.
        if (!incoming.has(free) && !naturalBucket.has(free) && free !== attached) {
          incoming.set(free, attached);
        }
        continue;
      }
      let anchor: Id;
      let other: Id;
      const sizeA = bucketSize(a);
      const sizeB = bucketSize(b);
      if (sizeA > sizeB) [anchor, other] = [a, b];
      else if (sizeB > sizeA) [anchor, other] = [b, a];
      else if (compareKeys(keyOf(a), keyOf(b)) <= 0) [anchor, other] = [a, b];
      else [anchor, other] = [b, a];
      if (anchors.has(other)) {
        // L'autre est déjà l'ancrage d'une union : on inverse le rattachement.
        if (anchors.has(anchor) || incoming.has(anchor)) continue;
        [anchor, other] = [other, anchor];
      }
      anchors.add(anchor);
      incoming.set(other, anchor);
    }

    const canAttach = (memberId: Id, other: Id): boolean => {
      if (other === memberId || generationOf(other) !== generation) return false;
      if (used.has(other)) return false;
      if (incoming.get(other) === memberId) return true;
      return !naturalBucket.has(other) && !incoming.has(other);
    };

    /**
     * Ajoute les « entrants » dont l'ancrage est déjà dans le segment, sur le
     * côté EXTÉRIEUR du bloc de fratrie : jamais entre deux époux, jamais au
     * milieu des frères et sœurs.
     */
    const insertIncomingExtras = (ids: Id[], core: Id[]): Id[] => {
      const added: Id[] = [];
      for (const extra of rowIds) {
        if (used.has(extra) || ids.includes(extra)) continue;
        const target = incoming.get(extra);
        if (!target || !ids.includes(target)) continue;
        const coreNow = core
          .map((member) => ids.indexOf(member))
          .filter((position) => position >= 0);
        const first = coreNow.length ? Math.min(...coreNow) : 0;
        const last = coreNow.length ? Math.max(...coreNow) : ids.length - 1;
        const at = ids.indexOf(target);
        const position = at <= first ? at : at >= last ? at + 1 : last + 1;
        ids.splice(position, 0, extra);
        added.push(extra);
      }
      return added;
    };

    // Un « entrant » est retiré de sa fratrie d'origine : il sera placé dans
    // le segment de son ancrage.
    const buckets = new Map<string, { birth: UnionInfo; ids: Id[] }>();
    for (const id of rowIds) {
      if (incoming.has(id)) continue;
      const key = naturalBucket.get(id);
      if (!key) continue;
      const birth = birthUnion.get(id)!;
      const bucket = buckets.get(key) ?? { birth, ids: [] };
      bucket.ids.push(id);
      buckets.set(key, bucket);
    }

    const segments: Segment[] = [];
    for (const [, bucket] of buckets) {
      const ranks = new Map<Id, number>();
      bucket.birth.children.forEach((child, index) => ranks.set(child.id, index));
      const members = bucket.ids
        .filter((id) => !used.has(id))
        .sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0));
      if (members.length === 0) continue;

      const spouses: Array<{ id: Id; memberIndex: number }> = [];
      members.forEach((memberId, memberIndex) => {
        for (const info of partnerUnions.get(memberId) ?? []) {
          for (const other of info.partners) {
            if (!canAttach(memberId, other)) continue;
            if (members.includes(other)) continue;
            if (spouses.some((spouse) => spouse.id === other)) continue;
            spouses.push({ id: other, memberIndex });
          }
        }
      });

      let ids: Id[];
      if (segmentStrategy(mode, spouses.length) === 'siblings') {
        const half = members.length / 2;
        const left = spouses
          .filter((spouse) => spouse.memberIndex < half)
          .sort((a, b) => b.memberIndex - a.memberIndex)
          .map((spouse) => spouse.id);
        const right = spouses
          .filter((spouse) => spouse.memberIndex >= half)
          .sort((a, b) => a.memberIndex - b.memberIndex)
          .map((spouse) => spouse.id);
        ids = [...left, ...members, ...right];
      } else {
        ids = [];
        members.forEach((memberId, memberIndex) => {
          ids.push(memberId);
          for (const spouse of spouses) {
            if (spouse.memberIndex === memberIndex) ids.push(spouse.id);
          }
        });
      }

      // Un « entrant » peut être rattaché à un conjoint déjà présent dans le
      // segment (remariage) et non à un membre de la fratrie. Il garde sa
      // propre famille d'origine : sans elle, le recentrage ignorait ses
      // parents et la barre qui les relie traversait tout l'arbre.
      const extras = insertIncomingExtras(ids, members);

      ids.forEach((id) => used.add(id));
      segments.push(
        makeSegment(ids, members, birthUnionsOf(extras, [bucket.birth]), generation),
      );
    }

    // Racines et conjoints externes : chaque ancrage récupère ses « entrants ».
    const remaining = rowIds
      .filter((id) => !used.has(id))
      .sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
    const attachable = (anchorId: Id, other: Id): boolean =>
      other !== anchorId &&
      generationOf(other) === generation &&
      !used.has(other) &&
      (incoming.get(other) === anchorId ||
        (!incoming.has(other) && !naturalBucket.has(other)));

    for (const id of remaining) {
      if (used.has(id)) continue;
      const ids: Id[] = [id];
      for (const info of partnerUnions.get(id) ?? []) {
        for (const other of info.partners) {
          if (!attachable(id, other) || ids.includes(other)) continue;
          ids.push(other);
        }
      }
      ids.sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
      const extras: Id[] = [];
      for (const extra of rowIds) {
        if (used.has(extra) || ids.includes(extra)) continue;
        const target = incoming.get(extra);
        if (target && ids.includes(target)) {
          ids.splice(ids.indexOf(target) + 1, 0, extra);
          extras.push(extra);
        }
      }
      ids.forEach((member) => used.add(member));
      segments.push(makeSegment(ids, ids, birthUnionsOf(extras), generation));
    }

    // Filet de sécurité : aucune personne ne doit disparaître du dessin.
    for (const id of rowIds) {
      if (used.has(id)) continue;
      used.add(id);
      segments.push(makeSegment([id], [id], [], generation));
    }

    /**
     * Rattachement des fratries éclatées par un mariage.
     *
     * Quand Willy quitte sa fratrie pour être collé à Jeanne-Françoise, Michel
     * reste seul dans un segment qui, trié par clé généalogique, atterrit à
     * l'autre bout de la rangée : la barre de Maurice + Grany traverse alors
     * TOUT l'arbre. La maquette fait l'inverse, Michel est juste à gauche de
     * Willy. On fusionne les deux segments, du côté où se trouve l'entrant :
     * les deux fratries restent contiguës ET chaque couple reste collé.
     */
    const locate = (id: Id): number =>
      segments.findIndex((segment) => segment.ids.includes(id));

    let didMerge = true;
    let guard = 0;
    while (didMerge && guard < rowIds.length) {
      didMerge = false;
      guard += 1;
      for (const [other, anchor] of incoming) {
        if (!naturalBucket.has(other)) continue;
        const birth = birthUnion.get(other)!;
        const sibling = birth.children
          .map((entry) => entry.id)
          .find(
            (id) =>
              id !== other &&
              generationOf(id) === generation &&
              !incoming.has(id),
          );
        if (!sibling) continue;
        const satellite = locate(sibling);
        const target = locate(anchor);
        if (satellite < 0 || target < 0 || satellite === target) continue;

        const s = segments[satellite];
        const t = segments[target];
        const at = t.ids.indexOf(other);
        // L'entrant est-il plutôt au bord gauche ou au bord droit du segment ?
        const onLeft = at >= 0 && at < t.ids.length - 1 - at;
        let ids = onLeft ? [...s.ids, ...t.ids] : [...t.ids, ...s.ids];
        let siblings = onLeft
          ? [...s.siblingIds, ...t.siblingIds]
          : [...t.siblingIds, ...s.siblingIds];

        /**
         * Côté de chaque famille dans le segment fusionné. Après un mariage
         * entre deux familles placées aux deux bouts de la rangée parentale,
         * l'ordre naïf met le bloc d'enfants d'une famille DU CÔTÉ OPPOSÉ à
         * ses parents : chaque barre doit alors traverser le bloc de l'autre
         * famille, et les branches se croisent visiblement. On retourne le
         * segment quand c'est le cas, pour que chaque fratrie reste du côté
         * de son couple parental. Le prix est l'ordre de saisie À
         * L'INTÉRIEUR des deux blocs — secondaire devant la lisibilité, et
         * cette variante n'est retenue que si elle raccourcit les traits.
         */
        if (
          mergeByParentSide &&
          s.birthUnions.length === 1 &&
          t.birthUnions.length === 1 &&
          s.birthUnions[0] !== t.birthUnions[0]
        ) {
          const wantLeft =
            compareKeys(parentRank(s.birthUnions[0]), parentRank(t.birthUnions[0])) < 0;
          const block = [other, ...s.ids];
          const positions = block
            .map((id) => ids.indexOf(id))
            .filter((position) => position >= 0);
          if (positions.length > 0) {
            const mean =
              positions.reduce((sum, value) => sum + value, 0) / positions.length;
            const isLeft = mean < (ids.length - 1) / 2;
            if (isLeft !== wantLeft) {
              ids = [...ids].reverse();
              siblings = [...siblings].reverse();
            }
          }
        }

        const births = [...t.birthUnions];
        for (const info of s.birthUnions) {
          if (!births.includes(info)) births.push(info);
        }
        const replacement = makeSegment(ids, siblings, births, generation);
        replacement.key = compareKeys(s.key, t.key) <= 0 ? s.key : t.key;
        const first = Math.min(satellite, target);
        const last = Math.max(satellite, target);
        segments.splice(last, 1);
        segments.splice(first, 1, replacement);
        didMerge = true;
        break;
      }
    }

    for (let index = 0; index < segments.length; index += 1) {
      segments[index] = applyIdHints(segments[index]);
    }
    segments.sort(
      (a, b) => hintSegmentOrder(a, b) || compareKeys(a.key, b.key),
    );
    let cursor = 0;
    for (const segment of segments) {
      segment.left = cursor;
      cursor += segment.width + SEGMENT_GAP;
    }
    rows.set(generation, segments);
  }

  // --- 3. Recentrage barycentrique ---------------------------------------
  const cardLeft = new Map<Id, number>();
  const writeRow = (segments: Segment[]): void => {
    for (const segment of segments) {
      let cursor = segment.left;
      segment.ids.forEach((id, index) => {
        cardLeft.set(id, cursor);
        cursor += PERSON_W + (segment.gaps[index] ?? 0);
      });
    }
  };
  for (const segments of rows.values()) writeRow(segments);

  const centerOf = (ids: Id[]): number => {
    const known = ids.filter((id) => cardLeft.has(id));
    if (known.length === 0) return 0;
    return (
      known.reduce((sum, id) => sum + (cardLeft.get(id) ?? 0), 0) / known.length +
      PERSON_W / 2
    );
  };

  if (shouldCenter(mode)) {
    const weights = ALIGN_WEIGHTS[mode];
    const orderedGenerations = [...rows.keys()].sort((a, b) => a - b);
    for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
      const order =
        sweep % 2 === 0
          ? orderedGenerations
          : [...orderedGenerations].reverse();
      for (const generation of order) {
        const segments = rows.get(generation)!;
        /**
         * L'ordre des segments ne doit pas rester figé par l'ordre de saisie :
         * sinon une famille peut être à gauche à une génération et à droite à
         * la suivante, ce qui produit une barre de fratrie traversant tout
         * l'arbre. On réordonne les BLOCS (jamais les cartes à l'intérieur)
         * au barycentre de leurs parents et de leurs enfants : c'est une passe
         * de minimisation des croisements, appliquée à des fratries rigides.
         */
        if (segments.length > 1) {
          const barycenter = new Map<Segment, number>();
          for (const segment of segments) {
            const targets: number[] = [];
            for (const info of segment.birthUnions) {
              if (info.partners.length) targets.push(centerOf(info.partners));
            }
            for (const info of segment.partnerUnions) {
              targets.push(centerOf(info.children.map((child) => child.id)));
            }
            barycenter.set(
              segment,
              targets.length
                ? targets.reduce((sum, value) => sum + value, 0) / targets.length
                : segment.left + segment.anchorOffset,
            );
          }
          segments.sort(
            (a, b) =>
              hintSegmentOrder(a, b) ||
              barycenter.get(a)! - barycenter.get(b)! ||
              compareKeys(a.key, b.key),
          );
        }
        const desired = segments.map((segment) => {
          const anchor = segment.left + segment.anchorOffset;
          let sum = weights.self * anchor;
          let total = weights.self;

          const parentTargets = segment.birthUnions
            .filter((info) => info.partners.length)
            .map((info) => centerOf(info.partners));
          for (const target of parentTargets) {
            const weight = weights.parents / parentTargets.length;
            sum += weight * target;
            total += weight;
          }
          for (const info of segment.partnerUnions) {
            const target = centerOf(info.children.map((child) => child.id));
            sum += weights.children * target;
            total += weights.children;
          }
          const wanted = total > 0 ? sum / total : anchor;
          return wanted - segment.anchorOffset;
        });
        const solved = solveRow(segments, desired);
        segments.forEach((segment, index) => {
          segment.left = solved[index];
        });
        writeRow(segments);
      }
    }
  }

  // --- 4. Nœuds et géométrie des branches --------------------------------
  const nodes: LaidOutNode[] = persons.map((person) => ({
    key: `p:${person.id}`,
    kind: 'person',
    refId: person.id,
    x: cardLeft.get(person.id) ?? 0,
    y: rowY(generationOf(person.id)),
    width: PERSON_W,
    height: PERSON_H,
  }));

  const edges: LaidOutEdge[] = [];
  const addEdge = (
    id: string,
    kind: 'partner' | 'child',
    points: Point[],
    former: boolean,
    link?: LinkType,
    title?: string,
    lane?: number,
  ): void => {
    const length = points.reduce(
      (sum, point, index) =>
        index === 0
          ? 0
          : sum +
            Math.abs(point.x - points[index - 1].x) +
            Math.abs(point.y - points[index - 1].y),
      0,
    );
    if (length < 1) return;
    edges.push({ id, kind, points, former, link, title, lane });
  };
  const centerX = (id: Id): number => (cardLeft.get(id) ?? 0) + PERSON_W / 2;

  /** Une branche de filiation = une union, une pastille, UNE barre. */
  interface Branch {
    info: UnionInfo;
    former: boolean;
    dropX: number;
    dropStartY: number | null;
    /** Pastille décalée quand le trait de couple contourne une rangée. */
    dotY?: number;
    childrenTop: number;
    barStart: number;
    barEnd: number;
    barY: number;
    lane: number;
  }

  const branches: Branch[] = [];
  const dots: LaidOutNode[] = [];
  const addDot = (
    info: UnionInfo,
    x: number,
    y: number,
    former: boolean,
  ): void => {
    dots.push({
      key: `u:${info.union.id}`,
      kind: 'union',
      refId: info.union.id,
      x: x - UNION_SIZE / 2,
      y: y - UNION_SIZE / 2,
      width: UNION_SIZE,
      height: UNION_SIZE,
      title: info.title,
      former,
    });
  };

  for (const info of infos) {
    const former = !info.union.isCurrent;

    let dropX = 0;
    let dropStartY: number | null = null;
    let dotY: number | null = null;

    if (info.partners.length === 2) {
      const [left, right] = [...info.partners].sort(
        (a, b) => (cardLeft.get(a) ?? 0) - (cardLeft.get(b) ?? 0),
      );
      const leftCenter = centerX(left);
      const rightCenter = centerX(right);
      const leftTop = rowY(generationOf(left));
      const rightTop = rowY(generationOf(right));
      const sameRow = leftTop === rightTop;
      // Chaque conjoint part du bas de SA propre carte : une union entre deux
      // générations (cousinage éloigné) ne doit pas dessiner son trait sur la
      // mauvaise rangée.
      const leftBottom = leftTop + PERSON_H;
      const rightBottom = rightTop + PERSON_H;
      const rowIds = sameRow ? (byGeneration.get(generationOf(left)) ?? []) : [];
      const blocked = !sameRow || rowIds.some((id) => {
        if (id === left || id === right) return false;
        const x = centerX(id);
        return x > Math.min(leftCenter, rightCenter) && x < Math.max(leftCenter, rightCenter);
      });

      if (!blocked) {
        // Convention classique : court trait horizontal entre les deux cartes.
        const coupleY = leftTop + PERSON_H / 2;
        addEdge(
          `partner:${info.union.id}`,
          'partner',
          [
            { x: (cardLeft.get(left) ?? 0) + PERSON_W, y: coupleY },
            { x: cardLeft.get(right) ?? 0, y: coupleY },
          ],
          former,
          undefined,
          info.title,
        );
        dropStartY = coupleY;
        dropX = (leftCenter + rightCenter) / 2;
      } else {
        // Couple séparé (remariage, cousinage) : bus horizontal dans une zone
        // LIBRE. Sur une même rangée, on passe sous les cartes ; entre deux
        // générations voisines, on passe dans l'espace entre les rangées ;
        // entre deux générations ÉLOIGNÉES, on contourne par un couloir latéral
        // plutôt que de traverser la rangée intermédiaire (cas où un conjoint
        // n'a pas de parents renseignés et reste ainsi une génération au-dessus).
        const upperIsLeft = leftTop <= rightTop;
        const upperCenter = upperIsLeft ? leftCenter : rightCenter;
        const lowerCenter = upperIsLeft ? rightCenter : leftCenter;
        const upperBottom = Math.min(leftBottom, rightBottom);
        const lowerTop = Math.max(leftTop, rightTop);
        const lowerBottom = Math.max(leftBottom, rightBottom);
        const farApart = !sameRow && lowerTop - upperBottom > ROW_STEP;

        if (farApart) {
          const middle = persons.filter((candidate) => {
            const top = rowY(generationOf(candidate.id));
            return top > upperBottom && top + PERSON_H < lowerTop;
          });
          const minX = middle.length
            ? Math.min(...middle.map((candidate) => cardLeft.get(candidate.id) ?? 0))
            : Math.min(upperCenter, lowerCenter);
          const maxX = middle.length
            ? Math.max(
                ...middle.map(
                  (candidate) => (cardLeft.get(candidate.id) ?? 0) + PERSON_W,
                ),
              )
            : Math.max(upperCenter, lowerCenter);
          const leftCorridor = minX - 40;
          const rightCorridor = maxX + 40;
          const corridorX =
            Math.abs(leftCorridor - upperCenter) <=
            Math.abs(rightCorridor - upperCenter)
              ? leftCorridor
              : rightCorridor;
          addEdge(
            `partner:${info.union.id}`,
            'partner',
            [
              { x: upperCenter, y: upperBottom },
              { x: upperCenter, y: upperBottom + 12 },
              { x: corridorX, y: upperBottom + 12 },
              { x: corridorX, y: lowerTop - 12 },
              { x: lowerCenter, y: lowerTop - 12 },
              { x: lowerCenter, y: lowerTop },
            ],
            former,
            undefined,
            info.title,
          );
          // La pastille reste visible juste au-dessus de la carte basse. La
          // descente vers les enfants, elle, part du bas de cette carte pour
          // ne pas la traverser.
          dotY = lowerTop - 12;
          dropStartY = lowerBottom;
          dropX = lowerCenter;
        } else {
          const busY = sameRow
            ? leftBottom + BUS_OFFSET
            : Math.min(
                lowerTop - 12,
                upperBottom + Math.max(12, (lowerTop - upperBottom) / 2),
              );
          const startX = sameRow ? leftCenter : upperCenter;
          const endX = sameRow ? rightCenter : lowerCenter;
          addEdge(
            `partner:${info.union.id}`,
            'partner',
            [
              { x: startX, y: sameRow ? leftBottom : upperBottom },
              { x: startX, y: busY },
              { x: endX, y: busY },
              { x: endX, y: sameRow ? rightBottom : lowerTop },
            ],
            former,
            undefined,
            info.title,
          );
          dropStartY = sameRow ? busY : lowerBottom;
          dropX = sameRow ? (leftCenter + rightCenter) / 2 : lowerCenter;
        }
      }
    } else if (info.partners.length === 1) {
      dropX = centerX(info.partners[0]);
      dropStartY = rowY(generationOf(info.partners[0])) + PERSON_H;
    }

    // Une union sans enfant garde sa pastille : c'est elle qui dit « ce couple
    // existe », même quand aucune branche n'en part.
    if (info.children.length === 0) {
      const y = dotY ?? dropStartY;
      if (y !== null) addDot(info, dropX, y, former);
      continue;
    }

    const childCenters = info.children.map((child) => centerX(child.id));
    if (info.partners.length === 0) {
      dropX = childCenters.reduce((sum, x) => sum + x, 0) / childCenters.length;
    }
    const childrenTop = Math.min(
      ...info.children.map((child) => rowY(generationOf(child.id))),
    );
    branches.push({
      info,
      former,
      dropX,
      dropStartY,
      dotY: dotY ?? undefined,
      childrenTop,
      barStart: Math.min(dropX, ...childCenters),
      barEnd: Math.max(dropX, ...childCenters),
      barY: 0,
      lane: 0,
    });
  }

  /**
   * Répartition des niveaux. Avant, TOUTES les barres d'une génération étaient
   * à `childrenTop - BAR_OFFSET` : trois couples avec des enfants sur la même
   * rangée dessinaient une seule ligne continue, et l'arbre laissait croire
   * que ces enfants formaient une seule fratrie.
   *
   * On colore l'intervalle [barStart, barEnd] de chaque union : deux barres
   * qui se chevauchent en X reçoivent deux hauteurs distinctes. Les unions
   * éloignées peuvent partager un niveau sans jamais se toucher.
   */
  const byChildrenRow = new Map<number, Branch[]>();
  for (const branch of branches) {
    const list = byChildrenRow.get(branch.childrenTop) ?? [];
    list.push(branch);
    byChildrenRow.set(branch.childrenTop, list);
  }
  for (const [childrenTop, group] of byChildrenRow) {
    group.sort((a, b) => a.barStart - b.barStart || a.info.index - b.info.index);
    const laneEnds: number[] = [];
    for (const branch of group) {
      let lane = laneEnds.findIndex((end) => end + LANE_GAP < branch.barStart);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(Number.NEGATIVE_INFINITY);
      }
      laneEnds[lane] = Math.max(laneEnds[lane], branch.barEnd);
      branch.lane = lane;
    }

    const baseY = childrenTop - BAR_OFFSET;
    // Aucune barre ne peut remonter au-dessus de sa propre pastille.
    const minY = Math.max(
      ...group.map((branch) =>
        branch.dropStartY === null
          ? baseY - MIN_TRUNK
          : branch.dropStartY + MIN_TRUNK,
      ),
    );
    const maxLane = Math.max(...group.map((branch) => branch.lane));
    const step =
      maxLane > 0
        ? Math.max(3, Math.min(LANE_STEP, (baseY - minY) / maxLane))
        : LANE_STEP;
    for (const branch of group) {
      branch.barY = Math.max(
        baseY - branch.lane * step,
        branch.dropStartY === null
          ? Number.NEGATIVE_INFINITY
          : branch.dropStartY + MIN_TRUNK,
      );
    }
  }

  for (const branch of branches) {
    const { info, former, lane } = branch;
    const dotY = branch.dotY ?? branch.dropStartY ?? branch.barY;
    addDot(info, branch.dropX, dotY, former);

    if (branch.dropStartY !== null && branch.barY > branch.dropStartY + 1) {
      addEdge(
        `child:trunk:${info.union.id}`,
        'child',
        [
          { x: branch.dropX, y: branch.dropStartY },
          { x: branch.dropX, y: branch.barY },
        ],
        former,
        undefined,
        info.title,
        lane,
      );
    }
    addEdge(
      `child:bar:${info.union.id}`,
      'child',
      [
        { x: branch.barStart, y: branch.barY },
        { x: branch.barEnd, y: branch.barY },
      ],
      former,
      undefined,
      info.title,
      lane,
    );
    for (const child of info.children) {
      const x = centerX(child.id);
      addEdge(
        `child:${info.union.id}:${child.id}`,
        'child',
        [
          { x, y: branch.barY },
          { x, y: rowY(generationOf(child.id)) },
        ],
        former,
        child.link,
        undefined,
        lane,
      );
    }
  }

  nodes.push(...dots);
  compactEmptyColumns(nodes, edges);

  // --- 5. Cadrage ---------------------------------------------------------
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x + node.width);
  }
  for (const edge of edges) {
    for (const point of edge.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
    }
  }
  if (!Number.isFinite(minX)) return EMPTY_LAYOUT;

  const shiftX = PAD_X - minX;
  for (const node of nodes) node.x += shiftX;
  for (const edge of edges) {
    for (const point of edge.points) point.x += shiftX;
  }

  return {
    nodes,
    edges,
    width: maxX + shiftX + PAD_X,
    height: PAD_Y * 2 + maxGeneration * ROW_STEP + PERSON_H,
  };
}

/**
 * Coût géométrique d'un dessin. On ne regarde plus seulement la longueur des
 * traits : un arbre court mais dont les barres se chevauchent ou passent au-
 * dessus d'une famille étrangère est illisible. Les défauts sont comptés dans
 * un tuple lexicographique ; la longueur ne sert qu'à départager.
 */
function branchCost(layout: TreeLayout): number {
  let total = 0;
  for (const edge of layout.edges) {
    for (let index = 1; index < edge.points.length; index += 1) {
      total += Math.abs(edge.points[index].x - edge.points[index - 1].x);
    }
  }
  return total;
}

interface LineSegment {
  a: Point;
  b: Point;
}

function edgeLines(edge: LaidOutEdge): LineSegment[] {
  const parts: LineSegment[] = [];
  for (let index = 1; index < edge.points.length; index += 1) {
    parts.push({ a: edge.points[index - 1], b: edge.points[index] });
  }
  return parts;
}

function isHorizontal(line: LineSegment): boolean {
  return Math.abs(line.a.y - line.b.y) < 0.1;
}

function strictlyCrosses(one: LineSegment, two: LineSegment): boolean {
  if (isHorizontal(one) === isHorizontal(two)) return false;
  const horizontal = isHorizontal(one) ? one : two;
  const vertical = isHorizontal(one) ? two : one;
  const x = vertical.a.x;
  const y = horizontal.a.y;
  return (
    x > Math.min(horizontal.a.x, horizontal.b.x) + 0.5 &&
    x < Math.max(horizontal.a.x, horizontal.b.x) - 0.5 &&
    y > Math.min(vertical.a.y, vertical.b.y) + 0.5 &&
    y < Math.max(vertical.a.y, vertical.b.y) - 0.5
  );
}

function countCrossings(layout: TreeLayout): number {
  const lines = layout.edges.flatMap(edgeLines);
  let total = 0;
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (strictlyCrosses(lines[i], lines[j])) total += 1;
    }
  }
  return total;
}

function countEdgeCardHits(layout: TreeLayout): number {
  const cards = layout.nodes.filter((node) => node.kind === 'person');
  let total = 0;
  for (const edge of layout.edges) {
    for (const line of edgeLines(edge)) {
      const x1 = Math.min(line.a.x, line.b.x);
      const x2 = Math.max(line.a.x, line.b.x);
      const y1 = Math.min(line.a.y, line.b.y);
      const y2 = Math.max(line.a.y, line.b.y);
      for (const card of cards) {
        const hitX =
          Math.min(x2, card.x + card.width - 2) - Math.max(x1, card.x + 2);
        const hitY =
          Math.min(y2, card.y + card.height - 2) - Math.max(y1, card.y + 2);
        if (hitX > 0.5 && hitY > 0.5) total += 1;
      }
    }
  }
  return total;
}

function countCardOverlaps(layout: TreeLayout): number {
  const cards = layout.nodes.filter((node) => node.kind === 'person');
  let total = 0;
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i];
      const b = cards[j];
      if (
        a.x < b.x + b.width - 1 &&
        b.x < a.x + a.width - 1 &&
        a.y < b.y + b.height - 1 &&
        b.y < a.y + a.height - 1
      ) {
        total += 1;
      }
    }
  }
  return total;
}

/** Barres de fratrie qui se superposent ou surplombent une autre famille. */
function countBarAmbiguity(layout: TreeLayout, data: FamilyData): number {
  const bars = layout.edges.filter((edge) => edge.id.startsWith('child:bar:'));
  const cards = layout.nodes.filter((node) => node.kind === 'person');
  const childrenByUnion = new Map(
    data.unions.map((union) => [
      union.id,
      new Set(union.children.map((child) => child.childId)),
    ]),
  );
  const unionIdOf = (edge: LaidOutEdge): string =>
    edge.id.slice('child:bar:'.length);
  const rangeOf = (edge: LaidOutEdge): [number, number, number] => [
    Math.min(edge.points[0].x, edge.points[edge.points.length - 1].x),
    Math.max(edge.points[0].x, edge.points[edge.points.length - 1].x),
    edge.points[0].y,
  ];

  let total = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const [aStart, aEnd, aY] = rangeOf(bars[i]);
    for (let j = i + 1; j < bars.length; j += 1) {
      if (unionIdOf(bars[i]) === unionIdOf(bars[j])) continue;
      const [bStart, bEnd, bY] = rangeOf(bars[j]);
      if (Math.abs(aY - bY) > LANE_GAP) continue;
      total += Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
    }
    const ownChildren = childrenByUnion.get(unionIdOf(bars[i])) ?? new Set<Id>();
    for (const card of cards) {
      if (ownChildren.has(card.refId)) continue;
      const centerX = card.x + card.width / 2;
      if (centerX <= aStart + 1 || centerX >= aEnd - 1) continue;
      if (card.y <= aY || card.y - aY > ROW_STEP) continue;
      total += PERSON_W;
    }
  }
  return Math.round(total);
}

function layoutPenalty(layout: TreeLayout, data: FamilyData): number[] {
  return [
    countCrossings(layout),
    countEdgeCardHits(layout),
    countCardOverlaps(layout),
    countBarAmbiguity(layout, data),
    Math.round(branchCost(layout)),
  ];
}

function comparePenalties(a: number[], b: number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Un arbre n'a pas de gauche ni de droite « naturelle » : l'ordre des familles
 * fondatrices vient de l'ordre de saisie, or un mariage entre deux familles
 * opposées produit des barres qui traversent tout le dessin si les familles
 * sont dans le mauvais sens. Au lieu de se limiter au miroir des racines, on
 * explore de nombreuses PERMUTATIONS des familles fondatrices × le côté des
 * familles dans les segments fusionnés, et on garde celle dont le dessin est
 * le plus lisible : aucun croisement, aucun trait sur une carte, aucune barre
 * ambiguë, puis seulement des traits courts. Déterministe : en cas d'égalité,
 * la première variante gagne.
 */

/** Nombre maximal d'ordres explorés pour chaque famille de permutations. */
const MAX_ROOT_ORDERS = 60;
const MAX_UNION_ORDERS = 8;

function orderCandidates(ids: Id[], limit: number): Id[][] {
  if (ids.length <= 1) return [[...ids]];
  const result: Id[][] = [];
  const seen = new Set<string>();
  const push = (order: Id[]) => {
    const key = order.join('\u0000');
    if (seen.has(key)) return;
    seen.add(key);
    result.push(order);
  };
  push([...ids]);
  push([...ids].reverse());
  const current: Id[] = [];
  const used = new Set<Id>();
  const walk = (): void => {
    if (result.length >= limit) return;
    if (current.length === ids.length) {
      push([...current]);
      return;
    }
    for (const id of ids) {
      if (used.has(id)) continue;
      used.add(id);
      current.push(id);
      walk();
      used.delete(id);
      current.pop();
      if (result.length >= limit) return;
    }
  };
  walk();
  return result;
}

/** Paires de cartes voisines dans une même rangée, candidates à un échange. */
function neighborPairs(layout: TreeLayout): Array<[Id, Id]> {
  const rows = new Map<number, LaidOutNode[]>();
  for (const node of layout.nodes) {
    if (node.kind !== 'person') continue;
    const row = rows.get(node.y) ?? [];
    row.push(node);
    rows.set(node.y, row);
  }
  const pairs: Array<[Id, Id]> = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let index = 0; index < row.length - 1; index += 1) {
      const gap = row[index + 1].x - (row[index].x + row[index].width);
      if (gap >= 0 && gap < 320) {
        pairs.push([row[index].refId, row[index + 1].refId]);
      }
    }
  }
  return pairs;
}

interface Variant {
  rootOrder: Id[];
  unionOrder: Id[];
  mergeByParentSide: boolean;
}

/**
 * Deux niveaux de recherche :
 *  1. on énumère les ordres de familles / d'unions / de fusion (voir plus haut) ;
 *  2. on part du meilleur dessin et on teste les échanges de DEUX VOISINS dans
 *     chaque rangée. C'est ce deuxième niveau qui permet l'échange tout simple
 *     « mettre Christophe à gauche d'Anne-Catherine » que l'énumération ne
 *     savait pas produire. Chaque échange accepté fait baisser strictement le
 *     score lexicographique, donc la boucle se termine toujours.
 */
export function computeClassicLayout(
  data: FamilyData,
  mode: GroupingMode = 'balanced',
  hints: OrderHint[] = [],
): TreeLayout {
  const childIds = new Set<Id>();
  for (const union of data.unions) {
    if (isGhostUnion(union)) continue;
    for (const child of union.children) {
      if (unionHasFiliation(child)) childIds.add(child.childId);
    }
  }
  const rootIds = data.persons
    .filter((person) => !childIds.has(person.id))
    .map((person) => person.id);
  const unionIds = data.unions
    .filter((union) => !isGhostUnion(union))
    .map((union) => union.id);

  let best: TreeLayout | null = null;
  let bestPenalty: number[] | null = null;
  let bestVariant: Variant | null = null;
  for (const rootOrder of orderCandidates(rootIds, MAX_ROOT_ORDERS)) {
    for (const unionOrder of orderCandidates(unionIds, MAX_UNION_ORDERS)) {
      for (const mergeByParentSide of [false, true]) {
        const candidate = buildLayout(
          data,
          mode,
          rootOrder,
          unionOrder,
          hints,
          mergeByParentSide,
        );
        const penalty = layoutPenalty(candidate, data);
        if (!bestPenalty || comparePenalties(penalty, bestPenalty) < 0) {
          bestPenalty = penalty;
          best = candidate;
          bestVariant = { rootOrder, unionOrder, mergeByParentSide };
        }
      }
    }
  }
  if (!best || !bestPenalty || !bestVariant) return EMPTY_LAYOUT;

  const MAX_LOCAL_PASSES = 8;
  const MAX_LOCAL_TRIALS = 120;
  let trials = 0;
  let workingHints = hints;
  let working = best;
  let workingPenalty = bestPenalty;

  for (let pass = 0; pass < MAX_LOCAL_PASSES && trials < MAX_LOCAL_TRIALS; pass += 1) {
    let improved = false;
    for (const [left, right] of neighborPairs(working)) {
      if (trials >= MAX_LOCAL_TRIALS) break;
      const swapped = swapOrder(workingHints, right, left);
      if (!swapped) continue;
      trials += 1;
      const candidate = buildLayout(
        data,
        mode,
        bestVariant.rootOrder,
        bestVariant.unionOrder,
        swapped,
        bestVariant.mergeByParentSide,
      );
      const penalty = layoutPenalty(candidate, data);
      if (comparePenalties(penalty, workingPenalty) < 0) {
        workingHints = swapped;
        working = candidate;
        workingPenalty = penalty;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return working;
}
