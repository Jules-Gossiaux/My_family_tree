import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_H, buildLayout, type CrossLink, type LayoutResult } from '../src/treeLayout';
import type { Couple, GraphData, ParentChild, Person } from '../shared/types';

function person(id: string, familyName = 'Nom'): Person {
  return {
    id,
    givenNames: id,
    familyName,
    birthName: null,
    sex: '?',
    living: true,
    summary: null,
    branchId: null,
    portraitMediaId: null,
    birth: null,
    death: null,
  };
}

function union(id: string, partnerA: string, partnerB: string): Couple {
  return { id, partnerA, partnerB, type: 'mariage', status: 'en_cours', start: null };
}

function link(
  id: string,
  parentId: string,
  childId: string,
  coupleId: string | null = null,
): ParentChild {
  return { id, parentId, childId, coupleId, nature: 'biologique' };
}

function graph(
  persons: Person[],
  couples: Couple[],
  parentChild: ParentChild[],
  rootId: string | null = null,
): GraphData {
  return { persons, couples, parentChild, rootId, dataDir: 'test' };
}

/** Toutes les cases dessinées : une personne ne doit y figurer qu'une fois. */
function drawn(layout: LayoutResult): string[] {
  return layout.units.flatMap((unit) => unit.slots);
}

function assertOneCardEach(layout: LayoutResult, data: GraphData): void {
  const slots = drawn(layout);
  assert.equal(new Set(slots).size, slots.length, 'une case par personne, jamais deux');
  assert.deepEqual(
    [...slots].sort(),
    [...data.persons.map((p) => p.id).sort()],
    'toute personne de la base a sa case',
  );
}

const cardsOf = (layout: LayoutResult, personId: string) =>
  layout.units.filter((unit) => unit.slots.includes(personId));

test('un cycle ne fait pas boucler la mise en page et se dessine en pointillés', () => {
  // Trois générations retombent sur leur point de départ : a engendre b, b engendre c,
  // et c se découvre parent de a. Le graphe n'est plus un arbre.
  const data = graph(
    [person('a', 'Gossiaux'), person('b', 'Gossiaux'), person('c', 'Dubois')],
    [],
    [link('1', 'a', 'b'), link('2', 'b', 'c'), link('3', 'c', 'a')],
    'a',
  );

  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 1);
  assert.equal(layout.crossLinks[0].kind, 'cycle');
  assert.deepEqual(
    { fromId: layout.crossLinks[0].fromId, toId: layout.crossLinks[0].toId },
    { fromId: 'c', toId: 'a' },
  );
});

test('un enfant de deux parents solos garde une case et rend le second lien visible', () => {
  // Paul et Marie ne déclarent jamais d'union : Luc est leur fils à tous les deux, dessiné une fois.
  const data = graph(
    [person('marie'), person('paul'), person('luc')],
    [],
    [link('1', 'paul', 'luc'), link('2', 'marie', 'luc')],
    'paul',
  );

  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(cardsOf(layout, 'luc').length, 1, 'Luc ne pend que sous un seul bloc');
  assert.equal(layout.edges.length, 1, 'un seul trait de descendance vers Luc');

  assert.equal(layout.crossLinks.length, 1);
  assert.equal(layout.crossLinks[0].kind, 'parent');
  assert.equal(layout.crossLinks[0].toId, 'luc');
  assert.equal(layout.crossLinks[0].fromId, 'marie', 'le parent resté sans trait est signalé');
});

test('un enfant hors souche pend sous un de ses parents au lieu de devenir sa propre racine', () => {
  // La base peut livrer Luc avant Paul et Marie : le croire isolé et le poser en racine
  // laisserait les deux parents sans descendance et rendrait les deux liens en pointillés.
  const data = graph(
    [person('robert'), person('luc'), person('marie'), person('paul')],
    [],
    [link('1', 'paul', 'luc'), link('2', 'marie', 'luc')],
    'robert',
  );

  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.rootKeys.length, 3, 'la souche, Marie et Paul — Luc n’est pas une racine de plus');

  const marieUnit = layout.byKey.get('marie');
  assert.ok(marieUnit);
  assert.deepEqual(marieUnit!.children, ['luc'], 'Marie attache Luc sous sa case');

  assert.equal(layout.crossLinks.length, 1, 'un seul parent reste sans trait');
  assert.equal(layout.crossLinks[0].kind, 'parent');
  assert.equal(layout.crossLinks[0].fromId, 'paul');
});

test('les deux bouts du trait transversal touchent les cases concernées', () => {
  const data = graph(
    [person('paul'), person('marie'), person('luc')],
    [],
    [link('1', 'paul', 'luc'), link('2', 'marie', 'luc')],
    'paul',
  );

  const layout = buildLayout(data);
  const cross = layout.crossLinks[0];

  const unitY = (personId: string) => {
    const key = layout.unitByPerson.get(personId);
    const unit = key ? layout.byKey.get(key) : undefined;
    assert.ok(unit, `${personId} a une case`);
    return unit!.y;
  };

  assert.equal(cross.y1, unitY(cross.fromId) + CARD_H, 'le trait part du bas de la case du parent');
  assert.equal(cross.y2, unitY(cross.toId), 'et rejoint le haut de la case de l’enfant');
});

test('deux cousins mariés restent une case chacun, dans un ordre ou dans l’autre', () => {
  // R, ses deux enfants S1 et S2, leurs deux enfants C1 et C2 qui se marient entre eux, et D.
  const persons = [person('r'), person('s1'), person('s2'), person('c1'), person('c2'), person('d')];
  const couples = [union('cousins', 'c1', 'c2')];
  const ascending = [
    link('1', 'r', 's1'),
    link('2', 'r', 's2'),
    link('3', 's1', 'c1'),
    link('4', 's2', 'c2'),
    link('5', 'c1', 'd', 'cousins'),
    link('6', 'c2', 'd', 'cousins'),
  ];

  for (const links of [ascending, [...ascending].reverse()]) {
    const data = graph(persons, couples, links, 'r');
    const layout = buildLayout(data);

    assertOneCardEach(layout, data);
    assert.equal(cardsOf(layout, 'c2').length, 1);
    assert.equal(cardsOf(layout, 'c1').length, 1);
    assert.equal(cardsOf(layout, 'd').length, 1);

    // Le lien que l'arbre ne peut pas placer : la descendance de l'un des deux cousins.
    const kinds = layout.crossLinks.map((cross: CrossLink) => cross.kind);
    assert.deepEqual(kinds, ['parent'], 'un seul lien signalé, et comme une descendance perdue');
  }
});

test('une personne déjà posée dans un bloc ne quitte pas son conjoint pour un autre bloc', () => {
  // B a deux unions : la première la dessine aux côtés de M, la seconde ne peut pas la redessiner
  // aux côtés de A. L'union reste dite, par un trait qui relie les deux cases sans les dupliquer.
  const data = graph(
    [person('r'), person('m'), person('a'), person('b')],
    [union('cm', 'm', 'b'), union('ca', 'a', 'b')],
    [link('1', 'r', 'm'), link('2', 'r', 'a')],
    'r',
  );

  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(cardsOf(layout, 'b').length, 1, 'B n’est dessiné qu’une fois');
  assert.deepEqual(
    layout.crossLinks.map((cross) => [cross.kind, cross.fromId, cross.toId]),
    [['union', 'a', 'b']],
    'la seconde union se dit une seule fois',
  );
  assert.equal(layout.crossLinks[0].y1, layout.crossLinks[0].y2, 'le trait reste à hauteur de case');
});

test('un enfant né du couple dessiné dans le bloc ne devient pas un lien transverse', () => {
  const data = graph(
    [person('paul'), person('marie'), person('luc')],
    [union('pm', 'paul', 'marie')],
    [link('1', 'paul', 'luc', 'pm'), link('2', 'marie', 'luc', 'pm')],
    'paul',
  );

  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 0);
  assert.equal(layout.edges.length, 1);
  const unit = layout.byKey.get('paul');
  assert.ok(unit);
  assert.deepEqual(unit!.junctions, [{ coupleId: 'pm', after: 0 }]);
  assert.equal(unit!.childOffset.get('luc'), 0, 'Luc pend sous la jonction du couple');
});

test('une personne sans lien reste visible à côté de l’arbre', () => {
  const data = graph(
    [person('paul'), person('luc'), person('cousine')],
    [],
    [link('1', 'paul', 'luc')],
    'paul',
  );

  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.rootKeys.length, 2, 'la branche non rattachée a sa propre racine');
  assert.equal(layout.crossLinks.length, 0);
});
