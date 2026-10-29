import { db, newId, now } from './db';
import type { RelationInput } from '../shared/types';

type Row = Record<string, any>;

/**
 * Un refus de relation porte le message que la personne verra tel quel : pas de code
 * technique, pas de date ni de lien inventé pour faire passer l'écriture.
 */
export class RelationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function requirePerson(id: string | null | undefined, label: string): string {
  if (!id) throw new RelationError(400, `Il manque la personne concernée (${label}).`);
  const found = db.prepare('SELECT id FROM person WHERE id = ?').get(id) as Row | undefined;
  if (!found) throw new RelationError(404, 'Cette personne n’existe plus dans la base.');
  return id;
}

function findCouple(a: string, b: string): Row | undefined {
  return db
    .prepare(
      `SELECT * FROM couple
        WHERE (partner_a = ? AND partner_b = ?) OR (partner_a = ? AND partner_b = ?)`,
    )
    .get(a, b, b, a) as Row | undefined;
}

/** L'union entre deux personnes qui existent déjà, jamais une union imaginée. */
function createCouple(a: string, b: string): string {
  const existing = findCouple(a, b);
  if (existing) return existing.id as string;
  const id = newId();
  db.prepare('INSERT INTO couple (id, partner_a, partner_b, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    a,
    b,
    now(),
  );
  return id;
}

/** `descendantId` est-il enfant, petit-enfant ou arrière-petit-enfant de `ancestorId` ? */
function isDescendantOf(descendantId: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  const queue = [descendantId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === ancestorId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const parents = db
      .prepare('SELECT parent_id FROM parent_child WHERE child_id = ?')
      .all(current) as Row[];
    for (const link of parents) queue.push(link.parent_id as string);
  }
  return false;
}

function linkParentChild(parentId: string, childId: string, coupleId: string | null): void {
  const existing = db
    .prepare('SELECT id, couple_id FROM parent_child WHERE parent_id = ? AND child_id = ?')
    .get(parentId, childId) as Row | undefined;

  if (existing) {
    // Le lien existe déjà : on lui donne seulement l'union que l'on vient de déclarer.
    if (coupleId && !existing.couple_id) {
      db.prepare('UPDATE parent_child SET couple_id = ? WHERE id = ?').run(coupleId, existing.id);
    }
    return;
  }

  db.prepare(
    'INSERT INTO parent_child (id, parent_id, child_id, couple_id) VALUES (?, ?, ?, ?)',
  ).run(newId(), parentId, childId, coupleId);
}

/**
 * Une union déclarée vaut aussi pour les enfants que la base connaît déjà des deux : rattachés
 * parent par parent, ils pendaient sous chaque case, ils pendront désormais sous la jonction.
 * Un lien déjà attribué à une autre union n'est pas touché.
 */
function attributeChildrenToCouple(coupleId: string, a: string, b: string): void {
  db.prepare(
    `UPDATE parent_child SET couple_id = ?
      WHERE couple_id IS NULL
        AND child_id IN (SELECT child_id FROM parent_child WHERE parent_id = ?)
        AND child_id IN (SELECT child_id FROM parent_child WHERE parent_id = ?)`,
  ).run(coupleId, a, b);
}

/**
 * Un couple ne sert pas qu'à dessiner deux cases côte à côte : il porte la mémoire de l'union
 * dont des enfants sont issus. Il ne disparaît donc que quand plus personne ne le justifie —
 * ni un enfant, ni un acte, ni l'un de ses deux membres.
 */
export function pruneEmptyCouples(): void {
  db.prepare(
    `DELETE FROM couple
      WHERE partner_a IS NULL AND partner_b IS NULL
        AND id NOT IN (SELECT couple_id FROM parent_child WHERE couple_id IS NOT NULL)
        AND id NOT IN (SELECT couple_id FROM event WHERE couple_id IS NOT NULL)`,
  ).run();
}

/**
 * Attache un enfant à un parent. Deux règles commandent le reste : un enfant ne peut avoir
 * que deux parents, et une union n'existe que si quelqu'un la déclare. Sans `otherParentId`
 * l’enfant est rattaché à ce parent seul — l’arbre le dessine alors sous sa case à lui, pas
 * sous une jonction qu'aucun acte ne confirme.
 */
function attachChild(parentId: string, childId: string, otherParentId: string | null): void {
  if (parentId === childId) {
    throw new RelationError(400, 'Une personne ne peut pas être son propre parent.');
  }
  if (isDescendantOf(parentId, childId)) {
    throw new RelationError(
      409,
      'Impossible : cette personne est déjà descendante de l’autre — cela créerait une boucle.',
    );
  }

  if (otherParentId) {
    requirePerson(otherParentId, 'autre parent');
    if (otherParentId === parentId || otherParentId === childId) {
      throw new RelationError(400, 'L’autre parent doit être une personne différente.');
    }
  }

  const current = (db
    .prepare('SELECT parent_id FROM parent_child WHERE child_id = ?')
    .all(childId) as Row[]).map((link) => link.parent_id as string);
  const futureParents = new Set([...current, parentId, ...(otherParentId ? [otherParentId] : [])]);
  if (futureParents.size > 2) {
    throw new RelationError(
      409,
      'Cette personne a déjà deux parents. Commencez par en remplacer un.',
    );
  }

  if (!otherParentId) {
    linkParentChild(parentId, childId, null);
    return;
  }

  const coupleId = createCouple(parentId, otherParentId);
  linkParentChild(parentId, childId, coupleId);
  linkParentChild(otherParentId, childId, coupleId);
  attributeChildrenToCouple(coupleId, parentId, otherParentId);
}

/**
 * Rattache deux personnes déjà connues.
 *
 * `type` décrit la personne soumise (`subjectId`) par rapport à `relation.ofPersonId`:
 * « child » = elle en est l'enfant, « parent » = elle en est le parent, « partner » = union.
 */
export function attachRelation(subjectId: string, relation: RelationInput): void {
  requirePerson(subjectId, 'personne à rattacher');
  if (!['child', 'parent', 'partner'].includes(relation.type)) {
    throw new RelationError(400, 'Type de relation inconnu.');
  }
  const otherId = requirePerson(relation.ofPersonId, 'personne visée');

  const run = db.transaction(() => {
    if (relation.type === 'partner') {
      if (otherId === subjectId) {
        throw new RelationError(400, 'Une personne ne peut pas être son propre conjoint.');
      }
      const coupleId = createCouple(subjectId, otherId);
      attributeChildrenToCouple(coupleId, subjectId, otherId);
      return;
    }

    const parentId = relation.type === 'child' ? otherId : subjectId;
    const childId = relation.type === 'child' ? subjectId : otherId;
    attachChild(parentId, childId, relation.otherParentId ?? null);
  });

  run();
}
