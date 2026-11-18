import { now } from './id';
import {
  freeSlot,
  pruneGhostUnions,
  touch,
  unionHasBiological,
  unionHasFiliation,
  unionPartnerIds,
  withLinkInSlot,
  withPartnerInSlot,
  type FamilyData,
  type Id,
  type LinkType,
  type Union,
  type UnionChild,
} from './types';

export interface ConflictEntry {
  union: Union;
  child: UnionChild;
}

/** Un enfant rattaché à plusieurs unions par un lien biologique. */
export interface FiliationConflict {
  childId: Id;
  entries: ConflictEntry[];
}

/**
 * Invariant du modèle : un enfant a au plus UNE union biologique.
 * Les liens adoptifs / légaux / beau-parent ne créent pas de conflit :
 * ce sont précisément les cas que le modèle typé doit pouvoir exprimer.
 */
export function findFiliationConflicts(data: FamilyData): FiliationConflict[] {
  const byChild = new Map<Id, ConflictEntry[]>();
  for (const union of data.unions) {
    for (const child of union.children) {
      if (!unionHasBiological(child)) continue;
      const list = byChild.get(child.childId) ?? [];
      list.push({ union, child });
      byChild.set(child.childId, list);
    }
  }
  return Array.from(byChild.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([childId, entries]) => ({ childId, entries }));
}

export type ConflictMode = 'complete' | 'step' | 'adoptive' | 'legal';

/**
 * Fusion : complète le slot vacant d'une union avec `parentId`, puis retire
 * les liaisons redondantes vers les enfants concernés. Le couple n'est jamais
 * dupliqué et les unions devenues inutiles sont écartées.
 *
 * C'est la même opération qui répare un arbre v1 et qui sert de réponse
 * « c'est le second parent → compléter l'union » lors d'un ajout.
 */
export function completeUnionWithParent(
  data: FamilyData,
  keepUnionId: Id,
  parentId: Id,
  childIds: Id[],
  link: LinkType = 'biological',
): FamilyData {
  const keep = data.unions.find((union) => union.id === keepUnionId);
  const slot = keep ? freeSlot(keep) : null;
  if (!keep || !slot) return data;
  if (unionPartnerIds(keep).includes(parentId)) return data;

  const affected = new Set(childIds);
  const completed = withPartnerInSlot(keep, slot, parentId);
  const completedPartners = unionPartnerIds(completed).slice().sort().join('|');

  const unions: Union[] = [];
  for (const union of data.unions) {
    if (union.id === keepUnionId) {
      unions.push({
        ...completed,
        children: union.children.map((child) =>
          affected.has(child.childId) &&
          child[slot === 'A' ? 'linkA' : 'linkB'] !== 'step' &&
          unionHasFiliation(child)
            ? withLinkInSlot(child, slot, link)
            : child,
        ),
        status: union.status === 'unknown' ? 'partnered' : union.status,
        isCurrent: true,
        updatedAt: now(),
      });
      continue;
    }

    const children = union.children.filter(
      (child) => !affected.has(child.childId),
    );
    if (children.length === 0) {
      const partners = unionPartnerIds(union).slice().sort().join('|');
      // Demi-union devenue vide, ou couple identique à celui qu'on vient de
      // compléter : c'est un nœud fantôme, on ne le garde pas.
      if (unionPartnerIds(union).length <= 1 || partners === completedPartners) {
        continue;
      }
    }
    unions.push(
      children.length === union.children.length
        ? union
        : { ...union, children, updatedAt: now() },
    );
  }

  return pruneGhostUnions(touch({ ...data, unions }));
}

/**
 * Résout un doublon existant (données migrées depuis la v1, imports, etc.).
 * `keepUnionId` est l'union considérée comme la filiation principale ; les
 * autres unions gardent leur existence de couple mais leur lien vers l'enfant
 * est transformé — jamais supprimé silencieusement.
 */
export function resolveFiliationConflict(
  data: FamilyData,
  childId: Id,
  keepUnionId: Id,
  mode: ConflictMode,
): FamilyData {
  const keep = data.unions.find((union) => union.id === keepUnionId);
  if (!keep) return data;
  const others = data.unions.filter(
    (union) =>
      union.id !== keepUnionId &&
      union.children.some(
        (child) => child.childId === childId && unionHasBiological(child),
      ),
  );
  if (others.length === 0) return data;

  if (mode === 'complete') {
    const keepPartners = unionPartnerIds(keep);
    const candidate = others
      .flatMap((union) => unionPartnerIds(union))
      .find((id) => !keepPartners.includes(id));
    if (!candidate || !freeSlot(keep)) return data;
    return completeUnionWithParent(data, keepUnionId, candidate, [childId]);
  }

  const unions = data.unions.map((union) => {
    if (!others.some((other) => other.id === union.id)) return union;
    return {
      ...union,
      children: union.children.map((child) =>
        child.childId === childId ? downgrade(child, mode) : child,
      ),
      updatedAt: now(),
    };
  });
  return pruneGhostUnions(touch({ ...data, unions }));
}

/** Transforme un lien biologique surnuméraire sans effacer le couple. */
function downgrade(child: UnionChild, mode: ConflictMode): UnionChild {
  if (mode === 'step') {
    return { ...child, linkA: 'step', linkB: 'step' };
  }
  const target: LinkType = mode === 'legal' ? 'legal' : 'adoptive';
  const convert = (link: LinkType): LinkType =>
    link === 'biological' ? target : link;
  return { ...child, linkA: convert(child.linkA), linkB: convert(child.linkB) };
}

/** Unions portant une filiation biologique pour cet enfant. */
export function biologicalUnionIds(data: FamilyData, childId: Id): Set<Id> {
  return new Set(
    data.unions
      .filter((union) =>
        union.children.some(
          (child) => child.childId === childId && unionHasBiological(child),
        ),
      )
      .map((union) => union.id),
  );
}

