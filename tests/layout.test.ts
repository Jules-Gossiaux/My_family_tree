import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_GAP,
  CARD_H,
  CARD_W,
  LEVEL_GAP,
  PAD,
  buildLayout,
  type LayoutResult,
  type Unit,
} from '../src/treeLayout';
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
  return { persons, couples, parentChild, branches: [], rootId, dataDir: 'test' };
}

interface Rect {
  personId: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
  centerX: number;
}

/** Toutes les cases dessinées : une personne ne doit y figurer qu'une fois. */
function drawn(layout: LayoutResult): string[] {
  return layout.units.flatMap((unit) => unit.slots);
}

function cards(layout: LayoutResult): Rect[] {
  return layout.units.flatMap((unit) =>
    unit.slots.map((personId, index) => {
      const x = unit.x - unit.w / 2 + index * (CARD_W + CARD_GAP);
      return {
        personId,
        x,
        y: unit.y,
        right: x + CARD_W,
        bottom: unit.y + CARD_H,
        centerX: x + CARD_W / 2,
      };
    }),
  );
}

function cardOf(layout: LayoutResult, personId: string): Rect {
  const card = cards(layout).find((rect) => rect.personId === personId);
  assert.ok(card, `${personId} a une case`);
  return card!;
}

function unitOf(layout: LayoutResult, personId: string): Unit {
  const key = layout.unitByPerson.get(personId);
  assert.ok(key, `${personId} est dessiné`);
  const unit = layout.byKey.get(key!);
  assert.ok(unit, `${personId} tient dans un bloc`);
  return unit!;
}

const genOf = (layout: LayoutResult, personId: string) => unitOf(layout, personId).generation;
const edgesTo = (layout: LayoutResult, personId: string) =>
  layout.edges.filter((edge) => edge.to === personId);

/** Où est posée chaque case : assez pour comparer deux mises en page entre elles. */
function positions(layout: LayoutResult): string[] {
  return cards(layout)
    .map((card) => `${card.personId}@${Math.round(card.x)},${Math.round(card.y)}`)
    .sort();
}

function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) < 0.5,
    `${message} (attendu ${expected}, obtenu ${actual})`,
  );
}

function assertOneCardEach(layout: LayoutResult, data: GraphData): void {
  const slots = drawn(layout);
  assert.equal(new Set(slots).size, slots.length, 'une case par personne, jamais deux');
  assert.deepEqual(
    [...slots].sort(),
    [...data.persons.map((p) => p.id).sort()],
    'toute personne de la base a sa case',
  );

  const rects = cards(layout);
  for (const rect of rects) {
    assert.ok(rect.x >= 0 && rect.y >= 0, `${rect.personId} reste dans le canevas`);
    assert.ok(
      rect.right <= layout.width && rect.bottom <= layout.height,
      `${rect.personId} tient dans la largeur et la hauteur annoncées`,
    );
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
      assert.ok(!overlap, `${a.personId} et ${b.personId} ne se chevauchent pas`);
    }
  }
}

/** Une génération = une rangée : la hauteur de case suit le rang, jamais l'inverse. */
function assertRows(layout: LayoutResult): void {
  for (const unit of layout.units) {
    assert.equal(unit.y, PAD + unit.generation * (CARD_H + LEVEL_GAP), 'une rangée par génération');
  }
}

/** La famille réellement déclarée : deux couples de grands-parents, un couple, leur fils. */
function family(rootId: string | null = null): GraphData {
  return graph(
    [
      person('wi', 'Loriaux'),
      person('fr', 'Marlaire'),
      person('jg', 'Gossiaux'),
      person('mi', 'Prégaldien'),
      person('ac', 'Loriaux'),
      person('ch', 'Gossiaux'),
      person('ju', 'Gossiaux'),
    ],
    [union('wf', 'wi', 'fr'), union('jm', 'jg', 'mi'), union('cc', 'ac', 'ch')],
    [
      link('1', 'wi', 'ac', 'wf'),
      link('2', 'fr', 'ac', 'wf'),
      link('3', 'jg', 'ch', 'jm'),
      link('4', 'mi', 'ch', 'jm'),
      link('5', 'ac', 'ju', 'cc'),
      link('6', 'ch', 'ju', 'cc'),
    ],
    rootId,
  );
}

test('une famille ordinaire se range par générations, sans un seul pointillé', () => {
  const data = family();
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assertRows(layout);
  assert.equal(layout.crossLinks.length, 0, 'rien ici ne ressemble à une anomalie');

  for (const id of ['wi', 'fr', 'jg', 'mi']) {
    assert.equal(genOf(layout, id), 0, `${id} ouvre la première rangée`);
  }
  assert.equal(genOf(layout, 'ac'), 1);
  assert.equal(genOf(layout, 'ch'), 1);
  assert.equal(genOf(layout, 'ju'), 2);

  assert.deepEqual([...layout.edges].map((edge) => edge.to).sort(), ['ac', 'ch', 'ju']);

  // Le couple tient dans un seul bloc, les deux couples de grands-parents au-dessus de lui.
  assert.equal(unitOf(layout, 'ac').key, unitOf(layout, 'ch').key);
  assert.deepEqual([...unitOf(layout, 'ac').slots].sort(), ['ac', 'ch']);

  const acEdge = edgesTo(layout, 'ac')[0];
  assertClose(
    acEdge.x1,
    (cardOf(layout, 'wi').centerX + cardOf(layout, 'fr').centerX) / 2,
    'le trait part du milieu du couple',
  );
  assertClose(acEdge.x2, cardOf(layout, 'ac').centerX, 'et rejoint la case de l’enfant');
  assertClose(acEdge.y1, cardOf(layout, 'ac').y - LEVEL_GAP, 'le trait part du bas de la rangée');
  assertClose(acEdge.y2, cardOf(layout, 'ac').y, 'et tombe sur le haut de la case');

  const chEdge = edgesTo(layout, 'ch')[0];
  const juEdge = edgesTo(layout, 'ju')[0];
  const left = Math.min(acEdge.x1, chEdge.x1);
  const right = Math.max(acEdge.x1, chEdge.x1);
  assert.ok(
    juEdge.x1 > left && juEdge.x1 < right,
    'le couple se pose entre ses deux couples de parents',
  );
});

test('la souche ne change plus la forme de l’arbre', () => {
  const reference = positions(buildLayout(family()));
  for (const root of ['ju', 'wi', 'mi', 'fr', 'ac']) {
    assert.deepEqual(positions(buildLayout(family(root))), reference, `souche en ${root}`);
  }
});

test('l’ordre des tableaux livrés par la base ne change pas le dessin', () => {
  const data = family();
  const reversed = graph(
    [...data.persons].reverse(),
    [...data.couples].reverse(),
    [...data.parentChild].reverse(),
  );

  assert.deepEqual(
    positions(buildLayout(reversed)),
    positions(buildLayout(data)),
    'mêmes cases aux mêmes places',
  );
});

test('deux parents sans union déclarée pendent tous les deux sur leur enfant', () => {
  // Paul et Marie ne se sont jamais mariés : Luc est leur fils à tous les deux.
  const data = graph(
    [person('marie'), person('paul'), person('luc')],
    [],
    [link('1', 'paul', 'luc'), link('2', 'marie', 'luc')],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 0, 'deux parents, ce n’est pas une anomalie');

  const paul = edgesTo(layout, 'luc').find((edge) => edge.from === 'paul');
  const marie = edgesTo(layout, 'luc').find((edge) => edge.from === 'marie');
  assert.ok(paul && marie, 'un trait par parent, vers la même case');
  assertClose(paul!.x2, cardOf(layout, 'luc').centerX, 'les deux traits se rejoignent sur Luc');
  assertClose(marie!.x2, cardOf(layout, 'luc').centerX);
  assert.equal(genOf(layout, 'luc'), 1);

  // Deux traits au même niveau se croiseraient : ils se partagent l'espace entre les rangées.
  assert.notEqual(paul!.mid, marie!.mid, 'les deux lignes de raccord ne se superposent pas');
});

test('un conjoint sans parents dans la base se range à la génération de son époux', () => {
  // X n'a ni père ni mère dans la base : la poser tout en haut la sépareroit de son mari.
  const data = graph(
    [person('gp1'), person('gp2'), person('s'), person('x')],
    [union('gg', 'gp1', 'gp2'), union('gs', 's', 'x')],
    [link('1', 'gp1', 's', 'gg'), link('2', 'gp2', 's', 'gg')],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 0);
  assert.equal(genOf(layout, 'gp1'), 0);
  assert.equal(genOf(layout, 's'), 1);
  assert.equal(genOf(layout, 'x'), 1, 'le conjoint marié suit la rangée de son époux');
  assert.equal(unitOf(layout, 'x').key, unitOf(layout, 's').key, 'et tient dans son bloc');
  assert.equal(layout.edges.length, 1, 'la jonction du couple de parents descend une seule fois');
});

test('deux cousins mariés tiennent côte à côte, en traits pleins', () => {
  const data = graph(
    [person('r'), person('s1'), person('s2'), person('c1'), person('c2'), person('d')],
    [union('cousins', 'c1', 'c2')],
    [
      link('1', 'r', 's1'),
      link('2', 'r', 's2'),
      link('3', 's1', 'c1'),
      link('4', 's2', 'c2'),
      link('5', 'c1', 'd', 'cousins'),
      link('6', 'c2', 'd', 'cousins'),
    ],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 0, 'cousins mariés : la base le dit, l’arbre aussi');

  assert.equal(genOf(layout, 'r'), 0);
  assert.equal(genOf(layout, 's1'), 1);
  assert.equal(genOf(layout, 's2'), 1);
  assert.equal(genOf(layout, 'c1'), 2);
  assert.equal(genOf(layout, 'c2'), 2);
  assert.equal(genOf(layout, 'd'), 3);

  assert.equal(unitOf(layout, 'c1').key, unitOf(layout, 'c2').key);
  assert.equal(layout.edges.length, 5);

  const dEdge = edgesTo(layout, 'd')[0];
  assertClose(
    dEdge.x1,
    (cardOf(layout, 'c1').centerX + cardOf(layout, 'c2').centerX) / 2,
    'D pend sous la jonction des cousins',
  );
});

test('une personne qui a deux unions reste dans un seul bloc, entre les deux', () => {
  // B épouse M puis A, deux frères : les trois cases tiennent dans le même bloc.
  const data = graph(
    [person('r'), person('m'), person('a'), person('b')],
    [union('cm', 'm', 'b'), union('ca', 'a', 'b')],
    [link('1', 'r', 'm'), link('2', 'r', 'a')],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 0);
  assert.deepEqual([...unitOf(layout, 'b').slots].sort(), ['a', 'b', 'm']);
  assert.equal(unitOf(layout, 'b').junctions.length, 2, 'les deux unions se dessinent');
  assert.equal(genOf(layout, 'b'), 1);
  assert.equal(layout.edges.length, 2, 'R descend vers ses deux enfants');
});

test('un cycle ne fait pas boucler la mise en page et se dessine en pointillés', () => {
  // a engendre b, b engendre c, et c se découvre parent de a : le graphe n'est plus un arbre.
  const data = graph(
    [person('a', 'Gossiaux'), person('b', 'Gossiaux'), person('c', 'Dubois')],
    [],
    [link('1', 'a', 'b'), link('2', 'b', 'c'), link('3', 'c', 'a')],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assertRows(layout);
  assert.equal(layout.crossLinks.length, 1);
  assert.equal(layout.crossLinks[0].kind, 'cycle');
  assert.deepEqual(
    { fromId: layout.crossLinks[0].fromId, toId: layout.crossLinks[0].toId },
    { fromId: 'c', toId: 'a' },
  );

  // Les deux liens qui tiennent dans un sens unique restent des traits pleins.
  assert.equal(layout.edges.length, 2);
  assert.equal(genOf(layout, 'a'), 0);
  assert.equal(genOf(layout, 'b'), 1);
  assert.equal(genOf(layout, 'c'), 2);
});

test('une personne que rien ne rattache reste visible à côté de l’arbre', () => {
  const data = graph(
    [person('paul'), person('luc'), person('cousine')],
    [],
    [link('1', 'paul', 'luc')],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 0);
  assert.equal(genOf(layout, 'cousine'), 0);
  assert.equal(layout.units.filter((unit) => unit.generation === 0).length, 2);
});

test('une union entre deux générations que rien n’aligne se dit en pointillés', () => {
  // B et C ont tous deux leurs parents dans la base, et ne sont donc pas du même rang.
  const data = graph(
    [person('g'), person('a'), person('b'), person('c')],
    [union('bc', 'b', 'c')],
    [link('1', 'g', 'a'), link('2', 'g', 'b'), link('3', 'a', 'c')],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(genOf(layout, 'b'), 1);
  assert.equal(genOf(layout, 'c'), 2);
  assert.deepEqual(
    layout.crossLinks.map((cross) => [cross.kind, cross.fromId, cross.toId]),
    [['union', 'b', 'c']],
    'l’union reste dite, sans dupliquer une case',
  );
  assert.notEqual(cardOf(layout, 'b').y, cardOf(layout, 'c').y);
  assert.equal(layout.edges.length, 3);
});

test('les enfants d’un même couple pendent sous la même jonction', () => {
  const data = graph(
    [person('paul'), person('marie'), person('luc'), person('leo')],
    [union('pm', 'paul', 'marie')],
    [
      link('1', 'paul', 'luc', 'pm'),
      link('2', 'marie', 'luc', 'pm'),
      link('3', 'paul', 'leo', 'pm'),
      link('4', 'marie', 'leo', 'pm'),
    ],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 0);
  assert.equal(layout.edges.length, 2, 'une descendance par enfant, pas par parent');

  const [first, second] = layout.edges;
  assert.equal(first.from, second.from);
  assert.equal(first.x1, second.x1, 'le trait part du milieu du couple');
  assert.equal(first.mid, second.mid, 'les frères pendent sur la même ligne de raccord');
  assert.notEqual(first.x2, second.x2, 'chacun sur sa propre case');
  assert.equal(genOf(layout, 'luc'), 1);
  assert.equal(genOf(layout, 'leo'), 1);
});

test('une fratrie nombreuse s’étale sans se marcher dessus', () => {
  const children = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  const data = graph(
    [person('pa'), person('mo'), ...children.map((id) => person(id))],
    [union('pamo', 'pa', 'mo')],
    children.flatMap((id, index) => [
      link(`${index}a`, 'pa', id, 'pamo'),
      link(`${index}b`, 'mo', id, 'pamo'),
    ]),
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.equal(layout.crossLinks.length, 0);
  assert.equal(layout.edges.length, children.length);
  for (const id of children) {
    assert.equal(genOf(layout, id), 1);
    assert.equal(edgesTo(layout, id).length, 1);
  }
});
