import {
  isFiliationLink,
  linkOfPartner,
  unionPartnerIds,
  type FamilyData,
  type Id,
} from '../domain/types';
import {
  PERSON_H,
  PERSON_W,
  type LaidOutEdge,
  type LaidOutNode,
  type Point,
  type TreeLayout,
} from './model';

export type TreeViewMode = 'classic' | 'ancestors' | 'hourglass' | 'fan';

export const VIEW_LABELS: Record<TreeViewMode, string> = {
  classic: 'Arbre complet',
  ancestors: 'Ascendants',
  hourglass: 'Sablier',
  fan: 'Éventail',
};

export const VIEW_MODES = Object.keys(VIEW_LABELS) as TreeViewMode[];

export function isTreeViewMode(value: string | null): value is TreeViewMode {
  return !!value && VIEW_MODES.includes(value as TreeViewMode);
}

interface FamilyGraph {
  parents: Map<Id, Id[]>;
  children: Map<Id, Id[]>;
  spouses: Map<Id, Id[]>;
}

function graphOf(data: FamilyData): FamilyGraph {
  const parents = new Map<Id, Id[]>();
  const children = new Map<Id, Id[]>();
  const spouses = new Map<Id, Id[]>();
  const add = (map: Map<Id, Id[]>, from: Id, to: Id) => {
    const list = map.get(from) ?? [];
    if (!list.includes(to)) map.set(from, [...list, to]);
  };
  for (const union of data.unions) {
    const partners = unionPartnerIds(union);
    for (let i = 0; i < partners.length; i += 1) {
      for (let j = i + 1; j < partners.length; j += 1) {
        add(spouses, partners[i], partners[j]);
        add(spouses, partners[j], partners[i]);
      }
    }
    for (const child of union.children) {
      for (const parentId of partners) {
        if (!isFiliationLink(linkOfPartner(union, parentId, child) ?? 'step')) continue;
        add(parents, child.childId, parentId);
        add(children, parentId, child.childId);
      }
    }
  }
  return { parents, children, spouses };
}

function edge(id: string, points: Point[]): LaidOutEdge {
  return { id, kind: 'child', points };
}

function emptyLayout(): TreeLayout {
  return { nodes: [], edges: [], width: 0, height: 0 };
}

/**
 * Vues centrées sur une personne. Elles ne remplacent pas l'arbre global :
 * ce sont des lectures partielles, avec la même sémantique de filiation.
 */
export function computeFocusedView(
  data: FamilyData,
  mode: Exclude<TreeViewMode, 'classic'>,
  rootId: Id,
): TreeLayout {
  if (!data.persons.some((person) => person.id === rootId)) return emptyLayout();
  const graph = graphOf(data);
  const includeParents = mode === 'ancestors' || mode === 'hourglass';
  const includeChildren = mode === 'hourglass';

  if (mode === 'fan') {
    return computeFanLayout(graph, rootId);
  }

  const levels: Id[][] = [[rootId]];
  const seen = new Set<Id>([rootId]);
  const maxLevel = 5;
  for (let level = 0; level < maxLevel; level += 1) {
    const next: Id[] = [];
    for (const current of levels[levels.length - 1]) {
      const neighbors = [
        ...(includeParents ? (graph.parents.get(current) ?? []) : []),
        ...(includeChildren ? (graph.children.get(current) ?? []) : []),
      ];
      for (const id of neighbors) {
        if (!seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }
    }
    if (next.length === 0) break;
    levels.push(next);
  }

  const gapX = PERSON_W + 48;
  const gapY = PERSON_H + 90;
  const width = Math.max(...levels.map((level) => level.length)) * gapX + 60;
  const nodes: LaidOutNode[] = [];
  const edges: LaidOutEdge[] = [];
  const positions = new Map<Id, { x: number; y: number }>();

  levels.forEach((level, row) => {
    level.forEach((id, index) => {
      const x = (width - level.length * gapX) / 2 + index * gapX + 30;
      const y = 30 + row * gapY;
      positions.set(id, { x, y });
      nodes.push({
        key: `person:${id}`,
        kind: 'person',
        refId: id,
        x,
        y,
        width: PERSON_W,
        height: PERSON_H,
      });
    });
  });

  for (const [childId, parentIds] of graph.parents) {
    if (!positions.has(childId)) continue;
    for (const parentId of parentIds) {
      if (!positions.has(parentId)) continue;
      const child = positions.get(childId)!;
      const parent = positions.get(parentId)!;
      const fromY = parent.y + PERSON_H;
      const toY = child.y;
      const midY = (fromY + toY) / 2;
      const fromX = parent.x + PERSON_W / 2;
      const toX = child.x + PERSON_W / 2;
      edges.push(
        edge(`edge:${parentId}:${childId}`, [
          { x: fromX, y: fromY },
          { x: fromX, y: midY },
          { x: toX, y: midY },
          { x: toX, y: toY },
        ]),
      );
    }
  }

  return {
    nodes,
    edges,
    width,
    height: levels.length * gapY + 60,
  };
}

function computeFanLayout(
  graph: FamilyGraph,
  rootId: Id,
): TreeLayout {
  const seen = new Set<Id>([rootId]);
  const relatives = [...(graph.spouses.get(rootId) ?? [])];
  for (const id of relatives) seen.add(id);
  const nodes: LaidOutNode[] = [];
  const edges: LaidOutEdge[] = [];
  const radius = 260;
  const centerX = radius + PERSON_W / 2 + 40;
  const centerY = radius + PERSON_H / 2 + 40;

  const place = (id: Id, x: number, y: number) => {
    nodes.push({
      key: `person:${id}`,
      kind: 'person',
      refId: id,
      x,
      y,
      width: PERSON_W,
      height: PERSON_H,
    });
  };

  place(rootId, centerX - PERSON_W / 2, centerY - PERSON_H / 2);
  relatives.forEach((id, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, relatives.length);
    const x = centerX + Math.cos(angle) * radius - PERSON_W / 2;
    const y = centerY + Math.sin(angle) * radius - PERSON_H / 2;
    place(id, Math.max(20, x), Math.max(20, y));
    edges.push(
      edge(`spouse:${rootId}:${id}`, [
        { x: centerX, y: centerY },
        { x: x + PERSON_W / 2, y: y + PERSON_H / 2 },
      ]),
    );
  });

  return {
    nodes,
    edges,
    width: centerX * 2 + 40,
    height: centerY * 2 + 40,
  };
}
