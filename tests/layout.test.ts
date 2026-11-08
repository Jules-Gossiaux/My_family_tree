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
    address: null,
    phone: null,
    email: null,
    cemetery: null,
    createdAt: '2026-01-01T00:00:00.000Z',
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
  assert.ok(unit, `${personId} tient dans une rangée`);
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

const rowsOf = (layout: LayoutResult): string[] =>
  cards(layout)
    .map((card) => `${card.personId}@${Math.round(card.y)}`)
    .sort();

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

/** Une rangée par niveau de descendance : la hauteur de case suit le rang, jamais l'inverse. */
function assertRows(layout: LayoutResult): void {
  for (const unit of layout.units) {
    assert.equal(unit.y, PAD + unit.generation * (CARD_H + LEVEL_GAP), 'une rangée par niveau');
  }
}

/** Les deux cases d'une union se touchent dans la même rangée. */
function assertAdjacent(layout: LayoutResult, a: string, b: string): void {
  const unit = unitOf(layout, a);
  assert.equal(unit.key, unitOf(layout, b).key, `${a} et ${b} tiennent dans la même rangée`);
  const ia = unit.slots.indexOf(a);
  const ib = unit.slots.indexOf(b);
  assert.equal(Math.abs(ia - ib), 1, `${a} et ${b} se touchent`);
}

/** Tous les segments droits du dessin : descentes, barres de fratrie, traits de couple, pointillés. */
function segments(layout: LayoutResult): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  for (const edge of layout.edges) {
    segs.push([edge.x1, edge.y1, edge.x1, edge.mid]);
    segs.push([edge.x1, edge.mid, edge.x2, edge.mid]);
    segs.push([edge.x2, edge.mid, edge.x2, edge.y2]);
  }
  for (const unit of layout.units) {
    for (const junction of unit.junctions) {
      if (!junction.coupleId) continue;
      const y = unit.y + CARD_H / 2;
      const x1 = unit.x - unit.w / 2 + junction.after * (CARD_W + CARD_GAP) + CARD_W;
      segs.push([x1, y, x1 + CARD_GAP, y]);
    }
  }
  for (const cross of layout.crossLinks) {
    const tokens = cross.d.match(/[MVHLC]|-?\d+(?:\.\d+)?/g) ?? [];
    const pts: [number, number][] = [];
    let x = 0;
    let y = 0;
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === 'M') {
        x = +tokens[i + 1];
        y = +tokens[i + 2];
        pts.push([x, y]);
        i += 3;
      } else if (t === 'V') {
        y = +tokens[i + 1];
        pts.push([x, y]);
        i += 2;
      } else if (t === 'H') {
        x = +tokens[i + 1];
        pts.push([x, y]);
        i += 2;
      } else if (t === 'L') {
        x = +tokens[i + 1];
        y = +tokens[i + 2];
        pts.push([x, y]);
        i += 3;
      } else if (t === 'C') {
        pts.push([x, y], [+tokens[i + 1], +tokens[i + 2]], [+tokens[i + 3], +tokens[i + 4]]);
        x = +tokens[i + 5];
        y = +tokens[i + 6];
        pts.push([x, y]);
        i += 7;
      } else {
        i += 1;
      }
    }
    for (let k = 0; k + 1 < pts.length; k++) {
      segs.push([pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]]);
    }
  }
  return segs;
}

/** Deux segments se traversent-ils franchement ? (Se toucher en un bout est un raccord, pas un croisement.) */
function crosses(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = orient(b[0], b[1], b[2], b[3], a[0], a[1]);
  const d2 = orient(b[0], b[1], b[2], b[3], a[2], a[3]);
  const d3 = orient(a[0], a[1], a[2], a[3], b[0], b[1]);
  const d4 = orient(a[0], a[1], a[2], a[3], b[2], b[3]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** La règle de la maison : aucun trait ne traverse un autre trait. */
function assertNoCrossing(layout: LayoutResult): void {
  const all = segments(layout);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      assert.ok(
        !crosses(all[i], all[j]),
        `deux traits se croisent : [${all[i]}] et [${all[j]}]`,
      );
    }
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

test('une famille ordinaire se range en descendance, couples côte à côte', () => {
  const data = family();
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assertRows(layout);

  for (const id of ['wi', 'fr', 'jg', 'mi']) {
    assert.equal(genOf(layout, id), 0, `${id} ouvre la première rangée`);
  }
  assert.equal(genOf(layout, 'ac'), 1);
  assert.equal(genOf(layout, 'ch'), 1, 'le conjoint marié suit la rangée de l’autre');
  assert.equal(genOf(layout, 'ju'), 2);

  assertAdjacent(layout, 'wi', 'fr');
  assertAdjacent(layout, 'jg', 'mi');
  assertAdjacent(layout, 'ac', 'ch');

  // ch, marié dans la rangée de ac, reste enfant de jg et mi : le trait de ses parents vient
  // jusqu'à sa case, comme pour un quelconque fils.
  assert.deepEqual([...layout.edges].map((edge) => edge.to).sort(), ['ac', 'ch', 'ju']);

  const acEdge = edgesTo(layout, 'ac')[0];
  assertClose(
    acEdge.x1,
    (cardOf(layout, 'wi').centerX + cardOf(layout, 'fr').centerX) / 2,
    'le trait part du milieu du couple',
  );
  assertClose(acEdge.x2, cardOf(layout, 'ac').centerX, 'et rejoint la case de l’enfant');
  assertClose(acEdge.y1, cardOf(layout, 'ac').y - LEVEL_GAP, 'le trait part du bas de la rangée');
  assertClose(acEdge.y2, cardOf(layout, 'ac').y, 'et tombe sur le haut de la case');

  // Le conjoint venu d'ailleurs tient par ses parents : un trait plein le dit, sans dupliquer sa case.
  const chEdge = edgesTo(layout, 'ch')[0];
  assert.equal(chEdge.from, 'jg', 'le trait part de la famille de jg et mi');
  assertClose(chEdge.x2, cardOf(layout, 'ch').centerX, 'il tombe sur la case de ch');
  assertClose(chEdge.y2, cardOf(layout, 'ch').y, 'par le haut de la case');
  assert.equal(layout.crossLinks.length, 0, 'rien de tout cela n’a besoin de pointillés');
  assertNoCrossing(layout);
  const juEdge = edgesTo(layout, 'ju')[0];
  assertClose(
    juEdge.x1,
    (cardOf(layout, 'ac').centerX + cardOf(layout, 'ch').centerX) / 2,
    'le fils pend sous la jonction de ses parents',
  );
});

test('ajouter un frère ne rebat ni les rangées ni les couples', () => {
  const before = buildLayout(family());
  const data = family();
  data.persons.push(person('bb', 'Gossiaux'));
  data.parentChild.push(link('7', 'ac', 'bb', 'cc'), link('8', 'ch', 'bb', 'cc'));
  const after = buildLayout(data);

  assertOneCardEach(after, data);
  assert.deepEqual(rowsOf(after).filter((row) => !row.startsWith('bb@')), rowsOf(before));
  for (const [a, b] of [
    ['wi', 'fr'],
    ['jg', 'mi'],
    ['ac', 'ch'],
  ]) {
    assertAdjacent(after, a, b);
  }
  assert.equal(genOf(after, 'bb'), 2, 'le frère tient sous ses parents');
  assert.equal(cardOf(after, 'bb').y, cardOf(after, 'ju').y);
  assert.equal(edgesTo(after, 'bb')[0].x1, edgesTo(after, 'ju')[0].x1, 'même jonction que son frère');
  assert.deepEqual(
    after.crossLinks,
    [],
    'rien de nouveau ne devient pointillé',
  );
  assertNoCrossing(after);
});

test('ajouter une famille sans lien laisse les familles déjà posées à leur place', () => {
  const before = buildLayout(family());
  const data = family();
  data.persons.push(person('zz', 'Ailleurs'));
  const after = buildLayout(data);

  assertOneCardEach(after, data);
  const keep = (list: string[]) => list.filter((entry) => !entry.startsWith('zz@'));
  assert.deepEqual(keep(positions(after)), positions(before));
});

test('une racine ajoutée prend la suite, même si son identifiant trie avant', () => {
  // Le cas qui déplaçait tout l'arbre : un uuid neuf qui trie avant ceux déjà rangés.
  const before = buildLayout(family());
  const data = family();
  data.persons.push({ ...person('aaa', 'Nouveau'), createdAt: '2026-11-08T12:00:00.000Z' });
  const after = buildLayout(data);

  assertOneCardEach(after, data);
  const keep = (list: string[]) => list.filter((entry) => !entry.startsWith('aaa@'));
  assert.deepEqual(keep(positions(after)), positions(before), 'aucune case existante ne bouge');
  const maxX = Math.max(...cards(before).map((card) => card.right));
  assert.ok(cardOf(after, 'aaa').x >= maxX, 'la nouvelle famille se pose après les autres');
});

test('un frère ajouté prend la suite de la fratrie, même si son identifiant trie avant', () => {
  const before = buildLayout(family());
  const data = family();
  data.persons.push({ ...person('aa', 'Gossiaux'), createdAt: '2026-11-08T12:00:00.000Z' });
  data.parentChild.push(link('7', 'ac', 'aa', 'cc'), link('8', 'ch', 'aa', 'cc'));
  const after = buildLayout(data);

  assertOneCardEach(after, data);
  const keep = (list: string[]) => list.filter((entry) => !entry.startsWith('aa@'));
  assert.deepEqual(keep(rowsOf(after)), rowsOf(before), 'les rangées ne se rebattent pas');
  assertAdjacent(after, 'ac', 'ch');
  assert.ok(
    cardOf(after, 'aa').centerX > cardOf(after, 'ju').centerX,
    'le frère entré en dernier se range après son aîné',
  );
});

test('la fille mariée dans une famille plus à droite se range du côté de ses parents', () => {
  // Clé et Hector à gauche ; leur fille Françoise a épousé Willy, fils de Maurice dont la famille
  // se pose plus à droite. Le bus de Clé et Hector va jusqu'à elle sans traverser le trait de Willy.
  const data = graph(
    [
      person('cle', 'Marlaire'),
      person('hector', 'Marlaire'),
      person('marc', 'Marlaire'),
      person('philippe', 'Marlaire'),
      person('ma', 'Marlaire'),
      person('pierre', 'Jacob'),
      person('thibaut', 'Jacob'),
      person('francoise', 'Marlaire'),
      person('willy', 'Loriaux'),
      person('maurice', 'Loriaux'),
    ],
    [union('u1', 'cle', 'hector'), union('u2', 'ma', 'pierre'), union('u3', 'willy', 'francoise')],
    [
      link('1', 'cle', 'marc', 'u1'),
      link('2', 'hector', 'marc', 'u1'),
      link('3', 'cle', 'philippe', 'u1'),
      link('4', 'hector', 'philippe', 'u1'),
      link('5', 'cle', 'ma', 'u1'),
      link('6', 'hector', 'ma', 'u1'),
      link('7', 'cle', 'francoise', 'u1'),
      link('8', 'hector', 'francoise', 'u1'),
      link('9', 'ma', 'thibaut', 'u2'),
      link('10', 'pierre', 'thibaut', 'u2'),
      link('11', 'maurice', 'willy'),
    ],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assertRows(layout);
  assertAdjacent(layout, 'cle', 'hector');
  assertAdjacent(layout, 'willy', 'francoise');
  assert.deepEqual(layout.crossLinks, [], 'tout se dit en traits pleins');
  assert.ok(
    cardOf(layout, 'francoise').centerX < cardOf(layout, 'willy').centerX,
    'Françoise se range du côté de ses parents, à gauche de son époux',
  );
  const edge = edgesTo(layout, 'francoise')[0];
  assert.equal(edge.from, 'cle', 'son trait part du bus de Clé et Hector');
  assert.ok(
    edge.x2 > edge.x1,
    'la barre de fratrie fait le trajet jusqu’à sa case',
  );
  assertClose(edge.y2, cardOf(layout, 'francoise').y, 'et tombe sur le haut de sa case');
  assertNoCrossing(layout);
});

test('la personne de référence ne change plus la forme de l’arbre', () => {
  const reference = positions(buildLayout(family()));
  for (const root of ['ju', 'wi', 'mi', 'fr', 'ac']) {
    assert.deepEqual(positions(buildLayout(family(root))), reference, `personne de référence en ${root}`);
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
  assertAdjacent(layout, 's', 'x');
  assert.equal(layout.edges.length, 1, 'la jonction du couple de parents descend une seule fois');
});

test('deux cousins mariés tiennent côte à côte, chacun reste enfant de sa branche', () => {
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
  assertAdjacent(layout, 'c1', 'c2');
  assert.deepEqual(layout.crossLinks, [], 'les cousins pendent chacun de leur bus, en trait plein');
  assert.ok(
    cardOf(layout, 'c2').centerX > cardOf(layout, 'c1').centerX,
    'c2 se range du côté de sa famille, à droite de son époux',
  );
  const c2Edge = edgesTo(layout, 'c2')[0];
  assert.equal(c2Edge.from, 's2', 'le trait de c2 part du bus de s2');
  assertClose(c2Edge.y2, cardOf(layout, 'c2').y, 'et tombe sur le haut de sa case');
  assertNoCrossing(layout);

  assert.equal(genOf(layout, 'r'), 0);
  assert.equal(genOf(layout, 's1'), 1);
  assert.equal(genOf(layout, 's2'), 1);
  assert.equal(genOf(layout, 'c1'), 2);
  assert.equal(genOf(layout, 'c2'), 2);
  assert.equal(genOf(layout, 'd'), 3);

  const dEdge = edgesTo(layout, 'd')[0];
  assertClose(
    dEdge.x1,
    (cardOf(layout, 'c1').centerX + cardOf(layout, 'c2').centerX) / 2,
    'D pend sous la jonction des cousins',
  );
});

test('une personne qui a deux unions reste dans une seule rangée, entre les deux', () => {
  // B épouse M puis A, deux frères : les trois cases tiennent dans la même rangée.
  const data = graph(
    [person('r'), person('m'), person('a'), person('b')],
    [union('cm', 'm', 'b'), union('ca', 'a', 'b')],
    [link('1', 'r', 'm'), link('2', 'r', 'a')],
  );
  const layout = buildLayout(data);

  assertOneCardEach(layout, data);
  assert.deepEqual([...unitOf(layout, 'b').slots].sort(), ['a', 'b', 'm']);
  assert.equal(unitOf(layout, 'b').junctions.filter((j) => j.coupleId).length, 2);
  assert.equal(genOf(layout, 'b'), 1);
  assert.deepEqual(
    layout.crossLinks,
    [],
    'M, marié dans la rangée de son frère, reste relié à son parent R par un trait plein',
  );
  const mEdge = edgesTo(layout, 'm')[0];
  assert.equal(mEdge.from, 'r', 'le trait de M part du bus de R');
  assertNoCrossing(layout);
});

test('un cycle ne fait pas boucler la mise en page et se dessine en pointillés', () => {
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

test('l’ordre des frères suit la naissance, pas l’ordre d’écriture', () => {
  const born = (id: string, year: string): Person => ({
    ...person(id),
    birth: { min: year, max: null, qualifier: 'exact', text: null },
  });
  const data = graph(
    [person('pa'), person('mo'), born('late', '1990'), born('early', '1980')],
    [union('pamo', 'pa', 'mo')],
    [
      link('1', 'pa', 'late', 'pamo'),
      link('2', 'mo', 'late', 'pamo'),
      link('3', 'pa', 'early', 'pamo'),
      link('4', 'mo', 'early', 'pamo'),
    ],
  );
  const layout = buildLayout(data);
  assert.ok(
    cardOf(layout, 'early').centerX < cardOf(layout, 'late').centerX,
    'l’aîné à gauche, même écrit en second',
  );
});
