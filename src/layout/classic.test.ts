import { describe, expect, it } from 'vitest';
import { computeClassicLayout } from '../layout/classic';
import { structureKey } from '../layout/layout';
import { PERSON_H, PERSON_W, type LaidOutEdge } from '../layout/model';
import { family, couple, person } from '../test/factories';
import type { FamilyData } from '../domain/types';

function segments(edge: LaidOutEdge) {
  const parts: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }> = [];
  for (let i = 1; i < edge.points.length; i += 1) {
    parts.push({ a: edge.points[i - 1], b: edge.points[i] });
  }
  return parts;
}

/** Deux segments orthogonaux qui s'intersectent strictement. */
function crosses(
  one: { a: { x: number; y: number }; b: { x: number; y: number } },
  two: { a: { x: number; y: number }; b: { x: number; y: number } },
): boolean {
  const horizontal = (s: typeof one) => Math.abs(s.a.y - s.b.y) < 0.1;
  const vertical = (s: typeof one) => Math.abs(s.a.x - s.b.x) < 0.1;
  if (horizontal(one) === horizontal(two)) return false;
  const h = horizontal(one) ? one : two;
  const v = vertical(one) ? one : two;
  const x = Math.abs(v.a.x - v.b.x) < 0.1 ? v.a.x : NaN;
  const y = Math.abs(h.a.y - h.b.y) < 0.1 ? h.a.y : NaN;
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  const withinX = x > Math.min(h.a.x, h.b.x) + 0.5 && x < Math.max(h.a.x, h.b.x) - 0.5;
  const withinY = y > Math.min(v.a.y, v.b.y) + 0.5 && y < Math.max(v.a.y, v.b.y) - 0.5;
  return withinX && withinY;
}

function countCrossings(data: FamilyData): number {
  const layout = computeClassicLayout(data);
  const lines = layout.edges.flatMap(segments);
  let total = 0;
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (crosses(lines[i], lines[j])) total += 1;
    }
  }
  return total;
}

function countOverlaps(data: FamilyData): number {
  const layout = computeClassicLayout(data);
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

/** Un trait qui traverse l'INTÉRIEUR d'une carte (les extrémités sont permises). */
function countEdgeCardHits(data: FamilyData): number {
  const layout = computeClassicLayout(data);
  const cards = layout.nodes.filter((node) => node.kind === 'person');
  let total = 0;
  for (const edge of layout.edges) {
    for (const segment of segments(edge)) {
      const x1 = Math.min(segment.a.x, segment.b.x);
      const x2 = Math.max(segment.a.x, segment.b.x);
      const y1 = Math.min(segment.a.y, segment.b.y);
      const y2 = Math.max(segment.a.y, segment.b.y);
      for (const card of cards) {
        const overlapX =
          Math.min(x2, card.x + card.width - 2) - Math.max(x1, card.x + 2);
        const overlapY =
          Math.min(y2, card.y + card.height - 2) - Math.max(y1, card.y + 2);
        if (overlapX > 0.5 && overlapY > 0.5) total += 1;
      }
    }
  }
  return total;
}

describe('moteur de placement classique', () => {
  it('place chaque personne exactement une fois', () => {
    const a = person('A');
    const b = person('B');
    const c = person('C');
    const data = couple(family(a, b, c), a, b, [c.id]);
    const layout = computeClassicLayout(data);
    const cards = layout.nodes.filter((node) => node.kind === 'person');
    expect(cards.map((node) => node.refId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(cards.every((node) => node.width === PERSON_W && node.height === PERSON_H)).toBe(true);
  });

  it('est déterministe : deux calculs donnent le même résultat', () => {
    const a = person('A');
    const b = person('B');
    const c = person('C');
    const d = person('D');
    const data = couple(couple(family(a, b, c, d), a, b, [c.id]), c, d, []);
    expect(computeClassicLayout(data)).toEqual(computeClassicLayout(data));
  });

  it('ne fait pas se croiser les branches d’un cas réaliste', () => {
    const mother = person('Mireille');
    const father = person('Jules');
    const child = person('Christophe');
    const other = person('Willy');
    const otherWife = person('Jeanne');
    const grandchild = person('Anne-Catherine');
    let data = couple(
      couple(family(mother, father, child, other, otherWife, grandchild), mother, father, [child.id]),
      other,
      otherWife,
      [grandchild.id],
    );
    expect(countCrossings(data)).toBe(0);
    expect(countOverlaps(data)).toBe(0);
  });

  it('aligne un conjoint sans parents connus sur la rangée de son partenaire', () => {
    const mireille = person('Mireille');
    const jules = person('Jules');
    const christophe = person('Christophe');
    const anne = person('Anne-Catherine');
    const emma = person('Emma');
    const childOne = person('Jules');
    const childTwo = person('Ninon');
    let data = family(
      mireille,
      jules,
      christophe,
      anne,
      emma,
      childOne,
      childTwo,
    );
    data = couple(data, mireille, jules, [christophe.id]);
    // Anne-Catherine et Emma sont sœurs, mais leurs parents ne sont pas connus :
    // leur union de naissance n'a aucun partenaire. Anne-Catherine ne doit pas
    // rester une génération au-dessus de Christophe pour autant.
    data = {
      ...data,
      unions: [
        ...data.unions,
        {
          ...createUnionFor(null, null),
          children: [anne.id, emma.id].map((childId) => ({
            childId,
            linkA: 'unknown' as const,
            linkB: 'unknown' as const,
          })),
        },
      ],
    };
    data = couple(data, christophe, anne, [childOne.id, childTwo.id]);

    const layout = computeClassicLayout(data);
    const cardOf = (id: string) =>
      layout.nodes.find((node) => node.kind === 'person' && node.refId === id);
    expect(cardOf(anne.id)?.y).toBe(cardOf(christophe.id)?.y);
    expect(cardOf(emma.id)?.y).toBe(cardOf(anne.id)?.y);
    expect(countCrossings(data)).toBe(0);
    expect(countOverlaps(data)).toBe(0);
    expect(countEdgeCardHits(data)).toBe(0);
  });

  it('contourne les cartes quand deux conjoints restent à deux générations d’écart', () => {
    const great = person('Aïeul');
    const grand = person('Grand');
    const parent = person('Parent');
    const other = person('Autre parent');
    const child = person('Enfant');
    const root = person('Racine');
    const spouse = person('Conjoint');
    const data: FamilyData = {
      ...family(great, grand, parent, other, child, root, spouse),
      unions: [
        {
          ...createUnionFor(great.id, null),
          children: [{ childId: grand.id, linkA: 'biological', linkB: 'unknown' }],
        },
        {
          ...createUnionFor(grand.id, null),
          children: [{ childId: parent.id, linkA: 'biological', linkB: 'unknown' }],
        },
        {
          ...createUnionFor(parent.id, other.id),
          children: [{ childId: child.id, linkA: 'biological', linkB: 'biological' }],
        },
        {
          ...createUnionFor(root.id, null),
          children: [{ childId: spouse.id, linkA: 'biological', linkB: 'unknown' }],
        },
        createUnionFor(child.id, spouse.id),
      ],
    };

    // Les deux conjoints ont des parents connus : aucun ne peut être déplacé.
    // Leur trait doit donc contourner la rangée intermédiaire, sans la traverser.
    expect(countEdgeCardHits(data)).toBe(0);
    expect(countCrossings(data)).toBe(0);
    expect(countOverlaps(data)).toBe(0);
  });

  it('gère une fratrie large sans croisement', () => {
    const parent = person('Parent');
    const kids = Array.from({ length: 6 }, (_, i) => person(`Enfant ${i}`));
    const data = {
      ...family(parent, ...kids),
      unions: [parentalUnion(parent.id, kids.map((kid) => kid.id))],
    };
    expect(countCrossings(data)).toBe(0);
    expect(countOverlaps(data)).toBe(0);
  });

  it('gère des parents communs à deux fratries (demi-fratrie)', () => {
    const a = person('A');
    const b = person('B');
    const c = person('C');
    const d = person('D');
    const e = person('E');
    let data = couple(family(a, b, c, d, e), a, b, [c.id]);
    data = {
      ...data,
      unions: [
        ...data.unions,
        {
          ...createUnionFor(a.id, c.id),
          partnerBId: null,
          children: [{ childId: d.id, linkA: 'biological', linkB: 'unknown' }],
        },
      ],
    };
    expect(countCrossings(data)).toBe(0);
  });

  it('la clé de structure ignore les changements de texte', () => {
    const a = person('A');
    const before = family(a);
    const after = { ...before, persons: [{ ...a, firstName: 'AAA', birthDate: '1900' }] };
    expect(structureKey(before)).toBe(structureKey(after));
  });
});

function parentalUnion(parentId: string, childIds: string[]) {
  return {
    ...createUnionFor(parentId, null),
    children: childIds.map((childId) => ({
      childId,
      linkA: 'biological' as const,
      linkB: 'unknown' as const,
    })),
  };
}

function createUnionFor(a: string | null, b: string | null) {
  return {
    id: `union-${a}-${b}-${Math.random().toString(36).slice(2)}`,
    familyId: 'family-test',
    partnerAId: a,
    partnerBId: b,
    children: [],
    status: 'unknown' as const,
    isCurrent: true,
    createdAt: 'x',
    updatedAt: 'x',
  };
}
