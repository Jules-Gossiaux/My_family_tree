import { db, newId, now } from './db';
import type { Branch, BranchInput } from '../shared/types';

type Row = Record<string, any>;

/**
 * Un refus de branche porte le message que l'utilisateur verra tel quel : ce qu'il peut corriger,
 * pas un code technique.
 */
export class BranchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Huit teintes qui se distinguent sur le fond sombre de l'arbre. Une branche nouvelle prend la
 * première libre : deux branches de la même couleur seraient deux branches sans nom.
 */
const PALETTE = ['#c9a961', '#5fb0a7', '#d98a8a', '#8fbf6f', '#a78bd9', '#e0a24c', '#6fa8dc', '#c77da9'];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function mapBranch(row: Row): Branch {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    rootPersonId: (row.root_person_id as string | null) ?? null,
    personCount: row.people as number,
  };
}

export function listBranches(): Branch[] {
  return (db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM person p WHERE p.branch_id = b.id) AS people
         FROM branch b
        ORDER BY b.name COLLATE NOCASE`,
    )
    .all() as Row[]).map(mapBranch);
}

/** La branche telle qu'elle est en base, avec le compte de ses cases. Un identifiant inconnu se refuse. */
export function getBranch(id: string): Branch {
  const row = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM person p WHERE p.branch_id = b.id) AS people
         FROM branch b WHERE b.id = ?`,
    )
    .get(id) as Row | undefined;
  if (!row) throw new BranchError(404, 'Cette branche n’existe plus dans la base.');
  return mapBranch(row);
}

function requireBranchId(id: string | null | undefined): string {
  if (!id) throw new BranchError(400, 'Il manque la branche concernée.');
  const found = db.prepare('SELECT id FROM branch WHERE id = ?').get(id) as Row | undefined;
  if (!found) throw new BranchError(404, 'Cette branche n’existe plus dans la base.');
  return id;
}

function requirePersonId(id: string | null | undefined, label: string): string {
  if (!id) throw new BranchError(400, `Il manque la personne concernée (${label}).`);
  const found = db.prepare('SELECT id FROM person WHERE id = ?').get(id) as Row | undefined;
  if (!found) throw new BranchError(404, 'Cette personne n’existe plus dans la base.');
  return id;
}

/** Deux branches homonymes ne se lisent pas sur l'arbre : le nom seul les porte. */
function checkedName(name: string, exceptId: string | null): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new BranchError(400, 'Une branche porte un nom : sans lui, rien ne la distingue des autres.');
  }
  const clash = db
    .prepare('SELECT name FROM branch WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(trimmed, exceptId) as Row | undefined;
  if (clash) throw new BranchError(409, `Une branche porte déjà ce nom : « ${trimmed} ».`);
  return trimmed;
}

/**
 * Une teinte se donne en hexadécimal et ne se partage pas : deux branches de la même couleur se
 * lisent comme une seule ligne sur l'arbre. Le nom de l'autre branche est dans le refus, pour que
 * l'on sache laquelle recololorier.
 */
function checkedColor(color: string, exceptId: string | null): string {
  const trimmed = color.trim();
  if (!HEX_COLOR.test(trimmed)) {
    throw new BranchError(400, 'Une couleur se donne en hexadécimal, par exemple #c9a961.');
  }
  const clash = db
    .prepare('SELECT name FROM branch WHERE lower(color) = ? AND id IS NOT ?')
    .get(trimmed.toLowerCase(), exceptId) as Row | undefined;
  if (clash) throw new BranchError(409, `Une autre branche porte déjà cette teinte : « ${clash.name} ».`);
  return trimmed.toLowerCase();
}

/** La première teinte que personne d'autre ne porte déjà. */
function nextColor(): string {
  const taken = new Set(
    (db.prepare('SELECT color FROM branch').all() as Row[]).map((row) =>
      String(row.color).toLowerCase(),
    ),
  );
  return PALETTE.find((color) => !taken.has(color)) ?? PALETTE[taken.size % PALETTE.length];
}

/** Tous les descendants d'une personne, sans jamais tourner en rond dans une boucle de famille. */
function descendantIds(rootPersonId: string): string[] {
  const seen = new Set<string>([rootPersonId]);
  const queue = [rootPersonId];
  const out: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const children = db
      .prepare('SELECT child_id FROM parent_child WHERE parent_id = ?')
      .all(current) as Row[];
    for (const row of children) {
      const childId = row.child_id as string;
      if (seen.has(childId)) continue;
      seen.add(childId);
      out.push(childId);
      queue.push(childId);
    }
  }
  return out;
}

/**
 * Range une ligne : la personne et ses descendants. Une personne déjà rangée ailleurs n'est pas
 * déplacée — une branche ne vole pas ses gens à une autre branche, ce serait effacer un choix fait
 * à la main. Une branche qui ne range personne ne sert à rien : c'est le geste qui la remplit.
 */
export function assignDescendants(branchId: string, rootPersonId: string): number {
  requireBranchId(branchId);
  const ids = [requirePersonId(rootPersonId, 'racine de branche'), ...descendantIds(rootPersonId)];
  let moved = 0;
  for (const id of ids) {
    const done = db
      .prepare('UPDATE person SET branch_id = ?, updated_at = ? WHERE id = ? AND branch_id IS NULL')
      .run(branchId, now(), id);
    moved += done.changes;
  }
  return moved;
}

/**
 * Crée une branche. Une racine donnée au passage range toute sa descendance : c'est le geste le
 * plus long à faire à la main et le premier que l'on a envie de faire en créant la branche.
 */
export function createBranch(input: BranchInput & { includeDescendants?: boolean }): Branch {
  const name = checkedName(input.name ?? '', null);
  const color = input.color ? checkedColor(input.color, null) : nextColor();
  const rootId = input.rootPersonId ? requirePersonId(input.rootPersonId, 'racine de branche') : null;

  const id = newId();
  const run = db.transaction(() => {
    db.prepare('INSERT INTO branch (id, name, color, root_person_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      name,
      color,
      rootId,
      now(),
    );
    if (rootId && input.includeDescendants !== false) assignDescendants(id, rootId);
  });
  run();

  return getBranch(id);
}

/** Renommer, changer de teinte, changer de tête : le rang des personnes ne bouge pas ici. */
export function updateBranch(id: string, input: BranchInput): Branch {
  requireBranchId(id);

  const run = db.transaction(() => {
    if (input.name !== undefined) {
      db.prepare('UPDATE branch SET name = ? WHERE id = ?').run(checkedName(input.name, id), id);
    }
    if (input.color !== undefined) {
      db.prepare('UPDATE branch SET color = ? WHERE id = ?').run(checkedColor(input.color, id), id);
    }
    if (input.rootPersonId !== undefined) {
      const rootId = input.rootPersonId ? requirePersonId(input.rootPersonId, 'racine de branche') : null;
      db.prepare('UPDATE branch SET root_person_id = ? WHERE id = ?').run(rootId, id);
    }
  });
  run();

  return getBranch(id);
}

/**
 * Donner une branche à une personne, ou la lui rendre. Une personne ne porte qu'une branche :
 * la couleur d'une case doit se lire sans ambivalence.
 */
export function setPersonBranch(personId: string, branchId: string | null): void {
  requirePersonId(personId, 'personne');
  if (branchId !== null) requireBranchId(branchId);
  db.prepare('UPDATE person SET branch_id = ?, updated_at = ? WHERE id = ?').run(
    branchId,
    now(),
    personId,
  );
}

/**
 * Une branche effacée rend ses personnes au hors-classe — les fichiers, eux, ne bougent pas. C'est
 * `ON DELETE SET NULL` sur `person.branch_id` qui le fait, et la base ne peut donc pas laisser une
 * personne accrochée à une branche qui n'existe plus.
 */
export function deleteBranch(id: string): void {
  const done = db.prepare('DELETE FROM branch WHERE id = ?').run(id);
  if (done.changes === 0) throw new BranchError(404, 'Cette branche n’existe plus dans la base.');
}
